/**
 * RPC-only extensions the DOM tool never exposed: mind maps and source labels.
 * Payloads/offsets are interop facts (ported, independent TS reimpl).
 */

import { BatchExecuteClient } from './batchexecute.js';

export interface MindMapResult {
  mindMapId: string | null;
  title: string;
  json: string;
}

export class MindMapRpc {
  constructor(private readonly client: BatchExecuteClient) {}

  /** Generate a mind map from sources, then persist it. Returns id + JSON. */
  async generateAndSave(
    notebookId: string,
    sourceIds: string[],
    title = 'Mind Map'
  ): Promise<MindMapResult> {
    const sourcesNested = sourceIds.map((id) => [[id]]);
    const genParams = [
      sourcesNested,
      null,
      null,
      null,
      null,
      ['interactive_mindmap', [['[CONTEXT]', '']], ''],
      null,
      [2, null, [1]],
    ];
    const gen = (await this.client.call('GENERATE_MIND_MAP', genParams)) as unknown;
    const genInner = Array.isArray((gen as unknown[])?.[0])
      ? ((gen as unknown[])[0] as unknown[])
      : [];
    const json = typeof genInner[0] === 'string' ? genInner[0] : '';
    if (!json) throw new Error('mind map generation returned no JSON');

    const sourcesSimple = sourceIds.map((id) => [id]);
    const metadata = [2, null, null, 5, sourcesSimple];
    const saveParams = [notebookId, json, metadata, null, title];
    const saved = (await this.client.call(
      'SAVE_MIND_MAP',
      saveParams,
      `/notebook/${notebookId}`
    )) as unknown;
    const savedInner = Array.isArray((saved as unknown[])?.[0])
      ? ((saved as unknown[])[0] as unknown[])
      : [];
    const mindMapId = typeof savedInner[0] === 'string' ? savedInner[0] : null;
    return { mindMapId, title, json };
  }
}

export interface Label {
  id: string;
  name: string;
  emoji?: string;
  sourceCount: number;
}

export class LabelsRpc {
  constructor(private readonly client: BatchExecuteClient) {}

  /** List labels. Raw: `result[1] = [[name, [[srcId],…], labelId, emoji], …]`. */
  async list(notebookId: string): Promise<Label[]> {
    const result = (await this.client.call(
      'LABEL_MANAGE',
      [[2], notebookId, null, null, []],
      `/notebook/${notebookId}`
    )) as unknown;
    return parseLabels(result);
  }

  /** Create a label. Returns the updated label list. */
  async create(notebookId: string, name: string, emoji = ''): Promise<Label[]> {
    const result = (await this.client.call(
      'LABEL_MANAGE',
      [[2], notebookId, null, null, null, [[name, emoji]]],
      `/notebook/${notebookId}`
    )) as unknown;
    return parseLabels(result);
  }

  /** Rename a label. */
  async rename(notebookId: string, labelId: string, newName: string): Promise<void> {
    await this.client.call(
      'LABEL_MUTATE',
      [[2], notebookId, labelId, [[[newName]]]],
      `/notebook/${notebookId}`
    );
  }

  /** Delete one or more labels. */
  async delete(notebookId: string, labelIds: string[]): Promise<void> {
    await this.client.call('LABEL_DELETE', [[2], notebookId, labelIds], `/notebook/${notebookId}`);
  }
}

function parseLabels(result: unknown): Label[] {
  const raw = Array.isArray((result as unknown[])?.[1])
    ? ((result as unknown[])[1] as unknown[])
    : [];
  const out: Label[] = [];
  for (const l of raw) {
    if (!Array.isArray(l)) continue;
    const name = typeof l[0] === 'string' ? l[0] : '';
    const sources = Array.isArray(l[1]) ? (l[1] as unknown[]) : [];
    const id = typeof l[2] === 'string' ? l[2] : '';
    const emoji = typeof l[3] === 'string' ? l[3] : undefined;
    if (!id) continue;
    out.push({ id, name, emoji, sourceCount: sources.length });
  }
  return out;
}
