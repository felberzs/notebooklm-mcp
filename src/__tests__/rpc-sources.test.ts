/**
 * Unit tests for the `GET_SOURCE` fulltext envelope (no network).
 *
 * The envelope is positional and undocumented, so these lock the two things
 * that would break silently against a live notebook: which slot each rendition
 * lives in, and the flatten-in-traversal-order contract for the text tree.
 */
import { SourcesRpc } from '../rpc/sources-rpc.js';

/** A `SourcesRpc` whose client returns `result` for every call, recording the params. */
function rpcReturning(result: unknown) {
  const calls: Array<{ method: string; params: unknown; path: string }> = [];
  const client = {
    call: async (method: string, params: unknown, path: string) => {
      calls.push({ method, params, path });
      return result;
    },
  };
  // Only `call` is exercised here; the rest of BatchExecuteClient is irrelevant.
  return { sources: new SourcesRpc(client as never), calls };
}

/** `[descriptor, ?, ?, textBlock, htmlBlock]` — descriptor is `[idEnvelope, title, metadata]`. */
function envelope(title: string, body: unknown, html: unknown) {
  return [[['src-1'], title, []], null, null, [body], [null, html]];
}

const NB = '11111111-2222-3333-4444-555555555555';

describe('SourcesRpc.getSourceFulltext', () => {
  it('flattens the text document tree in traversal order', async () => {
    const body = [['Heading'], [['A paragraph.', ' Continued.'], ['Second paragraph.']]];
    const { sources } = rpcReturning(envelope('Paper.pdf', body, '<p>ignored</p>'));

    const out = await sources.getSourceFulltext(NB, 'src-1');
    expect(out).toEqual({
      id: 'src-1',
      title: 'Paper.pdf',
      content: 'Heading\nA paragraph.\n Continued.\nSecond paragraph.',
      charCount: 'Heading\nA paragraph.\n Continued.\nSecond paragraph.'.length,
    });
  });

  it('sends the text render selectors and scopes the call to the notebook', async () => {
    const { sources, calls } = rpcReturning(envelope('t', ['x'], '<p>x</p>'));
    await sources.getSourceFulltext(NB, 'src-1');
    expect(calls[0].method).toBe('GET_SOURCE');
    expect(calls[0].params).toEqual([['src-1'], [2], [2]]);
    expect(calls[0].path).toBe(`/notebook/${NB}`);
  });

  it('asks for the HTML rendition and reads it at result[4][1]', async () => {
    const { sources, calls } = rpcReturning(envelope('t', ['text side'], '<h1>Title</h1>'));
    const out = await sources.getSourceFulltext(NB, 'src-1', 'html');
    expect(calls[0].params).toEqual([['src-1'], [3], [3]]);
    expect(out?.content).toBe('<h1>Title</h1>');
  });

  it('drops whitespace-only leaves rather than emitting blank lines', async () => {
    const { sources } = rpcReturning(envelope('t', ['a', '', [' ', '   \n ', 'b']], null));
    expect((await sources.getSourceFulltext(NB, 'src-1'))?.content).toBe('a\nb');
  });

  it('keeps the spacing inside a leaf that does carry text', async () => {
    const { sources } = rpcReturning(envelope('t', [' Chapter One ', '  indented'], null));
    expect((await sources.getSourceFulltext(NB, 'src-1'))?.content).toBe(
      ' Chapter One \n  indented'
    );
  });

  it('returns null when the source carries no content in the requested rendition', async () => {
    const { sources } = rpcReturning(envelope('t', [], null));
    expect(await sources.getSourceFulltext(NB, 'src-1')).toBeNull();
    const html = rpcReturning(envelope('t', ['text is there'], null));
    expect(await html.sources.getSourceFulltext(NB, 'src-1', 'html')).toBeNull();
  });

  it('degrades to an empty title instead of failing on a truncated envelope', async () => {
    const { sources } = rpcReturning([null, null, null, [['only text']]]);
    const out = await sources.getSourceFulltext(NB, 'src-1');
    expect(out?.title).toBe('');
    expect(out?.content).toBe('only text');
  });

  it('returns null when the response is not an envelope at all', async () => {
    const { sources } = rpcReturning(null);
    expect(await sources.getSourceFulltext(NB, 'src-1')).toBeNull();
  });
});
