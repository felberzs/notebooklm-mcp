/**
 * Source management over the internal `batchexecute` RPC API.
 *
 * Add (URL / YouTube / text) and delete sources. The add RPC returns the new
 * source id directly, so there is no post-upload polling / false-negative like
 * the DOM flow. Payloads verified against NotebookLM (2026-07).
 */

import { BatchExecuteClient, RpcError } from './batchexecute.js';

export interface RpcSource {
  id: string;
  title: string;
}

/** Parse the source-creation result: `result[0][0]` → `[0][0]`=id, `[1]`=title. */
function parseSourceResult(result: unknown): RpcSource | null {
  const list = Array.isArray(result) ? (result[0] as unknown) : undefined;
  const first = Array.isArray(list) ? (list[0] as unknown) : undefined;
  if (!Array.isArray(first)) return null;
  const idHolder = first[0];
  const id = Array.isArray(idHolder) ? (idHolder[0] as string) : undefined;
  if (typeof id !== 'string') return null;
  const title = typeof first[1] === 'string' ? first[1] : 'Untitled';
  return { id, title };
}

const CREATE_TAIL = [1, null, null, null, null, null, null, null, null, null, [1]];

export class SourcesRpc {
  /** Cached URL-add rollout version ('v1' | 'v2') once discovered. */
  private urlVersion: 'v1' | 'v2' | null = null;

  constructor(private readonly client: BatchExecuteClient) {}

  /** Add a URL (or YouTube) source. Tries the legacy izAoDd RPC, falls back to the new ozz5Z rollout. */
  async addUrlSource(notebookId: string, url: string): Promise<RpcSource | null> {
    const path = `/notebook/${notebookId}`;
    const runV1 = () => this.client.call('ADD_SOURCE', this.urlParamsV1(notebookId, url), path);
    const runV2 = () => this.client.call('ADD_SOURCE_URL_V2', this.urlParamsV2(url), path);

    let result: unknown;
    if (this.urlVersion === 'v2') {
      result = await runV2();
    } else if (this.urlVersion === 'v1') {
      result = await runV1();
    } else {
      // First call: try v1, fall back to v2 on failure; cache the winner.
      try {
        result = await runV1();
        this.urlVersion = 'v1';
      } catch (e) {
        if (!(e instanceof RpcError)) throw e;
        result = await runV2();
        this.urlVersion = 'v2';
      }
    }
    return parseSourceResult(result);
  }

  /** Add a pasted-text source. */
  async addTextSource(notebookId: string, title: string, text: string): Promise<RpcSource | null> {
    const sourceData = [
      null,
      [title || 'Pasted Text', text],
      null,
      2,
      null,
      null,
      null,
      null,
      null,
      null,
      1,
    ];
    const params = [[sourceData], notebookId, [2], CREATE_TAIL];
    const result = await this.client.call('ADD_SOURCE', params, `/notebook/${notebookId}`);
    return parseSourceResult(result);
  }

  /** Delete a source from a notebook. */
  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    await this.client.call('DELETE_SOURCE', [[[sourceId]], [2]], `/notebook/${notebookId}`);
  }

  private urlParamsV1(notebookId: string, url: string): unknown {
    const isYoutube = /youtube\.com|youtu\.be/i.test(url);
    const sourceData = isYoutube
      ? [null, null, null, null, null, null, null, [url], null, null, 1]
      : [null, null, [url], null, null, null, null, null, null, null, 1];
    return [[sourceData], notebookId, [2], CREATE_TAIL];
  }

  private urlParamsV2(url: string): unknown {
    const sourceData = [
      [null, url, 627],
      [null, null, null, null, null, null, null, null, null, [null, null, 1]],
      1,
    ];
    return [[sourceData]];
  }
}
