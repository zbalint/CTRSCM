# Spec 12: idle Shake on the first prompt after the prompt cache went cold

## 0. Status

**LOCKED** (2026-10-08), revision 1. Consultant `m_808` applied. Owner decisions: the idle Shake drops only `minSavings` (`minResultTokens` and `protectTokens` stay); the owner delegated the remaining design choices to the architect (D1 to D8 below are the architect's).

**Scope.** Edits: `hooks/config.ts`, `hooks/trigger.ts`, `hooks/register.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md` (the options table only), `tests/config.test.ts`, `tests/trigger.test.ts`, `tests/register.test.ts`, `tests/status.test.ts`. Does not touch: `hooks/shake.ts`, `hooks/report.ts`, `hooks/usage.ts`, `hooks/usageLog.ts`, `hooks/configFile.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`, other `tests/*`, `docs/*`, `AGENTS.md`, `types/` (the architect edits `docs/usage.md`, `docs/backlog.md`, `docs/verification.md` after acceptance). No new dependency, no new file. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-idle-shake`.
**Public test seams:** `markOf` / `requestOf` (pure), `parseConfig` (pure), `statusText` (pure), and the registered hooks driven through `$` (`turn.complete`, `prompt.submit`, `session.compact`, `ui.log`, `fs.write`).

## 1. Why

The prompt cache has a 1 hour TTL on the owner's account. After a longer idle gap the cache is cold, so the next request writes the whole prefix to the cache at the write price (2x base input against 0.1x for a read, the ratios `hooks/report.ts` already assumes). A normal Shake guards against paying a cache rebuild for a small gain (`minSavings`), but on a cold cache the rebuild happens anyway, so that guard only throws savings away: with the owner's `minSavings` 100000 a 200k context holding 80k of shakeable tool output is left alone, and the first message back writes all 200k. A smaller prefix also makes every later read cheaper.

The design: record when the last main-thread turn ended; on the first prompt after a gap of at least `idleShakeMinutes`, request one Shake with `minSavings` 0 **before** the prompt enters the session, so the forced write is smaller. Everything else about a Shake (artifact first, placeholders, fallback = transcript untouched for a request) is unchanged.

**What is not known.** Whether `$.session.compact` may run inside a `prompt.submit` hook before `next(e)`. `types/claude-code.d.ts` 2449 to 2454 says it runs "between turns" and "rejects while a turn runs"; 7184 to 7187 says `prompt.submit` fires "before it enters the session" and 7204 to 7209 says `turnId` is absent for a prompt submitted while idle. Neither settles it. This spec makes the call **safe either way** (a rejection or any error leaves the prompt and the transcript untouched, D4) and ships the option **off by default** (D1); the architect arranges a live probe after acceptance and flips the default only if it passes. The same host refusal is already handled for `session.measure` (`hooks/register.ts:244` to `250`, deferral to `turn.complete`), which is the evidence that a refusal is an ordinary rejection of the `$.session.compact` promise.

## 2. Decisions

- **D1. Option `idleShakeMinutes`**, default **0** (off), a safe integer at least 0; added to `Config`, `DEFAULT_CONFIG`, `CONFIG_OPTION_NAMES` and the `numericOption` name union in `hooks/config.ts`, with the same problem text as `adviseTokens`: `option idleShakeMinutes: must be a safe integer at least 0; using the default`. The owner enables it in `~/.ctrscm/config.json`. Reason for off: the host behavior in "What is not known" is unverified.
- **D2. A third request kind.** In `hooks/trigger.ts`: `Request = 'proactive' | 'aggressive' | 'idle'`, an exported `IDLE_MARK = 'ctrscm:idle'`, and `markOf` / `requestOf` handle it. `markOf` is a two-way ternary today (`hooks/trigger.ts:9`); make it a total mapping for three kinds (a `Record<Request, string>` lookup is fine; keep `PROACTIVE_MARK` and `AGGRESSIVE_MARK` exported with their current values). `decideRequest` and `decideAdvice` do not change.
- **D3. The clock.** In `register()` add `let lastTurnAt: number | undefined`. In the existing `turn.complete` hook, after `const result = await next(e)`, when `e.reason === 'answer' && e.agentId === undefined`, set `lastTurnAt = await $.clock.now()` inside a `try`; on a throw, log `CTRSCM: idle clock failed: {message}` through `$.ui.log` and set `lastTurnAt = undefined`. A subagent's turn, an interrupted or errored turn does not move it. A fresh registration (new process, `/resume`) has `lastTurnAt` undefined and therefore never idle-shakes: **known gap**, backlog B28, see section 4.
- **D4. A `prompt.submit` hook** registered with `on('prompt.submit', async ($, e, next) => ...)`. Every gate must hold, otherwise `return next(e)` at once with nothing else done:
  1. `config.idleShakeMinutes > 0` and `config.autoShake` (the idle Shake is an automatic Shake).
  2. `isRecoverReady`, `!isRequesting`, `!isPending`, `wanted === undefined` (a queued `/shake` or a retry already owns the next pass).
  3. `e.turnId === undefined` (a prompt typed or delivered mid-turn arrives inside a running turn, where compaction is refused) and `e.origin.kind !== 'plugin'` (never react to this mod's own or another plugin's submit). Every other origin counts: economics do not depend on who submitted.
  4. `lastTurnAt !== undefined` and `lastContext.tokens !== null && lastContext.tokens >= IDLE_MIN_CONTEXT_TOKENS`, a module constant `30000` in `hooks/register.ts` with a `// shortcut:` comment (fixed floor so a tiny session is never touched; make it an option if the owner wants it tuned). The floor is a separate gate, not a savings threshold: `minSavings` stays 0 inside the pass.
  5. `(await $.clock.now()) - lastTurnAt >= config.idleShakeMinutes * 60000`.
  
  When all gates hold: set `isRequesting = true` and `lastTurnAt = undefined` (one attempt per idle gap, even if the next turn never completes); `$.ui.log('CTRSCM: idle shake requested (idle {m} min)')` with `m` the whole number of minutes of the measured gap; then `await $.session.compact({ instructions: markOf('idle') })` in a `try`. On a throw: `$.ui.log('CTRSCM: idle shake rejected: {message}')`, `stats.last = 'idle skipped: compaction failed'`, and write a **failed** usage event (outcome `failed`, label `idle`, reason `compaction failed`: the same event the `turn.complete` retry writes, with `label: request`). In `finally`: `isRequesting = false` and `cooldown = config.cooldownTurns` (so the proactive trigger does not shake again on the next measurement). In every outcome the hook ends with `return next(e)`: the prompt always proceeds exactly once, and an exception from `$.clock.now()` or from the usage write must not stop it (catch, log the message, continue). Never log prompt text.
  
  The failure usage event in `turn.complete` (`hooks/register.ts:328` to `353`: the `catch` body that logs, sets `stats.last` and writes the event) is the same event with `label: request`; extract that block into one local closure inside `register()` used by both hooks (extend, do not copy; behavior of the existing hook unchanged).
- **D5. The Shake itself.** In the `session.compact` hook the settings line (`hooks/register.ts:451` to `452`) becomes: `aggressive` keeps `{ ...config, protectTokens: config.aggressiveProtectTokens }`; `idle` uses `{ ...config, minSavings: 0 }`; otherwise `config`. Nothing else in that hook changes: stats, the one-time pass hint, the `shook` log line, `markedSkip` and the usage event all already key on `request`, so an idle pass counts as a pass, carries `label: 'idle'` and uses the existing skip reasons (`nothing worth shaking` when nothing is eligible at all, since `minSavings` 0 only removes the savings check at `hooks/shake.ts:141`).
- **D6. Status.** `statusText` gets one new line directly after the `advice:` line: `idle shake: after {idleShakeMinutes} min idle, 0 = off`. The `options:` line counts `CONFIG_OPTION_NAMES` and therefore reads `14 default` where it read `13`.
- **D7. Plugin manifest and README.** `.claude-plugin/plugin.json` gets an `idleShakeMinutes` option entry in the existing style (title `Idle Shake minutes`, description `Minutes of idle time after which the next prompt first requests an idle Shake; zero disables it.`, `"required": false`). The README options table gets the row `| \`idleShakeMinutes\` | \`0\` | Minutes idle before the first prompt back requests an idle Shake (the prompt cache is cold by then); \`0\` disables it. |`, placed after the `adviseTokens` row. No other README text.
- **D8. Honesty and invariants.** No product invariant changes: the pass is a request (a failure or a skip leaves the transcript untouched), artifacts are committed before placeholders, no tool body is logged. The idle pass is labeled `idle` in the usage log so a later report can separate it.

## 3. Tests

Write the failing test first, one behavior at a time. Literals only (AGENTS.md).

1. `tests/trigger.test.ts`: `markOf('idle')` is `'ctrscm:idle'`, `requestOf('ctrscm:idle')` is `'idle'`, and the two existing marks still map as before.
2. `tests/config.test.ts`: `idleShakeMinutes` default 0; `'65'` gives 65; `'0'` gives 0; `'abc'` and `-1` give the default with the problem text in D1; a blank value is unset. Add `idleShakeMinutes: 0` wherever a full `Config` literal is asserted (lines 16, 46, 92 are `adviseTokens` neighbors). The file-merge test at lines 183 to 206 lists option names: extend only if it asserts the full name list.
3. `tests/status.test.ts` and `tests/register.test.ts`: the new status line, and `14 default` where `13 default` is asserted (`tests/status.test.ts:26`, `:54`; `tests/register.test.ts:520`).
4. `tests/register.test.ts`, the hooks driven through `$` with the mock clock advanced by the test (the testing package's clock is the only time source; if a mock clock cannot be advanced between two events through its public API, answer `on('clock.now', ...)` with a sequence instead). Seed `lastContext` with a `session.measure` of 40000 tokens, then complete one main-thread `answer` turn, then:
   - gap 65 minutes, `idleShakeMinutes` 60, tool results present: one compact call whose `instructions` is `'ctrscm:idle'`, `minSavings` effectively 0 (use a config with `minSavings` larger than the available savings and assert artifacts were still written), the prompt `next` runs exactly once, the usage file has `label: 'idle'`, `outcome: 'shook'`, the status line `this session: 1 passes`.
   - gap 59 minutes: no compact, `next` runs once.
   - `idleShakeMinutes` 0 (default): no compact.
   - `$.session.compact` rejects: the log `CTRSCM: idle shake rejected: ...`, a `failed` usage event labeled `idle` with reason `compaction failed`, `stats.last` reading `idle skipped: compaction failed`, `next` runs once, and a second prompt right after (no turn between) triggers no second attempt.
   - gates, each its own case with an otherwise-idle setup: `turnId` present, `origin.kind` `plugin`, `autoShake` off, `isPending` (queued `/shake`), context 29999 tokens, no completed turn yet, and a subagent turn (`agentId` set) that must not set the clock.
   - cooldown: after the idle pass a proactive trigger inside `cooldownTurns` measurements is not requested.
   Existing behavior: every existing test passes unchanged except the literals listed above.

## 4. Out of scope

Persisting `lastTurnAt` so a resumed session can idle-shake (backlog B28, the architect opens it); an origin filter beyond `plugin`; letting the idle pass serve a queued `/shake` or a `wanted` retry; per-model or per-plan TTL; a toast; a report line for idle passes (labels already separate them in the usage log); a context-floor option; changing the default of `idleShakeMinutes`; any change to `shake.ts` selection; queueing a rejected idle request for turn end (a shake after the turn has warmed the cache pays the invalidation `minSavings` guards, so a rejection is dropped).

## 5. Probe result

Pre-lock baseline (2026-10-08, tree clean at `cc98fc5`): `npx tsc -p tsconfig.json` pass, `claude plugin validate . --strict` pass, `claude plugin test .` 106 pass, 0 fail. Read in this tree: `hooks/register.ts` (hooks and the `session.compact` settings line), `hooks/trigger.ts`, `hooks/config.ts`, `hooks/status.ts`, `hooks/shake.ts:141` (`savings < settings.minSavings || selected.length === 0`), `types/claude-code.d.ts` 2449 to 2454, 7184 to 7241, 7015 to 7140 (origin kinds include `plugin`), 10372 to 10391. Content search for the changed strings: `rg -n "13 default"` hits are only the three test lines above; `adviseTokens` is the neighbor option in `hooks/config.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md`, `tests/config.test.ts`, `tests/status.test.ts`, `docs/usage.md`, `docs/examples/ctrscm-150k.json` (the last two are architect-owned or unchanged). The live behavior of `$.session.compact` inside `prompt.submit` is **not verified**; verification is a post-acceptance live probe by the architect's tester, not part of this spec's acceptance.

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
