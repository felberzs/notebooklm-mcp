/**
 * Unit tests for the batchexecute RPC transport's pure pieces (no network):
 * response parsing + rpc-id override resolution.
 */
import { parseBatchExecute, RpcServerError } from '../rpc/batchexecute.js';
import { resolveRpcId, resolveBuildLabel, RPC_IDS, BL_FALLBACK } from '../rpc/rpc-ids.js';

describe('parseBatchExecute', () => {
  const wrap = (id: string, innerJson: string) =>
    `)]}'\n\n${innerJson.length}\n[["wrb.fr","${id}",${JSON.stringify(innerJson)},null,null,null,"generic"]]\n`;

  it('extracts and JSON-parses the inner payload for the matching rpc id', () => {
    const resp = wrap('wXbhsf', '[["My Notebook",null,"uuid-123"]]');
    const out = parseBatchExecute(resp, 'wXbhsf');
    expect(out).toEqual([['My Notebook', null, 'uuid-123']]);
  });

  it('returns undefined when no envelope matches the id (rotated/drifted id)', () => {
    const resp = wrap('someOtherId', '[["x"]]');
    expect(parseBatchExecute(resp, 'wXbhsf')).toBeUndefined();
  });

  it('throws RpcServerError on an "er" error envelope', () => {
    const resp = `)]}'\n\n10\n[["er",null,null,null,null,400]]\n`;
    expect(() => parseBatchExecute(resp, 'wXbhsf')).toThrow(RpcServerError);
  });

  it('tolerates the anti-XSSI prefix and numeric chunk-size lines', () => {
    const resp = wrap('CCqFvf', '["ok",null,"new-id"]');
    expect(parseBatchExecute(resp, 'CCqFvf')).toEqual(['ok', null, 'new-id']);
  });
});

describe('resolveRpcId', () => {
  const orig = process.env.NOTEBOOKLM_RPC_OVERRIDES;
  afterEach(() => {
    if (orig === undefined) delete process.env.NOTEBOOKLM_RPC_OVERRIDES;
    else process.env.NOTEBOOKLM_RPC_OVERRIDES = orig;
  });

  it('returns the built-in id when no override is set', () => {
    delete process.env.NOTEBOOKLM_RPC_OVERRIDES;
    expect(resolveRpcId('LIST_NOTEBOOKS')).toBe(RPC_IDS.LIST_NOTEBOOKS);
  });

  it('applies a matching override', () => {
    process.env.NOTEBOOKLM_RPC_OVERRIDES = JSON.stringify({ LIST_NOTEBOOKS: 'newId42' });
    expect(resolveRpcId('LIST_NOTEBOOKS')).toBe('newId42');
    expect(resolveRpcId('CREATE_NOTEBOOK')).toBe(RPC_IDS.CREATE_NOTEBOOK);
  });

  it('ignores malformed override JSON and falls back to the built-in id', () => {
    process.env.NOTEBOOKLM_RPC_OVERRIDES = '{not json';
    expect(resolveRpcId('LIST_NOTEBOOKS')).toBe(RPC_IDS.LIST_NOTEBOOKS);
  });
});

describe('resolveBuildLabel', () => {
  const orig = process.env.NOTEBOOKLM_BL;
  afterEach(() => {
    if (orig === undefined) delete process.env.NOTEBOOKLM_BL;
    else process.env.NOTEBOOKLM_BL = orig;
  });

  it('prefers the env override, else the fallback constant', () => {
    delete process.env.NOTEBOOKLM_BL;
    expect(resolveBuildLabel()).toBe(BL_FALLBACK);
    process.env.NOTEBOOKLM_BL = 'boq_custom_123';
    expect(resolveBuildLabel()).toBe('boq_custom_123');
  });
});
