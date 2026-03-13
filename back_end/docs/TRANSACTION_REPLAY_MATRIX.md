# Transaction Replay Matrix

Dokumen ini memetakan endpoint side-effect yang sudah dibuktikan replay-safe, second-action reject, atau masih contract limitation.

| Endpoint / Flow | Replay Expectation | Current Result | Evidence |
|---|---|---|---|
| Issue invoice | same key replays same invoice | `REPLAY-SAFE` | `ST-025` |
| Issue invoice by items | same key replays same invoice | `REPLAY-SAFE` | `ST-025` |
| Checkout | same key replays same order | `REPLAY-SAFE` | `ST-011` |
| Verify payment | second approve rejected, no duplicate journal | `REJECT-CLEAN` | `ST-017` |
| Verify driver COD | same key replay, no duplicate settlement/journal | `REPLAY-SAFE` | `ST-012`, `ST-018` |
| Driver record COD payment | often no-op because invoice already `cod_pending` | `CONTRACT LIMITATION` | `ST-019` |
| Retur refund | second disburse rejected, no duplicate journal | `REJECT-CLEAN` | `ST-020` |
| Expense pay | second action rejected/no duplicate journal | `REJECT-CLEAN` | `ST-025` |
| Expense label create/update/delete | duplicate mutation rejected cleanly | `REJECT-CLEAN` | `ST-025` |
| Adjustment journal | same key replays, no duplicate journal | `REPLAY-SAFE` | `ST-025` |
| Period close | second close rejected cleanly | `REJECT-CLEAN` | `ST-025` |
| Credit note post | second post rejected, no duplicate journal | `REJECT-CLEAN` | `ST-025` |
| Invoice void | same key replays, no duplicate journal | `REPLAY-SAFE` | `ST-025` |
| Supplier invoice pay | second action rejected, no duplicate journal | `REJECT-CLEAN` | `ST-025` |

## Gaps
- belum semua endpoint side-effect di seluruh sistem punya replay proof
- endpoint baru tidak boleh dianggap replay-safe sebelum masuk matrix ini
