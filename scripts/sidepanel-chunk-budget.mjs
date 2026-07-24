import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, join, normalize, posix, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const distDir = join(rootDir, 'dist');
const browserArgIndex = process.argv.indexOf('--browser');
const requestedBrowsers = browserArgIndex >= 0
  ? [process.argv[browserArgIndex + 1]]
  : ['chrome', 'edge', 'firefox'];

if (requestedBrowsers.some((browser) => !browser)) {
  throw new Error('Usage: sidepanel-chunk-budget.mjs [--browser chrome|edge|firefox]');
}

// R6.4 Chrome baseline, re-captured after c6e00d3 (local-skill management feature)
// with WXT 0.20.26. The initial shell is sidepanel.html's entry script plus every
// static modulepreload. c6e00d3 added the local-skill activation / path-rewrite /
// scoring / cwd-enforcement code that is statically reachable from the sidepanel
// entry graph, growing the shell by ~1 KB. Re-baseline to the post-change size;
// raw bytes are deterministic, and the gzip headroom below absorbs zlib encoder
// variance across CI runs and browsers.
const BASELINE = Object.freeze({
  initialShell: { raw: 367_500, gzip: 110_700 },
  routeChunks: {
    ChatPage: { raw: 134_938, gzip: 40_056 },
    CapabilitiesPage: { raw: 160_137, gzip: 35_259 },
    SettingsPage: { raw: 81_914, gzip: 20_503 },
    LibraryPage: { raw: 1_451, gzip: 728 },
    MemoryPage: { raw: 4_493, gzip: 1_837 },
    SavedPage: { raw: 7_928, gzip: 2_787 },
  },
});

// W2.6 pre-change Chrome measurement at 450b5e2. The rich Markdown renderer
// was part of ChatPage's static graph, leaving less than 1% budget headroom.
const WAVE_2_CHAT_BASELINE = Object.freeze({
  firstChatScreen: { raw: 498_013, gzip: 150_087 },
  ChatPage: { raw: 134_902, gzip: 40_039 },
});

// gzip size may vary slightly between supported Node/zlib releases even when
// the built JavaScript bytes are identical. Keep the raw baseline exact and
// bound this encoder-only variance to a small fixed allowance.
const GZIP_ENCODER_VARIANCE_BYTES = 256;

const BUDGET = Object.freeze({
  initialShell: {
    raw: BASELINE.initialShell.raw,
    gzip: BASELINE.initialShell.gzip + GZIP_ENCODER_VARIANCE_BYTES,
  },
  firstChatScreen: { raw: 400_000, gzip: 122_000 },
  richRendererIncrement: { raw: 120_000, gzip: 36_000 },
  routeChunks: {
    ChatPage: { raw: 25_000, gzip: 8_000 },
    LibraryPage: { raw: 2_500, gzip: 1_200 },
    MemoryPage: { raw: 6_000, gzip: 2_500 },
    SavedPage: { raw: 10_000, gzip: 4_000 },
    CapabilitiesPage: { raw: 5_000, gzip: 2_000 },
    SkillPage: { raw: 60_000, gzip: 13_000 },
    McpPage: { raw: 50_000, gzip: 12_000 },
    ToolsPage: { raw: 18_000, gzip: 6_000 },
    BrowserControlPage: { raw: 10_000, gzip: 4_000 },
    PresetPage: { raw: 14_000, gzip: 5_000 },
    AutomationPage: { raw: 35_000, gzip: 10_000 },
    SettingsPage: { raw: 45_000, gzip: 14_000 },
    GeneralSubPage: { raw: 5_000, gzip: 2_500 },
    ApiSubPage: { raw: 8_000, gzip: 3_500 },
    PromptSubPage: { raw: 14_000, gzip: 5_000 },
    VoiceSubPage: { raw: 5_000, gzip: 2_500 },
    AppearanceSubPage: { raw: 8_000, gzip: 3_500 },
    UsageSubPage: { raw: 12_000, gzip: 5_000 },
    DataSubPage: { raw: 14_000, gzip: 5_500 },
    AboutSubPage: { raw: 3_000, gzip: 1_500 },
  },
});

for (const browser of requestedBrowsers) {
  verifyBrowserBuild(browser);
}

function verifyBrowserBuild(browser) {
  const buildDir = join(distDir, `${browser}-mv3`);
  if (!existsSync(buildDir)) {
    throw new Error(`Missing ${browser} build at ${buildDir}. Run the browser build first.`);
  }

  const initialFiles = readInitialModuleFiles(buildDir);
  const initialGraph = collectStaticModuleGraph(buildDir, initialFiles);
  const initialMetric = measureFiles(buildDir, initialGraph);
  assertBudget(browser, 'initial shell', initialMetric, BUDGET.initialShell);

  const chatChunk = findNamedChunk(buildDir, 'ChatPage');
  const firstScreenGraph = collectStaticModuleGraph(buildDir, [...initialFiles, chatChunk]);
  const firstScreenMetric = measureFiles(buildDir, firstScreenGraph);
  assertBudget(browser, 'first chat screen', firstScreenMetric, BUDGET.firstChatScreen);

  const richRendererChunk = findNamedChunk(buildDir, 'RichMessageContent');
  const richRendererGraph = collectStaticModuleGraph(buildDir, [richRendererChunk]);
  const firstScreenFiles = new Set(firstScreenGraph);
  const richRendererIncrement = richRendererGraph.filter((file) => !firstScreenFiles.has(file));
  const richRendererMetric = measureFiles(buildDir, richRendererIncrement);
  assertBudget(
    browser,
    'rich message renderer static increment',
    richRendererMetric,
    BUDGET.richRendererIncrement,
  );

  const routeMetrics = {};
  for (const [chunkName, budget] of Object.entries(BUDGET.routeChunks)) {
    const chunkPath = findNamedChunk(buildDir, chunkName);
    const metric = measureFiles(buildDir, [chunkPath]);
    routeMetrics[chunkName] = metric;
    assertBudget(browser, `${chunkName} chunk`, metric, budget);
  }

  console.log(JSON.stringify({
    browser,
    baseline: BASELINE,
    gzipEncoderVarianceBytes: GZIP_ENCODER_VARIANCE_BYTES,
    wave2ChatBaseline: WAVE_2_CHAT_BASELINE,
    current: {
      initialShell: initialMetric,
      firstChatScreen: firstScreenMetric,
      richRendererIncrement: richRendererMetric,
      routeChunks: routeMetrics,
    },
  }, null, 2));
}

function readInitialModuleFiles(buildDir) {
  const html = readFileSync(join(buildDir, 'sidepanel.html'), 'utf8');
  const files = new Set();
  for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g)) {
    files.add(match[1].replace(/^\//, ''));
  }
  if (files.size === 0) throw new Error('sidepanel.html does not reference a JavaScript entry.');
  return [...files];
}

function collectStaticModuleGraph(buildDir, entryFiles) {
  const pending = [...entryFiles];
  const files = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;
    const absolutePath = join(buildDir, file);
    if (!existsSync(absolutePath)) {
      throw new Error(`Missing Side Panel module ${file}.`);
    }
    files.add(file);
    const source = readFileSync(absolutePath, 'utf8');
    for (const match of source.matchAll(/\bimport(?:[^"'()]*?from)?["']([^"']+)["']/g)) {
      if (!match[1].startsWith('.')) continue;
      const imported = posix.normalize(posix.join(posix.dirname(file), match[1]));
      pending.push(imported);
    }
  }
  return [...files];
}

function findNamedChunk(buildDir, name) {
  const chunksDir = join(buildDir, 'chunks');
  const matches = readdirSync(chunksDir)
    .filter((file) => file.startsWith(`${name}-`) && file.endsWith('.js'));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} chunk in ${chunksDir}, found ${matches.length}.`);
  }
  return normalize(join('chunks', matches[0])).replaceAll('\\', '/');
}

function measureFiles(buildDir, files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const content = readFileSync(join(buildDir, file));
    raw += content.byteLength;
    gzip += gzipSync(content, { level: 9 }).byteLength;
  }
  return { raw, gzip, files: [...files].map((file) => basename(file)).sort() };
}

function assertBudget(browser, label, actual, budget) {
  if (actual.raw > budget.raw || actual.gzip > budget.gzip) {
    throw new Error(
      `${browser} ${label} exceeds budget: raw ${actual.raw}/${budget.raw}, `
      + `gzip ${actual.gzip}/${budget.gzip}.`,
    );
  }
}
