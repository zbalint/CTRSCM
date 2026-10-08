# Spec 12: idle Shake while the session sits idle past the prompt cache TTL

## 0. Status

**LOCKED** (2026-10-08), revision 2 (Amendment 1, section 7: the `prompt.submit` mechanism of revision 1 is refused by the host; replaced by an idle timer). Consultant `m_808` applied to revision 1. Owner decisions: the idle Shake drops only `minSavings` (`minResultTokens` and `protectTokens` stay); the owner delegated the remaining design choices to the architect.

**Scope.** Edits: `hooks/config.ts`, `hooks/trigger.ts`, `hooks/register.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md` (the options table only), `tests/config.test.ts`, `tests/trigger.test.ts`, `tests/register.test.ts`, `tests/status.test.ts`. Does not touch: `hooks/shake.ts`, `hooks/report.ts`, `hooks/usage.ts`, `hooks/usageLog.ts`, `hooks/configFile.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`, other `tests/*`, `docs/*`, `AGENTS.md`, `types/` (the architect edits `docs/usage.md`, `docs/backlog.md`, `docs/verification.md` after acceptance). No new dependency, no new file. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-idle-shake`.
**Public test seams:** `markOf` / `requestOf` (pure), `parseConfig` (pure), `statusText` (pure), and the registered hooks driven through `$` (`turn.complete`, `turn.start`, the mock clock, `session.compact`, `ui.log`, `fs.write`).

## 1. Why

The prompt cache has a 1 hour TTL on the owner's account. After a longer idle gap the cache is cold, so the next request writes the whole prefix to the cache at the write price (2x base input against 0.1x for a read, the ratios `hooks/report.ts` already assumes). A normal Shake guards against paying a cache rebuild for a small gain (`minSavings`), but on a cold cache the rebuild happens anyway, so that guard only throws savings away: with the owner's `minSavings` 100000 a 200k context holding 80k of shakeable tool output is left alone, and the first message back writes all 200k. A smaller prefix also makes every later read cheaper.

The design: arm a timer when a main-thread turn ends; if no turn starts for `idleShakeMinutes` (default off, 65 suggested), the timer requests one Shake with `minSavings` 0 while the session is idle, so the first message back writes a smaller prefix and nobody waits at prompt time. Everything else about a Shake (artifact first, placeholders, fallback = transcript untouched for a request) is unchanged.

**Verified, and why revision 1 changed.** The `claude` binary (2.1.295) contains a host check that refuses `$.session.compact` called from a `prompt.submit` hook: `called from a prompt.submit hook, it would compact under the turn this hook is holding; call it from a later event (turn.complete)`. The developer reproduced it in the mock engine (`m_812`). So a shake before the prompt enters the session is not possible; a timer callback runs outside any hook (`TimerCall` is `(ms, fn: () => void) => Timer`, `types/claude-code.d.ts:9756` to `9759`) and the session is between turns when it fires.

**Still not known.** Whether the host also refuses `$.session.compact` called from a timer callback. The check above is keyed on the calling hook event; a timer has none, but this is unverified. The call is **safe either way** (a rejection or any error leaves the transcript untouched, D4) and the option ships **off by default** (D1); the architect arranges a live probe after acceptance and flips the default only if it passes. The same host refusal is already handled for `session.measure` (`hooks/register.ts:244` to `250`, deferral to `turn.complete`).

## 2. Decisions

- **D1. Option `idleShakeMinutes`**, default **0** (off), a safe integer at least 0; added to `Config`, `DEFAULT_CONFIG`, `CONFIG_OPTION_NAMES` and the `numericOption` name union in `hooks/config.ts`, with the same problem text as `adviseTokens`: `option idleShakeMinutes: must be a safe integer at least 0; using the default`. The owner enables it in `~/.ctrscm/config.json`. Reason for off: the host behavior in "What is not known" is unverified.
- **D2. A third request kind.** In `hooks/trigger.ts`: `Request = 'proactive' | 'aggressive' | 'idle'`, an exported `IDLE_MARK = 'ctrscm:idle'`, and `markOf` / `requestOf` handle it. `markOf` is a two-way ternary today (`hooks/trigger.ts:9`); make it a total mapping for three kinds (a `Record<Request, string>` lookup is fine; keep `PROACTIVE_MARK` and `AGGRESSIVE_MARK` exported with their current values). `decideRequest` and `decideAdvice` do not change.
- **D3. The timer.** In `register()` add `let idleTimer: Timer | undefined` (type `Timer` from `claude-code`). A helper local to `register()`, `disarmIdle()`, cancels it and sets it undefined. In the existing `turn.complete` hook, after `const result = await next(e)`, when `e.reason === 'answer' && e.agentId === undefined && config.idleShakeMinutes > 0 && config.autoShake`: call `disarmIdle()` then `idleTimer = $.clock.after(config.idleShakeMinutes * 60000, () => { void runIdleShake($) })` where `runIdleShake` is the D4 function; a subagent's turn or an interrupted or errored turn does not arm or move it. A new `on('turn.start', ($, e, next) => { disarmIdle(); return next(e) })` cancels the pending timer when any main-thread turn begins (`turn.start` fires before the turn's first model call, `types/claude-code.d.ts:3633` to `3641`; a subagent raises none). A fresh registration (new process, `/resume`) has no timer and therefore never idle-shakes: **known gap**, backlog B28.
- **D4. `runIdleShake`**, a function local to `register()` taking `$`. Gates, each failing one makes it log nothing and return (the timer is spent either way; set `idleTimer = undefined` first):
  1. `isRecoverReady`, `!isRequesting`, `!isPending`, `wanted === undefined` (a queued `/shake` or a retry already owns the next pass).
  2. `lastContext.tokens !== null && lastContext.tokens >= IDLE_MIN_CONTEXT_TOKENS`, a module constant `30000` in `hooks/register.ts` with a `// shortcut:` comment (fixed floor so a tiny session is never touched; make it an option if the owner wants it tuned). The floor is a separate gate, not a savings threshold: `minSavings` stays 0 inside the pass.

  When the gates hold: set `isRequesting = true`; `$.ui.log('CTRSCM: idle shake requested (idle {m} min)')` with `m` the configured `idleShakeMinutes`; then `await $.session.compact({ instructions: markOf('idle') })` in a `try`. On a throw: `$.ui.log('CTRSCM: idle shake rejected: {message}')`, `stats.last = 'idle skipped: compaction failed'`, and write a **failed** usage event (outcome `failed`, label `idle`, reason `compaction failed`: the same event the `turn.complete` retry writes, with `label: request`). In `finally`: `isRequesting = false` and `cooldown = config.cooldownTurns` (so the proactive trigger does not shake again on the next measurement). The function never throws (a failing usage write is caught and logged, as `writeUsageEvent` already does) and never logs prompt or tool text.

  The failure usage event in `turn.complete` (`hooks/register.ts:328` to `353`: the `catch` body that logs, sets `stats.last` and writes the event) is the same event with `label: request`; extract that block into one local closure inside `register()` used by both (extend, do not copy; behavior of the existing hook unchanged).
- **D5. The Shake itself.** In the `session.compact` hook the settings line (`hooks/register.ts:451` to `452`) becomes: `aggressive` keeps `{ ...config, protectTokens: config.aggressiveProtectTokens }`; `idle` uses `{ ...config, minSavings: 0 }`; otherwise `config`. Nothing else in that hook changes: stats, the one-time pass hint, the `shook` log line, `markedSkip` and the usage event all already key on `request`, so an idle pass counts as a pass, carries `label: 'idle'` and uses the existing skip reasons (`nothing worth shaking` when nothing is eligible at all, since `minSavings` 0 only removes the savings check at `hooks/shake.ts:141`).
- **D6. Status.** `statusText` gets one new line directly after the `advice:` line: `idle shake: after {idleShakeMinutes} min idle, 0 = off`. The `options:` line counts `CONFIG_OPTION_NAMES` and therefore reads `14 default` where it read `13`.
- **D7. Plugin manifest and README.** `.claude-plugin/plugin.json` gets an `idleShakeMinutes` option entry in the existing style (title `Idle Shake minutes`, description `Minutes of idle time after which the next prompt first requests an idle Shake; zero disables it.`, `"required": false`). The README options table gets the row `| \`idleShakeMinutes\` | \`0\` | Minutes idle before the first prompt back requests an idle Shake (the prompt cache is cold by then); \`0\` disables it. |`, placed after the `adviseTokens` row. No other README text.
- **D8. Honesty and invariants.** No product invariant changes: the pass is a request (a failure or a skip leaves the transcript untouched), artifacts are committed before placeholders, no tool body is logged. The idle pass is labeled `idle` in the usage log so a later report can separate it.

## 3. Tests

Write the failing test first, one behavior at a time. Literals only (AGENTS.md).

1. `tests/trigger.test.ts`: `markOf('idle')` is `'ctrscm:idle'`, `requestOf('ctrscm:idle')` is `'idle'`, and the two existing marks still map as before.
2. `tests/config.test.ts`: `idleShakeMinutes` default 0; `'65'` gives 65; `'0'` gives 0; `'abc'` and `-1` give the default with the problem text in D1; a blank value is unset. Add `idleShakeMinutes: 0` wherever a full `Config` literal is asserted (lines 16, 46, 92 are `adviseTokens` neighbors). The file-merge test at lines 183 to 206 lists option names: extend only if it asserts the full name list.
3. `tests/status.test.ts` and `tests/register.test.ts`: the new status line, and `14 default` where `13 default` is asserted (`tests/status.test.ts:26`, `:54`; `tests/register.test.ts:520`).
4. `tests/register.test.ts`, the hooks driven through `$` with the mock clock advanced by the test (`mock.clock(...).advance(...)`, as the developer found in the testing package; if advancing the mock clock does not fire a `$.clock.after` timer, that is a material contradiction: BLOCKED). Seed `lastContext` with a `session.measure` of 40000 tokens, then complete one main-thread `answer` turn, then:
   - `idleShakeMinutes` 60, advance 60 minutes, tool results present: one compact call whose `instructions` is `'ctrscm:idle'`, artifacts written although `minSavings` is larger than the available savings, the usage file has `label: 'idle'`, `outcome: 'shook'`, the status line reads `this session: 1 passes`.
   - advance 59 minutes: no compact. A `turn.start` after 30 minutes cancels: advancing past 60 minutes triggers no compact, and the next `answer` turn arms a fresh timer.
   - `idleShakeMinutes` 0 (default): no timer, no compact.
   - `$.session.compact` rejects: the log `CTRSCM: idle shake rejected: ...`, a `failed` usage event labeled `idle` with reason `compaction failed`, `stats.last` reading `idle skipped: compaction failed`, and the cooldown set.
   - gates, each its own case with an otherwise-armed setup: `autoShake` off (no timer), `isPending` (queued `/shake`), context 29999 tokens, and a subagent turn complete (`agentId` set) or a non-`answer` reason that must not arm the timer.
   - cooldown: after the idle pass a proactive trigger inside `cooldownTurns` measurements is not requested.
   Existing behavior: every existing test passes unchanged except the literals listed above.

## 4. Out of scope

Persisting the last-turn time so a resumed session can idle-shake (backlog B28); letting the idle pass serve a queued `/shake` or a `wanted` retry; per-model or per-plan TTL; a toast; a report line for idle passes (labels already separate them in the usage log); a context-floor option; changing the default of `idleShakeMinutes`; any change to `shake.ts` selection; queueing a rejected idle request for turn end (a shake after the turn has warmed the cache pays the invalidation `minSavings` guards, so a rejection is dropped); a `prompt.submit` hook (refused by the host, section 1).

## 5. Probe result

Pre-lock baseline (2026-10-08, tree clean at `cc98fc5`): `npx tsc -p tsconfig.json` pass, `claude plugin validate . --strict` pass, `claude plugin test .` 106 pass, 0 fail. Read in this tree: `hooks/register.ts` (hooks and the `session.compact` settings line), `hooks/trigger.ts`, `hooks/config.ts`, `hooks/status.ts`, `hooks/shake.ts:141` (`savings < settings.minSavings || selected.length === 0`), `types/claude-code.d.ts` 2449 to 2454, 7184 to 7241, 7015 to 7140 (origin kinds include `plugin`), 10372 to 10391. Content search for the changed strings: `rg -n "13 default"` hits are only the three test lines above; `adviseTokens` is the neighbor option in `hooks/config.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md`, `tests/config.test.ts`, `tests/status.test.ts`, `docs/usage.md`, `docs/examples/ctrscm-150k.json` (the last two are architect-owned or unchanged). The live behavior of `$.session.compact` from a timer callback is **not verified**; verification is a post-acceptance live probe by the architect's tester, not part of this spec's acceptance. Revision 2 reading: `strings` of the `claude` 2.1.295 binary for the `prompt.submit` refusal text (section 1).

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "idleShakeMinutes" hooks .claude-plugin README.md
rg -n "ctrscm:idle|IDLE_MIN_CONTEXT_TOKENS|shortcut:" hooks/register.ts hooks/trigger.ts
git diff --check
git status --short
```

All three gates pass with no warnings; the test count is the baseline 106 plus the new tests, 0 fail; `git status --short` shows only files named in section 0.

## 7. Amendment 1 (revision 2)

Trigger: developer `BLOCKED` `m_812` (2026-10-08). Verified by the architect: the refusal text is in the `claude` 2.1.295 binary (`called from a prompt.submit hook, it would compact under the turn this hook is holding; call it from a later event (turn.complete)`), so revision 1's `prompt.submit` hook cannot work in the real host, not only in the mock. Resolution: sections 1, 3 (item 4), 4, 5 and decisions D3 and D4 are replaced as written above (timer armed at `turn.complete`, cancelled at `turn.start`; no `prompt.submit` hook, no `turnId` or origin gates). D1, D2, D5 to D8 are unchanged, and the developer's finished slices (config, marker, status, manifest, README, their tests) stand. Remove the temporary debug instrumentation and diagnostic assertions before reporting. Pre-lock gate re-run: D3 and D4 describe the same behavior in sections 1, 3 and 7 (checked word for word); the worked instance (idle 60, turn ends at t0, advance 60 minutes, context 40000) passes every gate in D4; `Timer` is exported by `claude-code` (`types/claude-code.d.ts:9746`).
