import {
  extractTaskCompleteSignal,
  stripDanglingLeadingPunctuation,
  TASK_COMPLETE_BLOCK_RE,
} from './prompt';

/**
 * Display-layer answer extraction (Issue #551, pivoted by UI review): the
 * user-facing answer is the FULL final-turn reply text with the internal
 * `<task_complete>` control block stripped. Real deliverables live in the
 * reply body — a summary-only split hid them inside a collapsed step — so the
 * answer area always renders the complete body, never folded or truncated.
 * The signal summary remains a fallback for runs whose pre-signal text is
 * empty, so a malformed completion never hides the answer.
 *
 * Kept out of {@link ./prompt} because that module is shared into the
 * sidepanel initial shell; this display-only logic is used exclusively by the
 * content-script renderer, so it lives in its own bundle slice.
 */
export function getInlineAgentAnswerText(text: string): string {
  const body = stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
  if (body) return body;
  return extractTaskCompleteSignal(text)?.summary.trim() ?? '';
}

/**
 * Display-layer process/step text: the model's working notes with the
 * internal `<task_complete>` control block removed entirely.
 */
export function getInlineAgentProcessText(text: string): string {
  return stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
}

// ---------------------------------------------------------------------------
// Artifact deliverables (Issue #551 stream redesign): the model delivers files
// by writing `<artifact_create>{"filename":"x.html","content":"…"}</artifact_create>`
// as plain text (the artifact tools are not in the loop descriptor catalog, so
// the XML stays in the text stream). The display layer converts every
// artifact block into "filename + fenced code block" BEFORE tool-call
// stripping, so the raw JSON is never shown and the answer no longer depends
// on the 8000-char step clamp. `artifact_bundle_create` emits one block per
// file. `convertInlineAgentArtifactBlocks` is pure and deterministic: the same
// raw text always converts to the same markdown, which is what makes the
// persisted "body + code blocks" finalText form round-trip through refresh.
// ---------------------------------------------------------------------------

export const INLINE_AGENT_TRUNCATION_MARKER = '...[truncated]';

/** Fence used for artifact code blocks (see pickArtifactFence). */
const ARTIFACT_BASE_FENCE_LENGTH = 4;
const ARTIFACT_BLOCK_OPEN_RE = /<(artifact_create|artifact_bundle_create)\s*>/g;
const ARTIFACT_FILENAME_RE = /"filename"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const ARTIFACT_CONTENT_RE = /"content"\s*:\s*"/;
const ARTIFACT_PARAM_SUMMARY_MAX_CHARS = 120;

/** Markdown language labels by file extension (lowercased). */
const ARTIFACT_LANGUAGE_BY_EXT: Record<string, string> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  svg: 'svg',
  xml: 'xml',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  txt: '',
  text: '',
};

/** Normalizes the artifact `language` enum to a markdown fence label. */
function normalizeArtifactLanguage(language: unknown, filename: string): string {
  if (typeof language === 'string' && language.trim()) {
    const normalized = language.trim().toLowerCase();
    const byEnum: Record<string, string> = {
      html: 'html',
      javascript: 'javascript',
      typescript: 'typescript',
      python: 'python',
      text: '',
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      css: 'css',
      json: 'json',
      markdown: 'markdown',
      md: 'markdown',
      svg: 'svg',
      xml: 'xml',
      bash: 'bash',
      sh: 'bash',
    };
    if (normalized in byEnum) return byEnum[normalized];
  }
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return ARTIFACT_LANGUAGE_BY_EXT[extension] ?? '';
}

/**
 * The artifact fence is FIXED at 4 backticks unless the content itself
 * contains a run of 4+ backticks (then the fence grows past the longest run).
 * The fixed default is deliberate: a truncated artifact block (persisted step
 * text, old traces) and its complete counterpart (persisted finalText) then
 * convert to byte-identical fences, which is what lets the answer resolver
 * recognize them as the same origin after code-blockification.
 */
function pickArtifactFence(content: string): string {
  let maxRun = 0;
  let run = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '`') {
      run += 1;
      if (run > maxRun) maxRun = run;
    } else {
      run = 0;
    }
  }
  return '`'.repeat(maxRun >= ARTIFACT_BASE_FENCE_LENGTH ? maxRun + 1 : ARTIFACT_BASE_FENCE_LENGTH);
}

/**
 * Prefix-preserving JSON-fragment unescape for salvaged artifact blocks.
 * Incomplete escapes at the end of a truncated fragment (e.g. a cut-off
 * `\n` or `\u00`) are dropped, so `unescape(prefix(raw))` is always a prefix
 * of `unescape(raw)` — the resolver's same-origin prefix check stays valid.
 */
function unescapeJsonFragment(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break; // trailing backslash: incomplete escape
    switch (next) {
      case '"': out += '"'; i += 2; break;
      case '\\': out += '\\'; i += 2; break;
      case '/': out += '/'; i += 2; break;
      case 'n': out += '\n'; i += 2; break;
      case 't': out += '\t'; i += 2; break;
      case 'r': out += '\r'; i += 2; break;
      case 'b': out += '\b'; i += 2; break;
      case 'f': out += '\f'; i += 2; break;
      case 'u': {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break; // incomplete escape
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        break;
      }
      default:
        out += next;
        i += 2;
    }
  }
  return out;
}

function escapeArtifactFilename(filename: string): string {
  // Filenames are user-facing plain text: drop markdown-significant chars so
  // the header can never inject formatting.
  return filename.replace(/[*`]/g, '').trim() || 'artifact';
}

/**
 * Renders one artifact file as "filename + fenced code block" markdown.
 *
 * `style` controls the block's shape:
 * - `'closed'` (final/restore): a well-formed block; a truncated fragment
 *   carries the explicit `...[truncated]` marker inside the fence.
 * - `'open'` (live streaming): NO closing fence and NO marker, so the partial
 *   content visibly grows with the token stream — the markdown renderer
 *   auto-closes the fence at the end of the text.
 */
function renderArtifactCodeBlock(
  filename: string,
  content: string,
  language: unknown,
  truncated: boolean,
  style: 'closed' | 'open' = 'closed',
): string {
  const fence = pickArtifactFence(content);
  const lang = normalizeArtifactLanguage(language, filename);
  const header = `**${escapeArtifactFilename(filename)}**\n\n${fence}${lang}\n${content}`;
  if (style === 'open') return header;
  // The truncation marker sits INSIDE the block (honest labeling, same marker
  // as clampText). The block is always well-formed (closed fence), so the
  // markdown renderer shows partial content + marker; the resolver strips the
  // trailing marker + fence to compare against the complete block.
  const marker = truncated ? `\n${INLINE_AGENT_TRUNCATION_MARKER}` : '';
  return `${header}${marker}\n${fence}`;
}

function stringifyArtifactPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function renderArtifactCreateBlock(
  body: string,
  truncated: boolean,
  style: 'closed' | 'open',
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const filename = typeof record.filename === 'string' ? record.filename : 'artifact';
    const content = typeof record.content === 'string' ? record.content : stringifyArtifactPayload(record);
    // A parseable block is complete regardless of the stream mode: always
    // render the closed, well-formed form.
    return renderArtifactCodeBlock(filename, content, record.language, false, 'closed');
  }
  // Best-effort salvage of a truncated / malformed block: pull the filename
  // and content fields out of the raw fragment and mark the truncation.
  const filenameMatch = ARTIFACT_FILENAME_RE.exec(body);
  const filename = filenameMatch ? unescapeJsonFragment(filenameMatch[1]) : 'artifact';
  const contentMatch = ARTIFACT_CONTENT_RE.exec(body);
  const content = contentMatch
    ? unescapeJsonFragment(body.slice(contentMatch.index + contentMatch[0].length))
    : body;
  // Streaming: emit the partial as an OPEN block (no marker, no closing
  // fence); final/restore: closed block with the truncation marker.
  return renderArtifactCodeBlock(filename, content, undefined, truncated, style);
}

function renderArtifactBundleBlock(
  body: string,
  truncated: boolean,
  style: 'closed' | 'open',
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const files = Array.isArray(record.files) ? record.files : [];
    const blocks: string[] = [];
    for (const file of files) {
      if (file && typeof file === 'object' && !Array.isArray(file)) {
        const fileRecord = file as Record<string, unknown>;
        const filename = typeof fileRecord.filename === 'string' ? fileRecord.filename : 'artifact';
        const content = typeof fileRecord.content === 'string'
          ? fileRecord.content
          : stringifyArtifactPayload(fileRecord);
        blocks.push(renderArtifactCodeBlock(filename, content, fileRecord.language, false, 'closed'));
      }
    }
    if (blocks.length > 0) return blocks.join('\n\n');
    // A bundle with no parseable files still delivers its payload: show the
    // decoded JSON body rather than the raw XML.
    return renderArtifactCodeBlock('artifact_bundle', stringifyArtifactPayload(record), 'json', truncated, style);
  }
  return renderArtifactCreateBlock(body, truncated, style);
}

export interface InlineAgentArtifactConversionOptions {
  /**
   * What to do with artifact blocks whose JSON cannot be parsed:
   * - `'hide'`: render nothing until the block completes (not used anymore;
   *   kept for API stability).
   * - `'stream'` (live streaming): best-effort decode of the fragment as an
   *   OPEN code block (no truncation marker, no closing fence) so the
   *   deliverable visibly grows with the token stream; the markdown renderer
   *   auto-closes the fence at the end of the text.
   * - `'salvage'` (final answer / restore): best-effort decode as a closed
   *   code block with an explicit truncation marker.
   * Defaults to `'salvage'`.
   */
  partial?: 'hide' | 'stream' | 'salvage';
}

/**
 * Converts every `<artifact_create>` / `<artifact_bundle_create>` block in the
 * raw model text into "filename + fenced code block" markdown. Blocks are
 * scanned linearly; an artifact block without its closing tag (truncated by
 * the 8000-char step clamp or an old trace) is salvaged up to the end of the
 * text. The output is deterministic markdown — the raw JSON is never shown.
 */
export function convertInlineAgentArtifactBlocks(
  text: string,
  options?: InlineAgentArtifactConversionOptions,
): string {
  if (!text.includes('<artifact_create>') && !text.includes('<artifact_bundle_create>')) {
    return text;
  }
  const partial = options?.partial ?? 'salvage';

  interface BlockRange { start: number; end: number; name: string; }
  const blocks: BlockRange[] = [];
  ARTIFACT_BLOCK_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let scanFrom = 0;
  while ((match = ARTIFACT_BLOCK_OPEN_RE.exec(text)) !== null) {
    const name = match[1];
    const start = match.index;
    const closeTag = `</${name}>`;
    const closeIndex = text.indexOf(closeTag, ARTIFACT_BLOCK_OPEN_RE.lastIndex);
    if (closeIndex === -1) {
      // Unclosed block (truncated text): salvage the remainder.
      blocks.push({ start, end: text.length, name });
      break;
    }
    blocks.push({ start, end: closeIndex + closeTag.length, name });
    scanFrom = closeIndex + closeTag.length;
    ARTIFACT_BLOCK_OPEN_RE.lastIndex = scanFrom;
  }

  if (blocks.length === 0) return text;

  let output = '';
  let cursor = 0;
  const style: 'closed' | 'open' = partial === 'stream' ? 'open' : 'closed';
  for (const block of blocks) {
    output += text.slice(cursor, block.start);
    const hasClose = text.slice(block.start, block.end).endsWith(`</${block.name}>`);
    const bodyStart = block.start + block.name.length + 2;
    const bodyEnd = hasClose ? block.end - (block.name.length + 3) : text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    const truncated = !hasClose;
    const rendered = block.name === 'artifact_bundle_create'
      ? renderArtifactBundleBlock(body, truncated, style)
      : renderArtifactCreateBlock(body, truncated, style);
    if (partial === 'hide' && rendered.includes(INLINE_AGENT_TRUNCATION_MARKER)) {
      // An unparseable block is (probably) still streaming in: show nothing
      // until it completes instead of flashing a [truncated] block.
      output += '';
    } else {
      output += rendered;
    }
    cursor = block.end;
  }
  output += text.slice(cursor);
  return output;
}

/**
 * Removes the trailing truncation suffix from a display text so two texts of
 * the same origin (one clamped, one complete) can be compared. The suffix is:
 * the `...[truncated]` marker, and — when a salvaged artifact block emitted
 * the marker inside a closed fence — the trailing fence line. Iterated so
 * `content\n````\n...[truncated]` and `content\n...[truncated]` (unclosed
 * clamp cut) both normalize to `content`.
 */
export function stripInlineAgentTruncationSuffix(text: string): string {
  let value = text.trimEnd();
  let changed = true;
  while (changed && value) {
    changed = false;
    if (value.endsWith(INLINE_AGENT_TRUNCATION_MARKER)) {
      value = value.slice(0, -INLINE_AGENT_TRUNCATION_MARKER.length).trimEnd();
      changed = true;
      continue;
    }
    const lastLineStart = value.lastIndexOf('\n') + 1;
    const lastLine = value.slice(lastLineStart);
    if (/^`{3,}$/.test(lastLine.trim())) {
      value = value.slice(0, lastLineStart).trimEnd();
      changed = true;
    }
  }
  return value;
}

/**
 * Resolve the user-facing final answer of a completed run from its two
 * candidate sources (Issue #551 follow-up): the loop's resolved final text
 * `finalAnswer` and the last step's rendered text `lastStepText` (the same
 * final turn as it was streamed). When one is a prefix of the other they
 * provably share an origin and the longer one is the complete reply — traces
 * persisted by older builds stored a summary/prefix as `finalText` while the
 * full reply (e.g. a generated HTML document) only survived in the last step.
 * Unrelated texts keep `finalAnswer` (budget notices, legacy summary-split
 * runs). `fromStep` tells the caller the step body IS the answer and may be
 * replaced without a further equality check.
 *
 * Since the stream redesign, both candidates are code-blockified display
 * texts: a truncated step (clamped mid-artifact) carries a `...[truncated]`
 * marker (+ closing fence from the salvage conversion), so the prefix
 * comparison normalizes both sides with
 * {@link stripInlineAgentTruncationSuffix} first. That keeps the same-origin
 * detection working after code-blockification without ever treating unrelated
 * texts as one.
 */
export function resolveInlineAgentAnswerText(
  finalAnswer: string,
  lastStepText: string,
): { answer: string; fromStep: boolean } {
  if (!lastStepText) return { answer: finalAnswer, fromStep: false };
  if (!finalAnswer) return { answer: lastStepText, fromStep: true };
  const normalizedAnswer = stripInlineAgentTruncationSuffix(finalAnswer);
  const normalizedStep = stripInlineAgentTruncationSuffix(lastStepText);
  if (normalizedStep === normalizedAnswer) return { answer: finalAnswer, fromStep: false };
  if (normalizedStep.startsWith(normalizedAnswer)) return { answer: lastStepText, fromStep: true };
  if (normalizedAnswer.startsWith(normalizedStep)) return { answer: finalAnswer, fromStep: false };
  return { answer: finalAnswer, fromStep: false };
}

/**
 * Single-line tool-entry parameter summary (Codex-style work log): the first
 * short string field from the tool call payload, so `web_search · weather`
 * reads like the command line the agent ran. Returns null when the payload
 * has no useful string field (the caller then falls back to the result
 * summary).
 */
const ARTIFACT_PARAM_PRIORITY_FIELDS = [
  'query',
  'url',
  'filename',
  'path',
  'command',
  'id',
  'name',
  'title',
  'keyword',
  'message',
  'prompt',
  'expression',
  'code',
];

export function summarizeInlineAgentToolParams(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ARTIFACT_PARAM_PRIORITY_FIELDS) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const clean = value.trim().replace(/\s+/g, ' ');
    if (clean.length <= ARTIFACT_PARAM_SUMMARY_MAX_CHARS) return clean;
    return `${clean.slice(0, ARTIFACT_PARAM_SUMMARY_MAX_CHARS)}…`;
  }
  return null;
}
