/**
 * Notebook sharing over the internal RPC API (extension — not in the DOM tool).
 * Toggle the public link and read share status. Payloads verified as interop
 * facts against the reference impl.
 */

import { BatchExecuteClient } from './batchexecute.js';
import { NOTEBOOK_PRIMARY_HOST } from '../utils/notebook-domain.js';

const ACCESS_RESTRICTED = 0;
const ACCESS_PUBLIC = 1;

export interface ShareCollaborator {
  email: string;
  name?: string;
}

export interface ShareStatus {
  isPublic: boolean;
  publicLink?: string;
  collaborators: ShareCollaborator[];
}

export class SharingRpc {
  constructor(private readonly client: BatchExecuteClient) {}

  /**
   * Current sharing status. Verified payload shape:
   *   `[[[email, role, [], [name, avatar]], …], publicFlag, …]`
   *   publicFlag = `null` when restricted, `[true]` when the public link is on.
   */
  async getStatus(notebookId: string): Promise<ShareStatus> {
    const result = (await this.client.call('GET_SHARE_STATUS', [notebookId, [2]])) as unknown[];
    const isPublic = Array.isArray(result?.[1]) && (result[1] as unknown[])[0] === true;
    const rawCollabs = Array.isArray(result?.[0]) ? (result[0] as unknown[]) : [];
    const collaborators: ShareCollaborator[] = [];
    for (const c of rawCollabs) {
      if (!Array.isArray(c) || typeof c[0] !== 'string') continue;
      const nameArr = Array.isArray(c[3]) ? (c[3] as unknown[]) : [];
      collaborators.push({
        email: c[0],
        name: typeof nameArr[0] === 'string' ? nameArr[0] : undefined,
      });
    }
    return {
      isPublic,
      publicLink: isPublic ? `https://${NOTEBOOK_PRIMARY_HOST}/notebook/${notebookId}` : undefined,
      collaborators,
    };
  }

  /** Enable or disable the public link. Returns the public URL when enabled. */
  async setPublic(notebookId: string, isPublic: boolean): Promise<string | null> {
    const code = isPublic ? ACCESS_PUBLIC : ACCESS_RESTRICTED;
    await this.client.call('SHARE_NOTEBOOK', [[[notebookId, null, [code], [0, '']]], 1, null, [2]]);
    return isPublic ? `https://${NOTEBOOK_PRIMARY_HOST}/notebook/${notebookId}` : null;
  }
}
