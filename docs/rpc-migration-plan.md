# RPC migration plan — drive NotebookLM's internal API instead of the DOM

## Why

The tool automates NotebookLM through the browser DOM. Google's 2026-07 "Gemini
Notebook" rebrand rebuilt the entire UI and broke almost every operation (see
CHANGELOG 2.3.0). Browser automation is inherently fragile to redesigns, slow
(headless Chromium per op), and heavy.

NotebookLM's own web app talks to an **internal `batchexecute` RPC API**. Driving
those RPCs directly is:

- **Immune to UI redesigns** — the rebrand changed the DOM, not the RPCs.
- **10–100× faster** for metadata ops (no browser, no DOM waits) — hundreds of ms.
- **More correct** — e.g. RPC `LIST_NOTEBOOKS` returns all owned notebooks
  regardless of the homepage's view/filter state (the DOM scrape returned 0 on a
  filtered homepage that actually had 11 notebooks).

Trade-off: the RPCs are **undocumented and their method ids rotate**. We mitigate
with a runtime override (`NOTEBOOKLM_RPC_OVERRIDES`) and drift detection — exactly
as the reference implementation does.

**Hybrid design**: keep the browser **only** for interactive login (harvesting
cookies) + auto-reauth; do everything else over RPC. Keep our REST API,
multi-account, auto-reauth and tests on top — the differentiators the CLI/MCP-only
alternatives lack.

Protocol reference: the open-source `jacob-bd/gemini-notebook-mcp-cli` (Python).
RPC ids and wire format are interop facts; our transport is an independent TS
reimplementation.

## Wire format (implemented in `src/rpc/batchexecute.ts`)

- **Endpoint**: `POST https://{host}/_/LabsTailwindUi/data/batchexecute?rpcids={id}&source-path={path}&bl={bl}&hl={hl}&rt=c[&f.sid={sid}]`
- **Body**: `f.req=<urlenc([[[id, JSON(params), null, "generic"]]])>&at=<urlenc(csrf)>&`
- **Headers**: `Content-Type: application/x-www-form-urlencoded;charset=UTF-8`, `Origin`, `Referer`, `X-Same-Domain: 1`, `X-Goog-Csrf-Token`, `User-Agent`, `Cookie`.
- **Response**: `)]}'` prefix, then chunks; the payload is `["wrb.fr", id, "<inner-json>", …]`.
- **Tokens** bootstrapped from the authenticated homepage HTML: `SNlM0e`→csrf (`at`), `FdrFJe`→session (`f.sid`), `cfb2h`→build label (`bl`). `bl` also env-overridable; fallback constant in `rpc-ids.ts`.
- **File upload** (sources): separate resumable endpoint `https://{host}/upload/_/`.
- **`ask`/query**: a separate streaming (gRPC-style) endpoint with `_reqid` — NOT batchexecute.

## RPC map (`src/rpc/rpc-ids.ts`)

Notebooks: list `wXbhsf` · get `rLM1Ne` · create `CCqFvf` · rename `s0tc2d` · delete `WWINqb`
Sources: add `izAoDd` · add-url-v2 `ozz5Z` · add-file `o4cbdc` · get `hizoJc` · delete `tGMBJ` · rename `b7Wfje` · freshness `yR9Yof` · sync-drive `FLmJqe`
Chat: conversations `hPTbtc` · turns `khqZz` · delete-history `J7Gthc` · summary `VfAZjd` · source-guide `tr032e`
Research: fast `Ljjv0c` · deep `QA9ei` · poll `e3bVqc` · import `LBwxtb`
Studio: create(audio/video) `R7cb6c` · poll `gArtLc` · delete `V5N4be` · rename-artifact `rc3d8d` · interactive-html(quiz/flashcard) `v9rmvd` · revise-deck `KmcKPe`
Mind maps: gen `yyryJe` · save `CYK0Xb` · list `cFji9` · delete `AH0mwd`
Notes: create `CYK0Xb` · list `cFji9` · update `cYAfTb` · delete `AH0mwd`
Labels: manage `agX4Bc` · mutate `le8sX` · delete `GyzE7e`
Sharing: share `QDyure` · status `JFMDGd` · Export: to Docs/Sheets `Krh3pd`

Known payloads (verified live): list `[null,1,null,[2]]`; create `[title,null,null,[2],[1,…,[1]]]`→`result[2]`=id (sets title directly, no separate rename); delete `[[id],[2]]`; rename `[id,[[null,null,null,[null,title]]]]`. Studio create `[[null,null,TYPE,sources,null,null,options]]` then poll.

## Phases

| Phase | Scope                                                                                                                                                            | Est.    | Status                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| **0** | Transport (`batchexecute` client, rpc-ids + overrides, bootstrap, parse, drift) + unit tests + live proof                                                        | 2–3 d   | ✅ **done** (list/create/delete proven live, pure RPC) |
| 1     | Notebook CRUD handlers → RPC (list/get/create/rename/delete)                                                                                                     | 1–2 d   |                                                        |
| 2     | Sources → RPC (url v1/v2, text, file resumable upload, drive, get/delete/rename)                                                                                 | 3–4 d   |                                                        |
| 3     | `ask` → streaming query endpoint + structured citations (replaces DOM highlight extraction)                                                                      | 3–4 d   |                                                        |
| 4     | Studio generate ×6 → `R7cb6c` + type/options + poll `gArtLc` + status/media-url parse                                                                            | 3–5 d   |                                                        |
| 5     | list artifacts + download (media urls from poll; export `Krh3pd`)                                                                                                | 2–3 d   |                                                        |
| 6     | Wire into REST + MCP; keep browser login + AutoLoginManager for cookies; parity tests vs current                                                                 | 3–5 d   |                                                        |
| 7     | **Feature parity + expansion** (mind maps, flashcards, quiz, sharing, labels, research, cross-notebook) — cheap once transport exists: one rpc id + payload each | ongoing |                                                        |

Total ≈ 3–5 weeks to full parity; incremental wins from week 1 (Phase 0–1 already kill rebrand breakage on the most-used ops).

## Risks & mitigations

- **RPC-id rotation** → `NOTEBOOKLM_RPC_OVERRIDES` env hot-patch + `RpcDriftError` detection (a call with no matching envelope throws, pointing at the override). Add a startup health-check that pings `LIST_NOTEBOOKS` and alerts on drift.
- **v1/v2 rollout splits** (e.g. URL source `izAoDd`→`ozz5Z`) → try v2, fall back to v1, cache the winner.
- **`bl` build label** rotates → scraped live from the homepage each bootstrap; env override; dated fallback.
- **Undocumented / ToS** → same risk the reference impl accepts at scale; CDP transport (route RPC through the authenticated browser websocket) is an available fallback for legitimacy.
- **Auth** unchanged: cookies from our existing persistent context + auto-reauth; only the _use_ of those cookies moves from DOM to HTTP.

## Files

- `src/rpc/rpc-ids.ts` — RPC id constants, override + build-label resolution.
- `src/rpc/batchexecute.ts` — `BatchExecuteClient` (bootstrap + `call`) and the pure `parseBatchExecute`.
- `src/__tests__/rpc-batchexecute.test.ts` — parser + override unit tests.
