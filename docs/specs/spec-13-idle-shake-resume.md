# Spec 13: idle Shake after a resumed or forked session (backlog B28)

## 0. Status

**LOCKED** (2026-10-09), revision 1. Consultant `m_851` applied (it replaced the planned per-turn stamp file with the engine's own resume data). Owner decisions: none needed beyond spec 12; the owner was away and delegated the design to the architect.

**Scope.** Edits: `hooks/register.ts`, `tests/register.test.ts`, and one new file `tests/fixtures/classicSessionStart.ts` (section 3 item 2). Does not touch: any other `hooks/*`, `.claude-plugin/plugin.json`, `README.md`, other `tests/*`, `docs/*`, `types/`, `AGENTS.md` (the architect edits `AGENTS.md`, `docs/usage.md`, `docs/backlog.md` after acceptance). No new dependency. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-idle-resume`.
**Public test seams:** the registered hooks driven through `$` (`classic.SessionStart` via the fixture, `prompt.edit` via `tests/fixtures/promptEdit.ts`, `turn.complete`, `session.measure`, the mock clock, `session.compact`, `ui.log`, `fs.write`).

## 1. Why

Idle Shake (spec 12) remembers the end of the last turn in memory only (`lastTurnAt`, `hooks/register.ts:112`), so after `--resume`, `--continue` or a fork it never fires, although the prompt cache is certainly cold after a long gap. The engine already reports this at start: the classic `SessionStart` hook input (`SessionStartHookInput`, `types/claude-code.d.ts:9153` to `9175`) carries, for `source` `resume` or `fork` only, `seconds_since_last_response`, `context_tokens` and `prompt_cache_likely_expired`. A mod can hook it as `classic.SessionStart` (`ClassicEventName`, `types/claude-code.d.ts:938` to `952`). So no stamp file, no usage-log read and no id-stability question: seed the same state spec 12 keeps, once, at start.

**Verified before locking (architect probe, 2026-10-09, scratch plugin outside the repo, `claude plugin test`):** a hooks module's `on('classic.SessionStart', ...)` is run by the mock engine when the test calls `$.classic.SessionStart(input)`, with `e.source` and `e.prompt_cache_likely_expired` readable; without a bottom `on('classic.SessionStart', ...)` handler the call fails with `no implementation for classic.SessionStart`. The public `Engine` type has no `classic` member (`Property 'classic' does not exist on type 'Engine'` from `tsc`), so the tests need a cast fixture, as spec 12 did for `prompt.edit`.

**Still not known (live):** whether the real host raises `classic.SessionStart` to a hooks module, and in what order relative to `session.start`. The change is **safe either way**: if the hook never fires, behavior is exactly today's (no seeding), and the option stays gated by `idleShakeMinutes` (D1).

## 2. Decisions

- **D1. A `classic.SessionStart` hook**, `on('classic.SessionStart', async ($, e, next) => ...)` in `hooks/register.ts`, using `$.` members directly (spec 12 D9: never pass `$` to a function local to `register()`). It seeds state only when **all** hold: `config.idleShakeMinutes > 0`; `e.source === 'resume' || e.source === 'fork'`; `e.prompt_cache_likely_expired === true`; `typeof e.seconds_since_last_response === 'number'` and finite and `>= 0`; `typeof e.context_tokens === 'number'` and finite and `>= 0`. Otherwise it does nothing. In every case it ends with `return next(e)` exactly once; any error is caught and logged, never rethrown, so session start is never blocked.
- **D2. What it seeds.** `lastTurnAt = (await $.clock.now()) - seconds_since_last_response * 1000` and a new module state `let resumedContextTokens: number | undefined` set to `e.context_tokens`. On a throw from `$.clock.now()`: `$.ui.log('CTRSCM: idle clock failed: {message}')` (the text spec 12 already uses) and seed nothing. Seeding overwrites `lastTurnAt` only if it is `undefined` (a registration that already completed a turn keeps its own clock). It does not touch `lastContext`, so usage events and the proactive trigger are unaffected.
- **D3. The idle gate.** In the `prompt.edit` hook (`hooks/register.ts:388` to `411`) gate 3 reads the context size as `const contextTokens = lastContext.tokens ?? resumedContextTokens`; the gate is `contextTokens !== undefined && contextTokens !== null && contextTokens >= IDLE_MIN_CONTEXT_TOKENS` (written however keeps `tsc` strict clean). `lastContext.tokens` wins once a `session.measure` has run. Everything else in the `prompt.edit` hook is unchanged: the elapsed check still compares `now - lastTurnAt` with `config.idleShakeMinutes * 60000`, so the owner's own threshold applies and the engine's `prompt_cache_likely_expired` is only a precondition. After an attempt `lastTurnAt = undefined` as today (one attempt per gap); also set `resumedContextTokens = undefined` there.
- **D4. Stale state.** A completed main-thread `answer` turn (the existing `turn.complete` code) sets `lastTurnAt` as today and also `resumedContextTokens = undefined` (measurements own the size from then on).
- **D5. Invariants.** No product invariant changes: the pass is a spec-12 idle request (artifact first, placeholders, a failure leaves the transcript untouched), no body is logged, nothing is written by the new hook. No `// shortcut:` is added; the existing `IDLE_MIN_CONTEXT_TOKENS` comment stays.

## 3. Tests

Write the failing test first, one behavior at a time. Literals only (AGENTS.md).

1. `tests/register.test.ts`, the hooks driven through `$`, mock clock, with spec 12's compact stack (the existing `idleHost` prepend plugin and a bottom `on('session.compact', ...)`, and a bottom `on('classic.SessionStart', () => ({}))`). Config `idleShakeMinutes` 65. Cases:
   - `source: 'resume'`, `seconds_since_last_response: 4000` (66.7 min), `context_tokens: 40000`, `prompt_cache_likely_expired: true`: `await classicSessionStart($, input)` returns what the bottom handler returned; then one `promptEdit($, ...)` with `origin: { kind: 'composer' }` gives one compact call with `instructions` `'ctrscm:idle'`, a usage file with `label: 'idle'` and `outcome: 'shook'`, and the typed text reaches the caller. Same with `source: 'fork'`.
   - `seconds_since_last_response: 3000` (50 min): the first edit makes no compact; after the clock advances 16 minutes the next edit makes one (the elapsed time counts from the seeded start of the gap).
   - no compact for each of: `source: 'startup'`; `prompt_cache_likely_expired: false`; `prompt_cache_likely_expired` absent; `seconds_since_last_response` absent; `context_tokens: 29999`; `idleShakeMinutes` 0 (default); `autoShake` off.
   - after a completed main-thread `answer` turn following the seeding, `lastTurnAt` is the new turn's time (an edit right after it makes no compact even though the seeded gap was long).
   - a clock failure (`$.clock.now()` throws) logs `CTRSCM: idle clock failed: ...` and the call still returns normally.
   - `session.measure` of 10000 tokens after seeding with `context_tokens: 40000`: the measured size wins, so the edit makes no compact (below the 30000 floor).
   Existing behavior: every existing test passes unchanged.
2. `tests/fixtures/classicSessionStart.ts`, one export, exactly this shape (the mock engine dispatches `classic.SessionStart`, but the public `Engine` type has no `classic` member, so this fixture holds the only new cast; `AGENTS.md` documents it as a test seam, the architect edits that sentence):
```ts
import type { ClassicEventOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'

type ClassicDispatch = { classic: { SessionStart: (e: ClassicEventOf['classic.SessionStart']) => Promise<unknown> } }

// the mock engine dispatches classic.* events though the public Engine type omits them
export function classicSessionStart($: Engine, e: ClassicEventOf['classic.SessionStart']): Promise<unknown> {
  return ($ as unknown as ClassicDispatch).classic.SessionStart(e)
}
```
   If `ClassicEventOf` is not exported by `claude-code`, import the type the same way `tests/fixtures/promptEdit.ts` does for `PromptEditInput` and tell the architect; do not widen the cast.

## 4. Out of scope

Persisting anything to disk; reading the usage log or transcript; a resume toast or report line; reading `estimated_cache_write_usd`; changing `idleShakeMinutes`, its default or `IDLE_MIN_CONTEXT_TOKENS`; `source: 'clear'` or `'compact'`; non-composer origins (backlog B29). The live check that the real host raises `classic.SessionStart` to a hooks module is a post-acceptance probe by the architect, not part of acceptance.

## 5. Probe result

Pre-lock baseline (2026-10-09, tree at `c4d6b88`, clean): `npx tsc -p tsconfig.json` exit 0, `claude plugin validate . --strict` pass, `claude plugin test .` 120 pass, 0 fail. Probe of section 1 run in a scratch plugin (not in the repo). Read: `hooks/register.ts` 100 to 135 and 300 to 440, `types/claude-code.d.ts` 938 to 952 and 9153 to 9175, `hooks/usageLog.ts`. Content search: `lastTurnAt` is used at `hooks/register.ts:112, 327, 330, 398, 411, 413` only; `IDLE_MIN_CONTEXT_TOKENS` at the gate (`:400`).

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "classic.SessionStart|resumedContextTokens" hooks tests
rg -n "as unknown as" hooks tests
git diff --check
git status --short
```

`rg -n "as unknown as" hooks tests` hits only `tests/fixtures/promptEdit.ts` and `tests/fixtures/classicSessionStart.ts`. All three gates pass with no warnings; the test count is the baseline 120 plus the new tests, 0 fail; `git status --short` shows only files named in section 0.
