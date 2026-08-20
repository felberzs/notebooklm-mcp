/**
 * Pagination behaviour of `read_source` (no network).
 *
 * A source can run to six figures of characters, so the paging contract — page
 * size, where a page is cut, and how a caller is told to continue — is what
 * keeps the tool usable. These lock it.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  log: {
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    dim: jest.fn(),
  },
}));

jest.unstable_mockModule('../config.js', () => ({
  CONFIG: {
    dataDir: '/tmp/test-data',
    browserStateDir: '/tmp/test-data/browser_state',
    stealthEnabled: true,
    headless: true,
    viewport: { width: 1920, height: 1080 },
    uiLocale: 'en',
  },
  LOCALE_BROWSER_SETTINGS: { en: { locale: 'en-US', timezone: 'America/New_York' } },
  NOTEBOOKLM_AUTH_URL: 'https://notebooklm.google.com/',
  applyBrowserOptions: jest.fn((o: unknown) => o),
}));

/** The document every test reads: 30 lines of 1000 characters (~30k), so it pages. */
const LINE = 'x'.repeat(999);
const DOC = Array.from({ length: 30 }, () => LINE).join('\n');

let fulltext: unknown = { id: 'src-1', title: 'Long.pdf', content: DOC, charCount: DOC.length };
let sources = [{ id: 'src-1', title: 'Long.pdf' }];

jest.unstable_mockModule('../rpc/sources-rpc.js', () => ({
  SourcesRpc: class {
    async getSourceFulltext() {
      return fulltext;
    }
  },
}));

jest.unstable_mockModule('../rpc/notebooks-rpc.js', () => ({
  NotebookRpc: class {
    async getSources() {
      return sources;
    }
    async getSourceIds() {
      return sources.map((s) => s.id);
    }
  },
}));

const NB = '11111111-2222-3333-4444-555555555555';

describe('read_source pagination', () => {
  let handlers: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    fulltext = { id: 'src-1', title: 'Long.pdf', content: DOC, charCount: DOC.length };
    sources = [{ id: 'src-1', title: 'Long.pdf' }];
    const module = await import('../tools/index.js');
    handlers = new module.ToolHandlers(
      { getSharedContextManager: jest.fn() },
      {},
      { getActiveNotebook: jest.fn().mockReturnValue(null) }
    );
    // The RPC client is never touched: both RPC classes above are mocked.
    handlers.getRpcClient = async () => ({});
  });

  const read = (args: Record<string, unknown> = {}) =>
    handlers.handleReadSource({ notebook_id: NB, source_id: 'src-1', ...args });

  it('returns a first page well short of the document, and says how to continue', async () => {
    const { success, data } = await read();
    expect(success).toBe(true);
    expect(data.totalChars).toBe(DOC.length);
    expect(data.pageChars).toBeLessThan(DOC.length);
    expect(data.offset).toBe(0);
    expect(data.hasMore).toBe(true);
    expect(data.nextCursor).toBe(data.pageChars);
    expect(data.continue).toContain(`cursor: ${data.nextCursor}`);
  });

  it('walks the whole document across pages without losing or repeating a character', async () => {
    let cursor = 0;
    let assembled = '';
    let pages = 0;
    for (;;) {
      const { data } = await read({ cursor, max_chars: 4096 });
      expect(data.offset).toBe(cursor);
      assembled += data.content;
      pages++;
      if (!data.hasMore) {
        expect(data.nextCursor).toBeUndefined();
        expect(data.continue).toBeUndefined();
        break;
      }
      cursor = data.nextCursor;
      expect(pages).toBeLessThan(50); // guard against a non-advancing cursor
    }
    expect(assembled).toBe(DOC);
    expect(pages).toBeGreaterThan(1);
  });

  it('cuts at a line break rather than mid-line', async () => {
    const { data } = await read({ max_chars: 5000 });
    expect(data.content.endsWith('\n')).toBe(true);
    expect(data.pageChars).toBeLessThanOrEqual(5000);
  });

  it('cuts exactly when no line break is close enough to the limit', async () => {
    fulltext = { id: 'src-1', title: 'Unbroken', content: 'y'.repeat(5000), charCount: 5000 };
    const { data } = await read({ max_chars: 1000 });
    expect(data.pageChars).toBe(1000);
    expect(data.nextCursor).toBe(1000);
  });

  it('returns the whole document in one response when paginate is false', async () => {
    const { data } = await read({ paginate: false });
    expect(data.content).toBe(DOC);
    expect(data.pageChars).toBe(DOC.length);
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeUndefined();
  });

  it('does not paginate a source that fits in one page', async () => {
    fulltext = { id: 'src-1', title: 'Short', content: 'a short source', charCount: 14 };
    const { data } = await read();
    expect(data.content).toBe('a short source');
    expect(data.hasMore).toBe(false);
    expect(data.continue).toBeUndefined();
  });

  it('rejects a cursor past the end instead of returning an empty page', async () => {
    const { success, error } = await read({ cursor: DOC.length + 1 });
    expect(success).toBe(false);
    expect(error).toContain('past the end');
  });

  it('cuts HTML at a tag boundary', async () => {
    const html = '<p>' + 'z'.repeat(400) + '</p><p>tail</p>';
    fulltext = { id: 'src-1', title: 'Page', content: html, charCount: html.length };
    const { data } = await read({ format: 'html', max_chars: 420 });
    expect(data.content.endsWith('>')).toBe(true);
  });
});
