# Spec 6: make the compaction request at turn end, not inside the measurement

## 0. Status

**LOCKED** (2026-10-06), after the consultant review (section 9), the F5 probe and the pre-lock gate (section 10).

**Scope.** May edit exactly these files and no others: `hooks/register.ts`, `tests/register.test.ts`. Does not touch: `hooks/trigger.ts`,
`hooks/shake.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`, `hooks/config.ts`, `hooks/status.ts`, `hooks/usage.ts`, `.claude-plugin/plugin.json`,
`hooks/hooks.json`, `README.md`, `AGENTS.md`, `docs/*` (the architect updates `docs/usage.md`, `docs/architecture.md`, `docs/backlog.md` at
acceptance), `package*.json`, `tsconfig.json`, the other test files. No new dependency. Do not commit, stage or merge: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, starting at the commit that holds this spec.
**Shared task `context_id`:** `ctrscm-turn-complete`. **Governing documents:** this spec; specs 1 to 5 stay in force except where section 3 amends
them; `AGENTS.md`. **Public test seams:** the registered hooks driven through `$` in `tests/register.test.ts` (`$.session.measure`,
`$.turn.complete`, `$.session.compact` with `as never`, `$.command.run` with `tests/fixtures/commandRunInput.ts`).

## 1. Why

Backlog B22. Live on 2026-10-06 a proactive request failed: the usage log holds `failed` / `compaction failed` at 143359 tokens, and the
host's message was `$.session.compact: a turn is running (<id>); the conversation compacts between turns, so call it from turn.complete or later`.
Spec 2 section 1 recorded a probe that `$.session.compact` works from a `session.measure` hook, but a measurement can also arrive while a turn is
running (during a step), and then the host refuses the nested compaction. Two earlier passes in the same session succeeded because their
measurements arrived between turns.

Two further effects of the same cause: the cooldown is spent before the request (`decideRequest` returns it with the request), and for `/shake`
`isPending` is cleared at the decision, so a refused aggressive request is lost and the owner has to type `/shake` again.

Decision (architect): a refused request is deferred to `turn.complete`, which the host's message names as accepted; a request whose measurement arrives between turns still runs at once.

## 2. Decisions

Revised after the consultant review (a2amx `m_608`, dispositions in section 9). The first draft moved every request to `turn.complete`; that would delay a
request whose measurement arrives between turns, where today's path works.

- **D1.** `session.measure` still decides with `decideRequest` (unchanged) and still tries `$.session.compact` at once. A REJECTION of that call no longer
  fails the request: it defers it. The measure path sets `wanted = request`, logs nothing for the failure, writes no event, and for an aggressive request sets
  `isPending` back to true. No error text is matched.
- **D2.** A new `turn.complete` hook makes the deferred request: only when `wanted !== undefined`, `!isRequesting`, `e.reason === 'answer'` and
  `e.agentId === undefined` (a subagent turn, an abort, a refusal or an error leaves `wanted` set; a turn that ended on `error` is skipped on purpose, the engine
  compacts by itself at its limit). The request is `aggressive` when `isPending` is true, else `wanted` (a `/shake` typed meanwhile upgrades it).
- **D3.** A rejection at `turn.complete` is a real failure: log `CTRSCM: {request} shake failed: {message}`, `stats.last = '{request} skipped: compaction failed'`, write the
  `failed` / `compaction failed` event (same fields as today), and do NOT restore `isPending` (the owner types `/shake` again). So a `/shake` is tried at most twice
  (measure, turn end) and never loops. After the attempt, success or failure, `cooldown = config.cooldownTurns`, so a failed request cannot retry at the next turn end.
- **D4.** While `wanted !== undefined`, `session.measure` does not call `decideRequest` and skips the advice step (the figure is still the pre-pass size, spec 5 section 8).
- **D5.** The request log line (`CTRSCM: requesting proactive shake (context {percent}%)` / `CTRSCM: requesting aggressive shake`) is written once per request, where
  the request is attempted first (in `session.measure`, as today); the retry at `turn.complete` logs `CTRSCM: retrying {request} shake at turn end` (one line, no percent).

## 3. Contracts (amend specs 2 and 5)

Spec 2 section 7 (`session.measure`): a rejection of the nested compaction defers the request (D1) instead of logging failure, writing the event and setting
`stats.last`; `isPending` is restored for an aggressive request. Spec 5 section 8: the `failed` / `compaction failed` event is written only by the `turn.complete`
hook (D3), with the same fields (`label` the request, `contextTokens` and `contextPercent` from `lastContext`, `adviseTokens` null). Everything else (events, outcomes,
texts, the `session.compact` hook, `/ctrscm`, the `/shake` reply) is unchanged.

## 4. `hooks/register.ts`

State: add `let wanted: Request | undefined`. In `session.measure`, wrap today's request branch (current lines 140 to 185): when `wanted !== undefined` do neither the
decision nor the advice step (D4); otherwise unchanged except its `catch` (current lines 154 to 181), which becomes `wanted = request; if (request === 'aggressive') isPending = true`
(D1; the failure log, `stats.last`, `quietRoot` and `writeUsageEvent` move to the `turn.complete` hook). New hook after `session.measure`:

```ts
on('turn.complete', async ($, e, next) => {
  const result = await next(e)
  if (wanted === undefined || isRequesting || e.reason !== 'answer' || e.agentId !== undefined) return result
  const request = isPending ? 'aggressive' : wanted
  wanted = undefined
  isPending = false
  isRequesting = true
  $.ui.log(`CTRSCM: retrying ${request} shake at turn end`)
  try {
    await $.session.compact({ instructions: markOf(request) })
  } catch (error) { /* D3: the moved failure body, no isPending restore */ }
  finally { isRequesting = false; cooldown = config.cooldownTurns }
  return result
})
```

## 5. Tests (written first, literal expected values)

Drive turn ends with `$.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't-1', reason: 'answer' })` after `on('turn.complete', () => ({ text: '' }))` beneath
(public seam: the test-side `turn.complete` at `types/claude-code.d.ts:3909`). The nested compaction of a MARKED call always ends in the mod's own `session.compact` hook,
which answers with a skip and never rejects, so the rejection cases need a seam that makes `$.session.compact` itself reject (for example a test hook for `session.compact`
registered above the mod's tier). The developer finds one in `claude/testing`; if none exists, those cases (marked below with `R`) are reported as not testable, and the architect
verifies them live instead. Existing tests keep their line numbers: 431, 464, 564, 604 stay valid (no measure-path change when the compaction resolves); 345 and 374 (the measure helper
inside 345) need no change. Cases:

- `R` measure at `{ percent: 75 }` with a rejecting compaction: no failure log, no event, no `stats.last` change; `/ctrscm` shows `last: none yet`; then `turn.complete` retries:
  log `CTRSCM: retrying proactive shake at turn end`, one compact call with `instructions` `ctrscm:proactive`.
- `R` a second rejection at `turn.complete`: log `CTRSCM: proactive shake failed: <message>`, one `failed` / `compaction failed` event, `/ctrscm` `last: proactive skipped: compaction failed`;
  a measure right after makes no request (cooldown `cooldownTurns`).
- `R` `/shake`, measure rejecting, `/ctrscm` shows `pending: aggressive shake`; `turn.complete` rejecting: failure logged, `/ctrscm` shows `pending: none`; no third attempt.
- `turn.complete` with `reason: 'aborted'` or `agentId: 'a-1'` makes no attempt and keeps `wanted` (the next normal `turn.complete` retries).
- no advice while `wanted` is pending: a measure at the advice threshold after a rejected request toasts nothing.
- a measure while `isRequesting` is unchanged (existing guard).

## 6. Out of scope

Tracking whether a turn is running (rejected in the review: a rejection already says so); clearing `wanted` on an unmarked compaction (accepted noise: the retry then ends in
`nothing worth shaking`); matching the host's error text; any change to `decideRequest`, config options, `/ctrscm` text, README options; B18, B19; B21.

## 6. Out of scope

Retrying inside the same turn end; restoring the cooldown (D3); any change to `decideRequest`, config options, `/ctrscm` text, README options; the engine's
own `autoCompactThreshold`; B18, B19; the clone/classifier issue (B21).

## 7. Acceptance

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail, every case in section 5 present
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
git status --short   # only the two files named in section 0
```

Further bars: `hooks/trigger.ts` and the other hooks files byte-identical to the base commit; no `session.compact` call remains inside the `session.measure` hook.
Live (an owner session where a measurement arrives mid-turn, the usage log shows `shook` instead of `failed`) is a tester's check afterwards.

## 9. Consultant review dispositions (`m_608`)

F1 adopted in section 5 (rejection seam or live check). F2 adopted: D3 does not restore `isPending`; B22 wording corrected earlier. F3 adopted: D3 resets `cooldown` after the attempt.
F4 adopted by design: the measure path still tries at once (D1). F5 open: whether a compaction at `turn.complete` is accepted is the premise of D2 and D3 and rests on the host's own message;
live probe before lock (section 11). F6 adopted: D4. F7a not adopted (section 6), F7b adopted (D2). F8 adopted: line numbers and missing cases in section 5. F9: numbering gap closed by this section.

## 10. Pre-lock evidence

F5 probe, interactive session (event `cd411fae`, files `/tmp/ctrscm-probe-f5-20261006/events`): a compaction from `session.measure` mid-turn is rejected with the "a turn is running" text; a compaction
from `turn.complete` resolves (it reached the `session.compact` hook); the next measure after the turn end also resolves. A headless `-p` session rejects both with a separate guard, so the live
check is interactive only. Not probed: a queued prompt at turn end, an aborted turn. Gate: section 4 line numbers (140 to 185, catch 154 to 181, `finally` 182) match `hooks/register.ts` at the base commit;
the `requesting` log strings are unchanged by this spec (steps 5 and 10: no rename, no changed constant); D1 to D5, sections 3, 4 and 5 and backlog B22 agree (step 7); worked cases: `/shake` rejected at measure then
accepted at turn end; proactive deferred then upgraded by `/shake`; both end with `isPending` false and `cooldown` equal to `cooldownTurns` (step 8). Section 5 cases marked `R` depend on a rejection seam in
`claude/testing` that nobody has confirmed (step 9): if the developer finds none, they are reported as not testable and the architect checks them live.
