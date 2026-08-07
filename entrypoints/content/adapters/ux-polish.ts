import {
  createBrowserDownloadManager,
  type BrowserDownloadManager,
} from '../download-manager';

export interface ContentUxPolishController {
  stop(): void;
  refreshLabels(): void;
}

export interface ContentUxPolishLabels {
  codeDownloadButton: string;
}

const STYLE_ID = 'dpp-content-ux-polish-css';
const CODE_BUTTON_CLASS = 'dpp-code-download';
const POLISH_MOUNT_DELAY_MS = 50;
const CODE_BUTTON_OFFSET_PX = 6;

export function startContentUxPolish(
  getLabels: () => ContentUxPolishLabels,
): ContentUxPolishController {
  injectStyles();
  const codeButtons = new Map<HTMLElement, HTMLButtonElement>();
  const downloads = createBrowserDownloadManager();
  const syncCodeButtons = () => syncCodeButtonPositions(codeButtons);
  const mount = () => mountPolish(document, getLabels(), codeButtons, downloads);
  const refreshLabels = () => applyPolishLabels(document, getLabels());
  mount();
  const candidateMountScheduler = createCandidateMountScheduler(getLabels, downloads);
  const observer = new MutationObserver((mutations) => {
    for (const root of collectPolishCandidateRoots(mutations)) {
      candidateMountScheduler.schedule(root, codeButtons);
    }
    syncCodeButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('dpp:navigation', mount);
  window.addEventListener('scroll', syncCodeButtons, true);
  window.addEventListener('resize', syncCodeButtons);

  return {
    refreshLabels,
    stop() {
      observer.disconnect();
      candidateMountScheduler.cancel();
      downloads.stop();
      window.removeEventListener('dpp:navigation', mount);
      window.removeEventListener('scroll', syncCodeButtons, true);
      window.removeEventListener('resize', syncCodeButtons);
      codeButtons.forEach((button) => button.remove());
      codeButtons.clear();
      document.getElementById(STYLE_ID)?.remove();
    },
  };
}

export function collectCodeBlocks(root: ParentNode): HTMLElement[] {
  return queryIncludingRoot<HTMLElement>(root, 'pre');
}

export function inferCodeFilename(codeBlock: HTMLElement, index = 0): string {
  const languageClass = Array.from(codeBlock.querySelector('code')?.classList ?? [])
    .find((className) => className.startsWith('language-'));
  const language = languageClass?.replace(/^language-/, '') || codeBlock.getAttribute('data-language') || 'txt';
  const ext = extensionForLanguage(language);
  return `deepseek-code-${index + 1}.${ext}`;
}

function mountPolish(
  root: ParentNode,
  labels: ContentUxPolishLabels,
  codeButtons: Map<HTMLElement, HTMLButtonElement>,
  downloads: BrowserDownloadManager,
): void {
  collectCodeBlocks(root).forEach((pre, index) => mountCodeDownload(pre, index, labels, codeButtons, downloads));
  applyPolishLabels(root, labels);
  syncCodeButtonPositions(codeButtons);
}

function mountCodeDownload(
  pre: HTMLElement,
  index: number,
  labels: ContentUxPolishLabels,
  codeButtons: Map<HTMLElement, HTMLButtonElement>,
  downloads: BrowserDownloadManager,
): void {
  if (codeButtons.has(pre)) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = CODE_BUTTON_CLASS;
  button.textContent = labels.codeDownloadButton;
  button.title = labels.codeDownloadButton;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloads.download(
      inferCodeFilename(pre, index),
      new Blob([getCodeBlockText(pre)], { type: 'text/plain;charset=utf-8' }),
    );
  });
  document.body.appendChild(button);
  codeButtons.set(pre, button);
  positionCodeButton(pre, button);
}

export function getCodeBlockText(pre: HTMLElement): string {
  const code = pre.querySelector('code');
  if (code?.textContent) return code.textContent;
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${CODE_BUTTON_CLASS}`).forEach((node) => node.remove());
  return clone.textContent ?? '';
}

function applyPolishLabels(root: ParentNode, labels: ContentUxPolishLabels): void {
  root.querySelectorAll<HTMLButtonElement>(`.${CODE_BUTTON_CLASS}`).forEach((button) => {
    button.textContent = labels.codeDownloadButton;
    button.title = labels.codeDownloadButton;
  });
}

function createCandidateMountScheduler(
  getLabels: () => ContentUxPolishLabels,
  downloads: BrowserDownloadManager,
): { schedule(root: ParentNode, codeButtons: Map<HTMLElement, HTMLButtonElement>): void; cancel(): void } {
  const pending = new Set<ParentNode>();
  let pendingCodeButtons: Map<HTMLElement, HTMLButtonElement> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(root: ParentNode, codeButtons: Map<HTMLElement, HTMLButtonElement>): void {
      pending.add(root);
      pendingCodeButtons = codeButtons;
      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        const roots = Array.from(pending);
        pending.clear();
        const labels = getLabels();
        for (const candidate of roots) {
          if (pendingCodeButtons) {
            mountPolish(candidate, labels, pendingCodeButtons, downloads);
          }
        }
        pendingCodeButtons = null;
      }, POLISH_MOUNT_DELAY_MS);
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
      pendingCodeButtons = null;
    },
  };
}

function collectPolishCandidateRoots(mutations: readonly MutationRecord[]): ParentNode[] {
  const roots = new Set<ParentNode>();

  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      const root = getPolishCandidateRoot(node);
      if (root) roots.add(root);
    }
  }

  return Array.from(roots);
}

function getPolishCandidateRoot(node: Node): ParentNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    return parent?.closest('pre') ?? null;
  }

  if (!(node instanceof Element)) return null;
  if (node.matches('pre')) return node;
  if (node.querySelector('pre')) return node;
  return null;
}

function queryIncludingRoot<T extends HTMLElement>(root: ParentNode, selector: string): T[] {
  const matches: T[] = [];
  if (root instanceof Element && root.matches(selector)) {
    matches.push(root as T);
  }
  matches.push(...Array.from(root.querySelectorAll<T>(selector)));
  return matches;
}

function syncCodeButtonPositions(codeButtons: Map<HTMLElement, HTMLButtonElement>): void {
  for (const [pre, button] of codeButtons) {
    if (!pre.isConnected) {
      button.remove();
      codeButtons.delete(pre);
      continue;
    }
    positionCodeButton(pre, button);
  }
}

function positionCodeButton(pre: HTMLElement, button: HTMLButtonElement): void {
  const rect = pre.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const hidden = rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth;
  const maxLeft = Math.max(CODE_BUTTON_OFFSET_PX, viewportWidth - CODE_BUTTON_OFFSET_PX);
  const maxTop = Math.max(CODE_BUTTON_OFFSET_PX, viewportHeight - CODE_BUTTON_OFFSET_PX);
  button.style.display = hidden ? 'none' : '';
  button.style.top = `${Math.min(maxTop, Math.max(CODE_BUTTON_OFFSET_PX, rect.top + CODE_BUTTON_OFFSET_PX))}px`;
  button.style.left = `${Math.min(maxLeft, Math.max(CODE_BUTTON_OFFSET_PX, rect.right - CODE_BUTTON_OFFSET_PX))}px`;
}

function extensionForLanguage(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized === 'javascript' || normalized === 'js' || normalized === 'jsx') return 'js';
  if (normalized === 'typescript' || normalized === 'ts' || normalized === 'tsx') return 'ts';
  if (normalized === 'python' || normalized === 'py') return 'py';
  if (normalized === 'json') return 'json';
  if (normalized === 'bash' || normalized === 'shell' || normalized === 'sh') return 'sh';
  if (normalized === 'markdown' || normalized === 'md') return 'md';
  return 'txt';
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${CODE_BUTTON_CLASS} {
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.92);
      color: #334155;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      cursor: pointer;
      position: fixed;
      transform: translateX(-100%);
      z-index: 2147483647;
      padding: 4px 7px;
    }
  `;
  document.head.appendChild(style);
}
