# Spec 17: usage-log diagnostics for skipped, deferred and failed Shake requests

## 0. Status

**LOCKED** (2026-10-09), revision 2 (consultant m_945 folded in). Source: owner question "is there a way to determine if it works as intended?" after many `deferred to turn end` lines and no successful proactive shake; architect analysis of `~/.ctrscm/artifacts/usage` (context `ctrscm-usage-diag`). Owner delegated the decision to the team.

**Scope.** Edits: `hooks/usage.ts`, `hooks/register.ts`, `tests/register.test.ts`. Does not touch: `hooks/usageLog.ts` (the reader keeps ignoring unknown event kinds and extra fields), `hooks/report.ts`, `hooks/status.ts`, `hooks/trigger.ts`, `hooks/shake.ts`, `hooks/config.ts`, any doc, `README.md`, `.claude-plugin/`. The architect edits `docs/usage.md`, `docs/backlog.md` and `docs/architecture.md` after acceptance. No new file, no new dependency, no new option. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>` = `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-usage-diag`.
**Public test seams:** the registered hooks driven through `$` (the existing `tests/register.test.ts` harness); no private function is tested directly.

## 1. Why

Live logs show 78 `shake` events `skipped: nothing worth shaking`, 18 `failed: compaction failed`, and many `proactive shake deferred to turn end` lines that exist only in `$.ui.log`. Three questions cannot be answered from the files today:

1. How far below `minSavings` was each skip (nothing eligible, or eligible but too small)? This is what tells the owner how to tune `minSavings`.
2. Why did a compaction fail? `reason` is the constant `compaction failed`; the engine's message (for example `a turn is running`) is only in `$.ui.log`.
3. Is a deferral followed by exactly one turn-end outcome, and does the turn the engine names match a turn the mod tracks (`runningTurns`)? A mismatch would mean a sub-agent or background turn blocks the turn-end retry, which is a suspected defect.

All three additions are counts, ids and engine error text only (invariant: never log tool-result bodies). No behavior changes.

## 2. Decisions

- **D1. `UsageEvent` gains three optional fields** (`hooks/usage.ts`): `eligibleSavings?: number` (estimated tokens a pass could save, after placeholders, before the `minSavings` test), `minSavings?: number` (the threshold the pass was tested against), `error?: string` (engine error text, at most 200 characters, cut with `slice(0, 200)`). They are optional so `hooks/usageLog.ts` (which rebuilds events field by field and ignores extras) and every existing event stay valid.
- **D2. Skips carry the threshold.** In `hooks/register.ts`, the `session.compact` path where `selection.selected.length === 0` (the two `nothing worth shaking` call sites, both the unmarked `fallback` and the marked `skipped`, ~lines 573 to 578) writes its event with `eligibleSavings: selection.savings` and `minSavings: settings.minSavings` (the effective settings object, so an idle request logs `0`; an aggressive request has no threshold of its own and logs `config.minSavings`, do not add one). `selectResults` already returns `savings` in both outcomes (`hooks/shake.ts:160`): `0` means nothing was eligible, a positive value below `minSavings` means eligible but too small. No change to `shake.ts`. Mechanism: `writeShakeEvent`, `fallback` and `marked` (~lines 510 to 556) each take one optional trailing parameter `extra?: Pick<UsageEvent, 'eligibleSavings' | 'minSavings'>`, spread into the event; it is passed only at the two `nothing worth shaking` call sites. Other skip reasons (`no transcript`, `recovery tool not registered`, `artifact root unavailable`, `artifact write failed`) do not get the fields.
- **D3. Failures carry the error.** `failedCompactionEvent` (`hooks/register.ts:75`) takes the caught error and sets `error: errorMessage(error).slice(0, 200)`. Both callers (the turn-end retry and the idle path) pass it. `reason` stays `compaction failed`.
- **D4. A new `defer` event.** `hooks/usage.ts` adds `DeferUsageEvent`: `{ version: 1, at, sessionId, agentId: null, event: 'defer', kind: Request, error: string (≤ 200 chars), trackedTurns: string[], contextTokens: number | null, contextPercent: number | null }`. `trackedTurns` is the set at the rejection: turn ids from `turn.start` minus completed ones, emptied by any main-loop `turn.complete` (`register.ts` ~lines 353 to 354); resume/clear do not clear it. Ids are opaque, not content. `Request` is the existing type from `hooks/trigger.ts` (it includes `'idle'`, which this path never produces; no narrowing, no cast). **Ordering (behavior must not change):** in the `session.measure` catch (`hooks/register.ts` ~lines 303 to 306) only capture, synchronously and before any `await`, the error text (`errorMessage(error).slice(0, 200)`) and `const trackedTurns = [...runningTurns]`; the catch otherwise stays byte-identical (log line, `wanted = request`, `isPending`). Write the event after the `try`/`finally`, once `isRequesting` is false, because the write awaits (`quietRoot`, `fs.write`) and a main `turn.complete` landing meanwhile would otherwise hit the `isRequesting` early return at ~line 393 and lose the turn-end retry. The write uses the existing `writeUsageEvent` (extend its event union by the new type; reuse its guards, session lookup and failure logging). The existing `$.ui.log` line and the `wanted`/`isPending` handling are unchanged. The event is written whether or not the rejection text names a turn.
- **D5. No reader change.** `readUsageEvents` already `continue`s on unknown `event` kinds without counting them as skipped (`hooks/usageLog.ts:157`; test `tests/usageLog.test.ts:69`), so `/ctrscm report` is unaffected. Do not add `defer` to the reader.
- **D6. `usageLog: off` still writes nothing** (the `writeUsageEvent` guard already does this).

## 3. Tests (write the failing test first, one behavior at a time)

In `tests/register.test.ts`, using the existing harness:

- A proactive request with nothing eligible: the `skipped` event has `eligibleSavings: 0` and `minSavings` equal to the configured value.
- Positive-but-below-threshold: extend the existing literal test at ~1918 to 1945 (marked skip) with the worked `eligibleSavings` (from the fixture literals, not `selectResults`) and `minSavings`; no second near-identical test.
- An idle request with nothing eligible logs `minSavings: 0`.
- A failed turn-end retry and a failed idle compaction: `error` equals the literal engine message the fake throws (the existing tests use `no implementation for session.compact`); an error longer than 200 characters is cut to exactly 200.
- A measure-time rejection writes one `defer` event: `kind`, `error` equal to the fake's message, `trackedTurns` equal to the ids of a sub-agent turn and a main turn started with `$.turn.start` (as at `tests/register.test.ts` ~1308 and ~1318) and not completed before the rejected measure (the harness's `complete` uses `t-1` without a `turn.start`, so `[]` otherwise), context fields from the measure input; and exactly one `defer` event per rejection, none when the request succeeds.
- `usageLog: off` writes no `defer` event.
- `readUsageEvents` is not asserted again; the existing unknown-kind test covers D5.

Existing tests that change (consultant measurement, tree at `372bb4e`; run the suite to confirm): the `defer` write breaks `h.writes` `toEqual([])` at ~2175 and ~2259 (now one defer write) and the index/length assertions at ~2183 to 2188 and ~2298 to 2299 (either clear `h.writes` after the rejected measure or assert the order defer, turn, shake; pick the clearer). Field additions break the exact literals at ~1932 (marked skip), ~1988 to 2004 (unmarked `auto` fallback `nothing worth shaking`, which D2 also covers) and ~2218 (failed literal gains `error: 'no implementation for session.compact'`). ~1245 already uses `objectContaining` and needs no change. Do not weaken an assertion to `objectContaining` to dodge a literal.

## 4. Out of scope

Any behavior change: B30 (cooldown per measure event), B31 (back off after a skip), B32, the turn-end retry rules, `minSavings` validation against `triggerTokens - protectTokens`, per-role config, the cache-cost comparison (`/ctrscm report` already derives cache creation around a pass, spec 8), `request`/`retried` events, the idle `requested` line, renaming `reason`, and any change to `ui.log` text.

## 5. Probe result

Baseline on `develop` at `372bb4e`: usage files read with `jq` (528 files, 2026-10-08 and 09): 78 `nothing worth shaking`, 18 `compaction failed`, 15 + 6 shook, 395 turn, 16 advice. Read `hooks/register.ts` (`writeUsageEvent` 36 to 58, `failedCompactionEvent` 75 to 93, measure block 282 to 347, turn-end retry 393 to 421, compact handler `marked`/`writeShakeEvent`/`selectResults` 505 to 578), `hooks/shake.ts` 98 to 161 (`savings` returned with an empty selection), `hooks/usage.ts`, `hooks/usageLog.ts` (extra fields ignored, unknown kinds skipped silently). Acceptance commands require the new code and run after implementation.

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "eligibleSavings|minSavings" hooks/usage.ts hooks/register.ts
rg -n "'defer'" hooks
git status --short   # only the three scope files, uncommitted
```

Expected: tsc exit 0, validate passes, all tests pass (the 147 existing minus none, plus the new ones), `hooks/usageLog.ts`, `hooks/report.ts`, `hooks/shake.ts` unchanged (`git diff --stat` lists only scope files). No known flaky test.

## Amendment 1 (2026-10-09): long-error test waived, one shared limit

Developer question m_950: the `claude plugin test` runtime swallows errors thrown by user hooks on `session.compact`, so only the engine's short `no implementation for session.compact` reaches `failedCompactionEvent`; no public seam injects a 200-plus-character error. Verified against the diff: the cut exists in two places (`failedCompactionEvent` and the measure catch).

- **A1.1.** The two "error longer than 200 characters is cut to exactly 200" test bullets in section 3 are waived: no test for the cut. The architect verifies it by reading the diff. Everything else in section 3 stands.
- **A1.2.** Replace the two literal `200`s with one exported constant in `hooks/usage.ts` (for example `ERROR_TEXT_LIMIT = 200`) used by both sites. No new helper function, no new test. Section 4 is unchanged.
