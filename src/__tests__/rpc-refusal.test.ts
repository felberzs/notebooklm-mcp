/**
 * Telling a refusal apart from a rotated RPC id (no network).
 *
 * Both used to surface as "the id likely rotated", which sent people hunting
 * for a replacement id that did not exist — twice, in #35. A refusal carries an
 * envelope for the id with a gRPC status at index 5; a rotated id carries no
 * envelope at all. These lock that distinction.
 */
import { describe, it, expect } from '@jest/globals';
import { parseBatchExecute, RpcStatusRefusal, RpcServerError } from '../rpc/batchexecute.js';

/** Build a chunked, anti-XSSI-prefixed batchexecute body from envelopes. */
function wire(...envelopes: unknown[]): string {
  const line = JSON.stringify(envelopes);
  return `)]}'\n\n${line.length}\n${line}\n`;
}

describe('parseBatchExecute', () => {
  it('returns the decoded payload when the call succeeded', () => {
    const body = wire([
      'wrb.fr',
      'R7cb6c',
      JSON.stringify([{ ok: true }]),
      null,
      null,
      null,
      'generic',
    ]);
    expect(parseBatchExecute(body, 'R7cb6c')).toEqual([{ ok: true }]);
  });

  it('throws a refusal carrying the status when the envelope holds one', () => {
    // The exact shape captured live from a PERMISSION_DENIED CREATE_STUDIO.
    const body = wire(
      ['wrb.fr', 'R7cb6c', null, null, null, [7], 'generic'],
      ['di', 326],
      ['af.httprm', 326, '6592325297545635795', 17]
    );
    expect(() => parseBatchExecute(body, 'R7cb6c')).toThrow(RpcStatusRefusal);
    try {
      parseBatchExecute(body, 'R7cb6c');
    } catch (e) {
      expect((e as RpcStatusRefusal).status).toBe(7);
    }
  });

  it('reports undefined — not a refusal — when no envelope for the id is present', () => {
    const body = wire(['wrb.fr', 'someOtherId', JSON.stringify([1]), null, null, null, 'generic']);
    expect(parseBatchExecute(body, 'R7cb6c')).toBeUndefined();
  });

  it('returns null for an envelope that is present, empty, and not an error', () => {
    const body = wire(['wrb.fr', 'R7cb6c', null, null, null, null, 'generic']);
    expect(parseBatchExecute(body, 'R7cb6c')).toBeNull();
  });

  it('treats status 0 as success-shaped, not a refusal', () => {
    const body = wire(['wrb.fr', 'R7cb6c', null, null, null, [0], 'generic']);
    expect(parseBatchExecute(body, 'R7cb6c')).toBeNull();
  });

  it('still surfaces an `er` server-error envelope', () => {
    const body = wire(['er', 'boom']);
    expect(() => parseBatchExecute(body, 'R7cb6c')).toThrow(RpcServerError);
  });
});
