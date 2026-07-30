/**
 * Ask (query) a notebook over the internal streaming query endpoint
 * (`GenerateFreeFormStreamed`), with structured citation extraction.
 *
 * The answer AND its citations (source id + citation number + the cited passage
 * text) come back in the response payload — cleaner and more reliable than the
 * DOM approach (clicking citation markers and reading highlighted spans).
 *
 * Nested-array navigation ported from the reference impl
 * (jacob-bd/gemini-notebook-mcp-cli). Shapes are interop facts.
 */

import { randomUUID } from 'crypto';
import { BatchExecuteClient } from './batchexecute.js';
import { NotebookRpc } from './notebooks-rpc.js';

export interface RpcReference {
  source_id: string;
  citation_number: number;
  cited_text?: string;
}

export interface RpcAnswer {
  answer: string;
  conversationId: string | null;
  sourcesUsed: string[];
  citations: Record<number, string>; // citation number → source id
  references: RpcReference[];
}

export class QueryRejectedError extends Error {
  constructor(readonly code: number) {
    super(`NotebookLM rejected the query (error code ${code})`);
    this.name = 'QueryRejectedError';
  }
}

export class QueryRpc {
  constructor(
    private readonly client: BatchExecuteClient,
    private readonly notebooks: NotebookRpc
  ) {}

  /**
   * Ask a question against a notebook. `sourceIds` defaults to all sources.
   * Stateless by default (fresh conversation id); pass `conversationId` to
   * continue a thread (history is not yet re-sent — Phase 3 covers single-turn).
   */
  async ask(
    notebookId: string,
    question: string,
    opts: { sourceIds?: string[]; conversationId?: string } = {}
  ): Promise<RpcAnswer> {
    const sourceIds = opts.sourceIds ?? (await this.notebooks.getSourceIds(notebookId));
    const conversationId = opts.conversationId ?? randomUUID();
    const sourcesArray = sourceIds.map((id) => [[id]]);
    const params = [sourcesArray, question, null, [2, null, [1]], conversationId];

    const text = await this.client.postQueryStreamed(params);
    const { answer, citation, serverConvId } = parseQueryResponse(text);

    return {
      answer,
      conversationId: serverConvId || conversationId,
      sourcesUsed: citation.sourcesUsed,
      citations: citation.citations,
      references: citation.references,
    };
  }
}

interface CitationData {
  sourcesUsed: string[];
  citations: Record<number, string>;
  references: RpcReference[];
}
const EMPTY_CITATION: CitationData = { sourcesUsed: [], citations: {}, references: [] };

/**
 * Parse the streamed query response: pick the longest type-1 (answer) chunk,
 * with its citations. Throws {@link QueryRejectedError} if the only content is
 * a server error. Pure (no network) — unit-testable.
 */
export function parseQueryResponse(text: string): {
  answer: string;
  citation: CitationData;
  serverConvId: string | null;
} {
  let body = text;
  if (body.startsWith(")]}'")) body = body.slice(4);
  const lines = body.trim().split('\n');

  let longestAnswer = '';
  let longestThinking = '';
  let citation: CitationData = EMPTY_CITATION;
  let serverConvId: string | null = null;
  let firstError: number | null = null;

  const processChunk = (jsonLine: string) => {
    const err = extractErrorFromChunk(jsonLine);
    if (err !== null) {
      if (firstError === null) firstError = err;
      return;
    }
    const { text: t, isAnswer, cdata, convId } = extractAnswerFromChunk(jsonLine);
    if (!t) return;
    if (isAnswer && t.length > longestAnswer.length) {
      longestAnswer = t;
      if (cdata) citation = cdata;
      if (convId) serverConvId = convId;
    } else if (!isAnswer && t.length > longestThinking.length) {
      longestThinking = t;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^\d+$/.test(line)) {
      i++;
      if (i < lines.length) processChunk(lines[i]);
    } else {
      processChunk(line);
    }
  }

  const answer = longestAnswer || longestThinking;
  if (!answer && firstError !== null) throw new QueryRejectedError(firstError);
  return { answer, citation, serverConvId };
}

/** Detect a server error envelope `["wrb.fr", null, null, null, null, [code, …]]`. Returns the code or null. */
function extractErrorFromChunk(jsonStr: string): number | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (!Array.isArray(item) || item.length < 6) continue;
    if (item[0] !== 'wrb.fr' || item[2] !== null) continue;
    const info = item[5];
    if (Array.isArray(info) && typeof info[0] === 'number') return info[0];
  }
  return null;
}

/** Extract answer text, citation data, and server conversation id from one chunk. */
function extractAnswerFromChunk(jsonStr: string): {
  text: string | null;
  isAnswer: boolean;
  cdata: CitationData | null;
  convId: string | null;
} {
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return { text: null, isAnswer: false, cdata: null, convId: null };
  }
  if (!Array.isArray(data)) return { text: null, isAnswer: false, cdata: null, convId: null };

  for (const item of data) {
    if (!Array.isArray(item) || item.length < 3 || item[0] !== 'wrb.fr') continue;
    if (typeof item[2] !== 'string') continue;
    let inner: unknown;
    try {
      inner = JSON.parse(item[2]);
    } catch {
      continue;
    }
    if (!Array.isArray(inner) || inner.length === 0) continue;
    const first = inner[0];
    if (Array.isArray(first) && first.length > 0) {
      const answerText = first[0];
      if (typeof answerText !== 'string') continue;
      let isAnswer = false;
      let cdata: CitationData | null = null;
      let convId: string | null = null;
      if (Array.isArray(first[2]) && typeof first[2][0] === 'string') convId = first[2][0];
      if (Array.isArray(first[4])) {
        const typeInfo = first[4] as unknown[];
        if (typeof typeInfo[typeInfo.length - 1] === 'number') {
          isAnswer = typeInfo[typeInfo.length - 1] === 1;
        }
        if (isAnswer) cdata = extractCitationData(typeInfo);
      }
      return { text: answerText, isAnswer, cdata, convId };
    }
    if (typeof first === 'string')
      return { text: first, isAnswer: false, cdata: null, convId: null };
  }
  return { text: null, isAnswer: false, cdata: null, convId: null };
}

/** Passages at typeInfo[3]; per passage: source id at detail[5][0][0][0], cited text via detail[4]. */
function extractCitationData(typeInfo: unknown[]): CitationData {
  const passages = Array.isArray(typeInfo[3]) ? (typeInfo[3] as unknown[]) : null;
  if (!passages || passages.length === 0) return EMPTY_CITATION;

  const citations: Record<number, string> = {};
  const seen = new Set<string>();
  const references: RpcReference[] = [];

  passages.forEach((passage, i) => {
    if (!Array.isArray(passage) || passage.length < 2) return;
    const detail = passage[1];
    if (!Array.isArray(detail) || detail.length < 6) return;
    const ref = detail[5];
    const firstRef = Array.isArray(ref) ? ref[0] : undefined;
    const idWrapper = Array.isArray(firstRef) ? firstRef[0] : undefined;
    const sourceId = Array.isArray(idWrapper) ? idWrapper[0] : undefined;
    if (typeof sourceId !== 'string') return;
    const n = i + 1;
    citations[n] = sourceId;
    seen.add(sourceId);
    const citedText = extractCitedText(detail);
    references.push({
      source_id: sourceId,
      citation_number: n,
      ...(citedText ? { cited_text: citedText } : {}),
    });
  });

  if (Object.keys(citations).length === 0) return EMPTY_CITATION;
  return { sourcesUsed: [...seen], citations, references };
}

/** Concatenate the cited passage text from detail[4] (text segments; tables get a placeholder). */
function extractCitedText(detail: unknown[]): string | null {
  if (detail.length <= 4 || !Array.isArray(detail[4])) return null;
  const texts: string[] = [];
  for (const element of detail[4] as unknown[]) {
    if (!Array.isArray(element) || element.length === 0) continue;
    const segments = typeof element[0] === 'number' ? [element] : (element as unknown[]);
    for (const segment of segments) {
      if (!Array.isArray(segment) || segment.length < 3) continue;
      if (typeof segment[0] !== 'number') continue;
      const nested = segment[2];
      if (!Array.isArray(nested)) {
        if (Array.isArray(segment[4])) texts.push('<cited_table>');
        continue;
      }
      for (const group of nested) {
        if (!Array.isArray(group)) continue;
        for (const inner of group) {
          if (!Array.isArray(inner) || inner.length < 3) continue;
          const val = inner[2];
          if (typeof val === 'string' && val.trim()) texts.push(val.trim());
          else if (Array.isArray(val)) {
            for (const it of val) if (typeof it === 'string' && it.trim()) texts.push(it.trim());
          }
        }
      }
    }
  }
  return texts.length ? texts.join(' ') : null;
}
