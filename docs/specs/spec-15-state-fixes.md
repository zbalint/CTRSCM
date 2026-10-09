# Spec 15: idle and turn state fixes from the project audit

## 0. Status

**LOCKED** (2026-10-09), revision 1. Source: the owner-requested whole-project audit (context `ctrscm-audit`), consultant report `m_862` (code read at `e78d182`), each item re-read by the architect in `hooks/register.ts` before locking. Owner decision: fix what the audit found; the owner was away and delegated the details.

**Scope.** Edits: `hooks/register.ts`, `tests/register.test.ts`. Does not touch any other file (the architect edits `docs/*` after acceptance). No new file, no new dependency, no new option. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-audit-fixes`.
**Public test seams:** the registered hooks driven through `$` (`classic.SessionStart` via `tests/fixtures/classicSessionStart.ts`, `prompt.edit` via `tests/fixtures/promptEdit.ts`, `session.start`, `session.measure`, `turn.start`, `turn.complete`, the mock clock, `session.compact`, `ui.log`, `fs.write`, `fs.read`).

## 1. Why

The audit found these defects in the idle-Shake and turn-state code. All behavior outside them stays byte-identical.

## 2. Decisions

- **D1. `classic.SessionStart` must not depend on the config file being merged yet** (audit 1). `config` is merged from `~/.ctrscm/config.json` only in `session.start`, and the host's order of the two start events is unverified. Remove the `config.idleShakeMinutes <= 0` condition from the `classic.SessionStart` hook (spec 13 D1). Seeding is harmless when idle Shake is off, because the `prompt.edit` hook already gates on `config.idleShakeMinutes` and `config.autoShake` (spec 12 D4). Every other spec 13 condition stays.
- **D2. A start event resets the old conversation's state** (audit 2). In the `classic.SessionStart` hook, when `e.source` is `resume`, `fork` or `clear`, first reset `lastTurnAt = undefined`, `resumedContextTokens = undefined` and `lastContext = { tokens: null, percent: null }`; then, for `resume`/`fork` only, seed as spec 13 D2 says except that the `lastTurnAt === undefined` guard is dropped (the reset made it true). For any other `source`, and for `startup` and `compact`, the hook changes nothing. Ordering: the reset happens before the eligibility checks of spec 13 D1, so an ineligible resume (cache not expired) still clears the stale state.
- **D3. No double idle request from fast keystrokes** (audit 3). In the `prompt.edit` hook, claim the pass synchronously: once the gates before the clock read hold, set `isRequesting = true` **before** `await $.clock.now()`. On a clock failure, or when the idle gap is not reached, set `isRequesting = false` again and `return next(e)` (no cooldown, no log beyond the existing clock-failure log). The rest of the hook is unchanged, including the existing `finally` (`isRequesting = false`, `cooldown = config.cooldownTurns`) after a real attempt.
- **D4. Track running turns by id** (audit 4). Replace `isTurnRunning` by `const runningTurns = new Set<string>()`. `turn.start` adds `e.turnId`; `turn.complete` deletes `e.turnId` first thing (before `await next(e)`, as today's flag reset), for every agent, and when `e.agentId === undefined` it also clears the whole set (a main-loop completion self-heals a start whose completion never arrived, as today's boolean does). The `prompt.edit` gate `isTurnRunning` becomes `runningTurns.size > 0`. Nothing else reads the flag.
- **D5. Any main-loop completion starts the idle gap** (audit 5). In `turn.complete`, stamp `lastTurnAt` (and clear `resumedContextTokens`) when `e.agentId === undefined`, whatever `e.reason` is (`answer`, `aborted`, `refusal`, `error`): a turn that sent requests warmed the cache. Subagent turns still do not move it. This **reverses** spec 12's choice (only `answer` stamps); the existing test `idle prompt edit does not timestamp an interrupted turn` (`tests/register.test.ts:1223` to `1237`) asserts the old behavior and is **superseded**: rewrite it to assert that an `aborted` main turn starts the gap.
- **D6. The measure-path rejection is logged** (audit 8). In the `session.measure` hook the `catch` around `$.session.compact({ instructions: markOf(request) })` logs `CTRSCM: {kind} shake deferred to turn end: {message}` through `$.ui.log` (with `kind` `proactive` or `aggressive` and the error message, via the existing `errorMessage` helper), then keeps today's behavior (`wanted = request`, `isPending` for aggressive). Never log request text or transcript content.
- **D7. Dead code out** (audit, overengineering). In the `session.compact` hook remove `trackedTrigger` (always true at that point: `precompute` already returned) and the conditions that use it, keeping the behavior; merge `markedSkip` and `markedFailure` into one local function taking the outcome (`'skipped' | 'failed'`), keeping every stats and event string byte-identical. If removing a condition changes behavior for a trigger value you did not expect, stop and report BLOCKED with the evidence.

## 3. Tests

Write the failing test first, one behavior at a time; literals only (AGENTS.md). Reuse the existing idle-test harness in `tests/register.test.ts`. Baseline: 134 pass.

1. D1: with `idleShakeMinutes` given **only through the config file** (`~/.ctrscm/config.json` text served by `fs.read`/`fs.stat`), dispatch `classic.SessionStart` (resume, 4000 s, 40000 tokens, cache expired) **before** `session.start`, then `session.start`, then one composer `prompt.edit`: one idle compact. Fails before the fix.
2. D2: (a) complete a main `answer` turn at t0 and measure 40000 tokens, advance 5 minutes, dispatch `classic.SessionStart` `resume` with `prompt_cache_likely_expired: true`, `seconds_since_last_response: 4000`, `context_tokens: 40000`: the next edit idles (the old `lastTurnAt` no longer wins); (b) complete a main `answer` turn at t0 with a measure of 40000, advance 70 minutes (`idleShakeMinutes` 65), then dispatch a `resume` with `prompt_cache_likely_expired: false`: the stale stamp is cleared, so the edit makes no compact (before the fix the stale stamp idles, so this one is red first); (c) `source: 'clear'` after a completed turn and a measure of 40000: advance past the gap, the edit makes no compact; (d) `source: 'startup'` leaves a completed turn's state alone (the edit after the gap still idles).
3. D3: two `promptEdit` calls dispatched without awaiting the first (`Promise.all`) after the gap: exactly one compact call, one `idle shake requested` log, one usage event. If the mock engine serializes the two dispatches and the test is green before the change, report that and land D3 with the test as a regression guard (do not loop on a red-first rule). `isRequesting` held across the clock await also makes `session.measure` and `turn.complete` skip their request blocks for that instant; that is harmless (`prompt.edit` is composer-only and gated on no running turn).
4. D4: `turn.start` of a subagent turn id after the main turn completed and before its own `turn.complete`: an edit after the gap makes no compact; after that `turn.complete` (same turn id) it idles. A main turn running (`turn.start` without complete) still blocks as today. A main-loop `turn.complete` clears a leftover id (start a subagent id, never complete it, complete a main turn: the edit after the gap idles).
5. D5: an `aborted` and an `error` main-loop `turn.complete` each move the gap (an edit right after makes no compact even though an earlier `answer` was long ago); a subagent `turn.complete` (agentId set) does not.
6. D6: a rejected measure-path compact logs the line of D6 with the error message and still sets the retry (the existing turn-end retry assertion stays).
7. D7: every existing `session.compact` test passes unchanged (that is the proof). Renaming the existing test `seeding stays disabled when idle Shake is off` (`tests/register.test.ts` ~970) to say that no idle request is made is allowed (seeding now happens; the assertion stays).

## 4. Out of scope

Cooldown counted per measure instead of per turn (audit 6), the repeated proactive request when nothing is left to shake (audit 7), auto-compact replaced by a small shake (audit 9), `Fs` read/write typing in `artifacts.ts`/`recover.ts`, the repeated artifact-root lookup, the test-harness duplication: all go to the backlog, not this spec.

## 5. Probe result

Baseline (2026-10-09, tree at `e78d182`): tsc 0, validate pass, `claude plugin test .` 134 pass, 0 fail. Architect re-read in `hooks/register.ts`: the `classic.SessionStart` hook and its `lastTurnAt === undefined` guard, `config` merged in `session.start`, `session.measure` catch, `turn.start`/`turn.complete` flag, the `prompt.edit` gates and its clock await. `TurnStartInput.turnId` is the id the `turn.complete` carries (`types/claude-code.d.ts` ~10372 to 10383). Whether the real host orders `classic.SessionStart` before `session.start` is unverified, which is why D1 removes the dependency instead of assuming an order.

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "isTurnRunning|trackedTrigger|markedFailure" hooks
rg -n "as unknown as" hooks tests
git diff --check
git status --short
```

All three gates pass with no warnings; test count is 134 plus the new tests, 0 fail; the first `rg` finds nothing; the second hits only the two existing fixtures; `git status --short` shows only `hooks/register.ts` and `tests/register.test.ts`.
