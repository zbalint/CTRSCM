# OMP Shake compared with CTRSCM (default values)

A reference, not a spec. It maps the values OMP (oh-my-pi) uses for Shake and for the compaction that triggers it
onto the CTRSCM options, using **OMP's built-in defaults** and **CTRSCM's built-in defaults**
(`DEFAULT_CONFIG` in `hooks/config.ts`). Nobody's personal configuration is shown.

Source for OMP: `can1357/oh-my-pi` at `693fd6e12b` (the commit `docs/architecture.md` pins):
`packages/agent/src/compaction/shake.ts`, `compaction.ts`, `packages/coding-agent/src/session/session-maintenance.ts`,
`context-settings.ts`, `compaction-methods.ts`. Written 2026-10-10. Re-check against a newer OMP before relying on a value.

## 1. What a pass does

| What | OMP value | CTRSCM option | CTRSCM default | Note |
| --- | --- | --- | --- | --- |
| Newest context kept intact (automatic) | `protectTokens` 16,000 | `protectTokens` | 16,000 | Same. Both count estimated tokens. |
| Savings a pass must reach (automatic) | `minSavings` 4,000 | `minSavings` | 4,000 | Same. A pass below it does nothing. |
| Newest context kept intact (manual `/shake`) | `protectTokens` 4,000 | `aggressiveProtectTokens` | 4,000 | Same. |
| Savings a pass must reach (manual `/shake`) | `minSavings` 0 | none (the aggressive pass ignores `minSavings`, spec 18) | n/a | Same since spec 18. |
| Recent typed user turns protected | none found | `protectTurns` | 0 (off) | CTRSCM only. `/shake` ignores it. |
| Protected tools | `skill`, skill reads, artifact-recovery reads | `protectedTools` | `Skill` | CTRSCM protects its own recovery tool by construction. |
| Smallest tool result worth shaking | none found | `minResultTokens` | 1,000 | CTRSCM only. |
| Large fenced and XML blocks in prose | elided (`fenceMinTokens` 400) | none | n/a | CTRSCM never rewrites user or assistant text (`AGENTS.md`, product invariants). |
| Rescue pass (`protectTokens` 0) | exists, for a compaction dead end | none | n/a | Not adopted. |
| Placeholder cost used in the savings gate | 16 tokens | `PLACEHOLDER_TOKEN_ESTIMATE` in `hooks/shake.ts` (a constant, not an option) | 40 | Estimates only. |
| Where the removed text goes | artifact via `artifact://` | artifact directory, read back with the recovery tool | n/a | Different mechanism, same recoverability goal. |

## 2. When a pass runs

| What | OMP value | CTRSCM option | CTRSCM default | Note |
| --- | --- | --- | --- | --- |
| Automatic trigger, by size | context above the window minus a reserve of at least 15% of the window (`compaction.thresholdPercent` and `thresholdTokens` default to `-1`, which means this derived threshold; `reserveTokens` default 16,384) | `triggerTokens` | 120,000 | OMP's value scales with the window: about 231,000 on a 272,000 window and 850,000 on 1,000,000. CTRSCM's is a fixed number. |
| Automatic trigger, by percent | same derived threshold | `triggerPercent` | 50 | |
| When it is checked | after each assistant turn, plus an overflow retry path | `session.measure`, after each model response | n/a | CTRSCM checks more often. |
| What happens when the pass is too small | context still above 80% of the threshold (`COMPACTION_RECOVERY_BAND` 0.8): the next method in `compaction.methodOrder` runs | `fallback` (`builtin` or `skip`) | `builtin` | OMP's default order is `remote`, `snapcompact`, `handoff`, `shake`, `soft`. CTRSCM has a single step. |
| Repeat control | none needed: a pass that does not clear the band falls through, one that does leaves the context well below the threshold | `cooldownTurns` | 3 | CTRSCM decrements per `session.measure` event, not per turn (backlog B30). |
| Idle | `compaction.idleEnabled` off, `idleThresholdTokens` 200,000, `idleTimeoutSeconds` 300; it runs the compaction chain, not a bare shake | `idleShakeMinutes` | 0 (off) | Different idea. CTRSCM's idle shake waits for the prompt cache to go cold and ignores `minSavings`. |
| Cache-aware flush after idle | `PRUNE_IDLE_FLUSH_MS` 90 minutes (prune pass, not Shake) | none | n/a | OMP picks a value above the 1-hour cache TTL. |
| Advice toast | none found | `adviseTokens` | 150,000 | CTRSCM only. |
| Manual command | `/shake` | `/shake` | n/a | |

## 3. Reading the table

- The values that decide **what** a pass removes (protect size, savings gate, aggressive protect size) are the same in both.
- The values that decide **when** it runs differ in kind. OMP waits until the window is nearly full and then
  falls through to other methods if the pass is not enough. CTRSCM triggers early at a fixed size and never summarizes,
  so a pass that finds nothing worth shaking leaves the context as it is.
- OMP's own passes are therefore few and large. CTRSCM's can be frequent and small unless `minSavings` and the
  cooldown are tuned for the sessions it runs in.
