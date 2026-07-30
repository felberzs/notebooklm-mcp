/**
 * Unit tests for the streaming query-response parser (no network).
 * The deep citation extraction is covered end-to-end by live verification;
 * these lock the chunk-walking, answer selection, and error path.
 */
import { parseQueryResponse, QueryRejectedError } from '../rpc/query-rpc.js';

/** Build a `)]}'`-prefixed, byte-count-chunked streaming body from JSON chunks. */
function wireStream(...chunks: unknown[]): string {
  let out = ")]}'\n";
  for (const c of chunks) {
    const line = JSON.stringify(c);
    out += `${line.length}\n${line}\n`;
  }
  return out;
}

/** A `wrb.fr` answer envelope. `typeCode` 1=answer, 2=thinking; `passages` at typeInfo[3]. */
function answerChunk(text: string, typeCode: number, convId = 'conv-1', passages: unknown = null) {
  const typeInfo = [[], null, null, passages, typeCode];
  const firstElem = [text, null, [convId], null, typeInfo];
  return [['wrb.fr', null, JSON.stringify([firstElem])]];
}

describe('parseQueryResponse', () => {
  it('returns the longest type-1 answer and its conversation id', () => {
    const resp = wireStream(
      answerChunk('short', 1),
      answerChunk('a much longer and complete answer', 1, 'conv-XYZ'),
      answerChunk('thinking step that is very very long...', 2)
    );
    const { answer, serverConvId } = parseQueryResponse(resp);
    expect(answer).toBe('a much longer and complete answer');
    expect(serverConvId).toBe('conv-XYZ');
  });

  it('falls back to thinking text when no type-1 answer exists', () => {
    const resp = wireStream(answerChunk('only thinking here', 2));
    expect(parseQueryResponse(resp).answer).toBe('only thinking here');
  });

  it('extracts a structured citation (source id + cited text)', () => {
    // passage = [[pid], detail]; detail[5][0][0][0] = source id; detail[4] = text segments.
    const detail = [
      null,
      null,
      null,
      null,
      [[0, 5, [[[0, 0, 'the cited passage']]]]],
      [[['SRC-1']]],
    ];
    const passages = [[['p0'], detail]];
    const resp = wireStream(answerChunk('answer with a citation', 1, 'c1', passages));
    const { citation } = parseQueryResponse(resp);
    expect(citation.sourcesUsed).toEqual(['SRC-1']);
    expect(citation.citations[1]).toBe('SRC-1');
    expect(citation.references[0]).toMatchObject({
      source_id: 'SRC-1',
      citation_number: 1,
      cited_text: 'the cited passage',
    });
  });

  it('throws QueryRejectedError when the only content is a server error', () => {
    const resp = wireStream([['wrb.fr', null, null, null, null, [3]]]);
    expect(() => parseQueryResponse(resp)).toThrow(QueryRejectedError);
  });
});
