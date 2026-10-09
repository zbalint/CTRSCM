# Spec 10: the engine's compaction threshold and the live context in `/ctrscm`

## 0. Status

**LOCKED** (2026-10-06). Candidate named in `docs/usage.md` ("Claude Code's own threshold"); owner: "sounds useful". Not a backlog item of its own. Consultant review `m_672` applied (F2 to F6); gate record in section 7.

**Scope.** Edits: `hooks/status.ts`, `hooks/register.ts`, `tests/status.test.ts`, `tests/register.test.ts`. Does not touch: every other `hooks/*.ts`, `tests/*` other than the two named, `.claude-plugin/plugin.json`, `README.md`, `docs/*` and `AGENTS.md` (the architect edits `README.md` line 115, `docs/usage.md`, `docs/architecture.md`, `docs/backlog.md` after acceptance). No new dependency, no new file. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-engine-threshold`.
**Public test seams:** `statusText` (pure), and the registered `/ctrscm` command driven through `$` with `on('session.usage', ...)` answering the engine call.

## 1. Why

`/ctrscm` shows CTRSCM's own thresholds but not where the engine's automatic compaction sits, so nobody can tell whether `triggerTokens` fires before or after it. `docs/usage.md` records the figure as unmeasured for the default window and says `$.session.usage({ breakdown: "summary" })` returns `autoCompactThreshold` and `isAutoCompactEnabled` (`types/claude-code.d.ts` lines 8766 and 8770, in `SessionContextBreakdown`). CTRSCM does not read them. The owner also decided (2026-10-06) that the engine's own compaction stays the only backstop when Shake frees nothing more; this spec only reports, it changes no behavior of any trigger.

## 2. Decisions

- **D1. One engine call, only for the status command.** `/ctrscm` (not `/ctrscm report`, not `/shake`, not `session.measure`) calls `$.session.usage({ breakdown: 'summary' })` once per run. The `summary` detail estimates locally and sends no request (`types/claude-code.d.ts` lines 2411 to 2417 and 9240 to 9247), so the status command stays free. No other hook calls it.
- **D2. A pure view type in `hooks/status.ts`.**

  ```ts
  export type EngineStatus =
    | {
        kind: 'ok'
        window: number
        tokens?: number
        percent?: number
        autoCompact?: { isEnabled: boolean; threshold?: number }
      }
    | { kind: 'unavailable'; reason: string }
  ```

  `statusText` gains `engine: EngineStatus` as its LAST parameter. `autoCompact` is absent when the reply carries no `context.breakdown`.
- **D3. Mapping, in `hooks/register.ts` (the `/ctrscm` handler only).** From `usage.context`: `window`, `tokens`, `percent` as given (each optional field left out when absent), and `autoCompact` from `usage.context.breakdown` when present: `isEnabled` is `isAutoCompactEnabled`, `threshold` is `autoCompactThreshold`. A rejected call becomes `{ kind: 'unavailable', reason: errorMessage(error) }` (the existing helper at `hooks/register.ts:22`). Nothing is logged for it: the reason is in the status text, and the existing tests assert `logs` stays empty after `/ctrscm`.
- **D4. Text.** Two lines are inserted between `advice:` and `shake:`, plus an optional third.
  - `context: {tokens} tokens ({percent}% of {window})`; without `percent`: `context: {tokens} tokens (window {window})`; without `tokens`: `context: not measured yet (window {window})`; unavailable: `context: unavailable ({reason})`.
  - `engine compaction: auto at {threshold} tokens` when `isEnabled` is true and `threshold` is a number; `engine compaction: auto off` when `isEnabled` is false; `engine compaction: unknown` when `autoCompact` is absent or enabled with no threshold; unavailable: `engine compaction: unavailable`.
  - Note line, directly after `engine compaction:`, only when `config.triggerTokens > 0`, a numeric threshold exists, and `config.triggerTokens >= threshold`: `note: trigger tokens ({triggerTokens}) are at or above the engine threshold ({threshold}); the engine may compact first`. `// shortcut:` the percent trigger is not compared (it is relative to the window, the threshold to the engine's own count); add the percent comparison if owners set only `triggerPercent`.
- **D5. Honest figures.** The threshold is the engine's own count and the context line is the last API response's input side; the two come from different counters (the doc of `SessionContextUsage.breakdown`: it "estimates every category, so its `totalTokens` need not equal `tokens`"). Do not subtract, add or convert them, and do not call either an exact count of anything the status text does not already call exact.
- **D6. Never print option values or tool bodies**: unchanged; the new lines carry token counts and an engine error message only.

## 3. Mechanical changes

1. `hooks/status.ts`: add `EngineStatus`; add the `engine` parameter; render D4 between the `advice:` and `shake:` lines. No other line changes.
2. `hooks/register.ts`: in the `command.run` handler for `ctrscm`, after the `report` branch returns (current line 160 to 197), call `$.session.usage({ breakdown: 'summary' })` inside `try`, map per D3, pass the result as the new last argument of `statusText` (current line 197).
3. `tests/status.test.ts`: all four `statusText` calls (lines 7, 32, 57 and 65 at the base commit) take the new last argument or tsc fails; the two full-block expectations (the blocks at lines 17 and 42) take the new lines; the two `toContain` checks (lines 64 and 71) stay as they are; add one test per D4 row: ok with percent, ok without percent, ok without tokens, auto on with threshold, auto off, unknown (no breakdown), unknown (enabled, no threshold), note shown (`triggerTokens` above and equal to the threshold), note hidden (below the threshold; `triggerTokens` 0; no threshold), unavailable. Expected strings are literals.
4. `tests/register.test.ts`: (a) a `/ctrscm` run with `on('session.usage', ...)` returning a literal usage object with a `breakdown` asserts the new lines and that the handler received `{ breakdown: 'summary' }`; (b) a run whose `session.usage` handler throws `new Error('usage unavailable')` (precedent: the conditionally throwing `session.id` handler at `tests/register.test.ts:1494`) gives `context: unavailable (usage unavailable)` and `engine compaction: unavailable`, with `logs` empty (replaced by Amendment 1: the expected reason is the harness's text); (c) a `/ctrscm report` run never calls `session.usage` (the handler counts calls).

The literal `SessionUsage` of (a) is written inline in `tests/register.test.ts`; it must typecheck without casts, so it fills every required field (`rateLimits: []`, and in `context.breakdown` `categories`, `totalTokens`, `maxTokens`, `rawMaxTokens`, `autocompactSource`, `percentage`, `gridRows`, `model`, `memoryFiles`, `mcpTools`, `agents`, `isAutoCompactEnabled`, `apiUsage: null`; `types/claude-code.d.ts` lines 8704 to 8771). The existing `/ctrscm` tests answer no `session.usage`; the test harness's behavior for an unanswered op is not documented. If one of them hangs or fails for that reason, give it a throwing `session.usage` handler (inside the four-file scope) and change nothing else in it.

## 4. Out of scope

Changing any trigger, threshold default, the proactive request, advice, `/shake` or `report`. Making the proactive trigger relative to the engine threshold (a later spec, only after the live figure is seen). Reading usage from `session.measure`. The `README.md` and `docs/*` edits. Category breakdown for the report (backlog B19). Any new config key.

## 5. Probe result

Pre-lock baseline at `fbb8bb5` plus the uncommitted docs diff: `npx tsc -p tsconfig.json` passes, `claude plugin validate . --strict` passes, `claude plugin test .` gives 90 pass, 0 fail. Unverified and not probeable before implementation: whether the live engine answers `session.usage` from a `command.run` hook, and the real value of `autoCompactThreshold` for the owner's model. The design is safe either way: a rejection renders `unavailable`, and an absent `breakdown` renders `unknown`. The owner's live check (after the architect commits and the clone is updated) settles both.

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "session\.usage" hooks
git diff --check
git status --short
```

Expected: tsc and validate pass with no warnings; `claude plugin test .` all pass with no failures (the baseline was 90 tests; the new tests add to it); `rg` lists exactly one call in `hooks/register.ts` and none elsewhere (so no comment in `hooks/*.ts` may spell `session.usage`); `git status --short` lists only the four paths in section 0.

## 7. Pre-lock gate record (2026-10-06, base `fbb8bb5` plus the architect's docs diff)

Baseline run: tsc pass, `claude plugin validate . --strict` pass, `claude plugin test .` 90 pass, 0 fail. `rg -n "statusText" hooks tests`: one call in `hooks/register.ts:197`, four in `tests/status.test.ts` (7, 32, 57, 65), all in scope. `rg -n "session\.usage" hooks` matches nothing today. Old text: the `advice:` and `shake:` status lines appear in `tests/status.test.ts` only (and prose in `README.md:115`, `docs/usage.md`, edited by the architect). Consultant `m_672` checked the declarations and anchors; F1 (no hook restriction found), F3 (mapping correct) confirmed, F2, F4 to F6 applied above, F7 anchors held. Not checked by anyone: the live engine's behavior from a command hook, and the test harness's answer to an unanswered op (covered by the fallback sentence in section 3).

## Amendment 1 (2026-10-06): the harness replaces a thrown handler's message

Developer `m_676` blocked on section 3 (b), which expects `context: unavailable (usage unavailable)`. Verified by the architect with `claude plugin test .` on the developer's diff: the test harness SKIPS a `session.usage` handler that throws ("test's session.usage hook was skipped: test: usage unavailable") and the op then rejects with the harness's own text, so `errorMessage(error)` yields `no implementation for session.usage`. This is the same text an unanswered op gives, which is why the existing `/ctrscm` tests (no handler, `toContain` only) are unaffected and need no change. The production mapping of D3 stands.

Replacement for section 3 (b): a `/ctrscm` run in which `session.usage` is unanswered (no handler, or a throwing one; use the throwing `new Error('usage unavailable')` handler so the test names its intent) expects `context: unavailable (no implementation for session.usage)`, `engine compaction: unavailable`, and `logs` empty. The sentence in section 3 about giving existing tests a throwing handler no longer applies: an unanswered op rejects, as just shown. The expected reason is the harness's text, not the handler's; do not assert `usage unavailable`.

Gate re-run for the amendment: the old wording `context: unavailable (usage unavailable)` appears in section 3 (b) only (`rg -n "usage unavailable" docs/specs/spec-10-engine-threshold-status.md`); the section 6 acceptance and the scope are unchanged.
