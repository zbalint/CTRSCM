# Spec 5: persistent usage log, context advice, defaults for large windows

## 0. Status

**LOCKED** (2026-10-06, pre-lock gate run; notes in section 12). The owner delegated every design choice to the architect;
decisions are D1 to D7 in section 2. Consultant review: a2amx `m_573`, all findings dispositioned in section 12.

**Scope.** May create or edit exactly these files and no others: `.claude-plugin/plugin.json`; `hooks/config.ts`,
`hooks/trigger.ts`, `hooks/status.ts`, `hooks/register.ts`, and the new `hooks/usage.ts`; `tests/config.test.ts`,
`tests/trigger.test.ts`, `tests/status.test.ts`, `tests/register.test.ts`, the new `tests/usage.test.ts`; `README.md` (the `## Options`
and `## Commands` sections only, section 9a). Does not touch: `hooks/shake.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`, `AGENTS.md`,
`docs/*` (the architect updates `docs/usage.md`, `docs/architecture.md`, `docs/backlog.md` and the module table at acceptance),
`package*.json`, `tsconfig.json`, `hooks/hooks.json`. No new dependency. Do not commit, stage or merge: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, starting at the commit that holds this
spec. **Shared task `context_id`:** `ctrscm-usage-log`. **Governing documents:** this spec; specs 1 to 4 stay in force except where
section 3 amends them; `AGENTS.md`. **Public test seams:** the pure functions of `hooks/config.ts`, `hooks/trigger.ts`,
`hooks/status.ts`, `hooks/usage.ts`; the registered hooks driven through `$` (`$.session.start`, `$.session.measure`,
`$.session.compact` with `as never`, `$.command.run` with the `tests/fixtures/commandRunInput.ts` fixture) in `tests/register.test.ts`.

## 1. Why

The owner will trial the mod over days. Two needs follow. First, large-window models degrade in answer quality as the context
fills (the owner's measured "dumb zone", starting around 150k tokens, safe to work to about 300k, where a reset or compaction is
advised), so the point of Shake is to keep the context below that zone, not to avoid overflowing the window. Shake only removes old
tool output; if the rest of the context is conversation text a pass cannot get under the line, and today a skipped proactive request is
silent. Second, a trial needs numbers afterwards (tokens reclaimed per session) and the mod keeps only in-memory session totals
(`/ctrscm`) that vanish at exit. The defaults also assume a 200k window: on a 1M-window model the default 50% trigger means 500k
tokens. This spec adds a durable per-event usage log, an advice notice when the context stays above a configurable size, and defaults
that suit large windows. The report tool that reads the log is a later spec.

## 2. Decisions

- **D1.** One small JSON file per event, written under `{root}/usage/` (`root` as spec 1: `artifactDir` or `$HOME/.ctrscm/artifacts`).
  `$.fs` has no append and no delete, and one file per event avoids read-modify-write of a shared file. The log holds counts and
  ids only, never tool-result text, tool input or paths.
- **D2.** An event is written for every Shake outcome of a marked request and of an unmarked `manual` (without non-whitespace
  instructions), `auto` or `plugin` compaction: shook, skipped, fallback or failed. Not for `precompute`, and not for a `manual`
  compaction with non-whitespace instructions (those go to the built-in summarizer untouched). An `advice` event is written when advice is shown (D4).
- **D3.** A failed log write never affects a compaction: one `$.ui.log` line `CTRSCM: usage log write failed: {message}` and
  nothing else. No retry. With no artifact root (no `HOME` and no `artifactDir`, or a rejected `HOME` lookup) no event is written and no `usage log write failed` line is logged; a REJECTED `HOME` lookup is still reported once with spec 1's line `CTRSCM: artifact root lookup failed: {message}` (an error is never swallowed silently; Amendment 1), and an unset `HOME` logs nothing as before; root failures leave no record in the log, a known gap
  for the report spec. The event is written after the compaction outcome is decided and, for an unmarked call that will call `next(e)`, BEFORE that call (the built-in summarizer can run for tens of seconds and may reject).
- **D4.** Advice: when the context stays at or above `adviseTokens` and this measurement made no Shake request, the mod shows a toast
  and writes a `$.ui.log` line recommending `/compact` or a new session, at most once per `cooldownTurns` measurements. It never
  compacts. `adviseTokens` 0 turns it off.
- **D5.** Defaults for large windows (owner-supplied heuristic, stated as such in the README): `triggerTokens` 120000, `adviseTokens` 150000.
  `triggerPercent` stays 50 (it still protects small windows).
- **D6.** The `usageLog` option (`"on"` or `"off"`, default `"on"`) switches D1 and D2 off without touching advice.
- **D7.** `contextTokens` and `contextPercent` in a shake event are the figures from the latest `session.measure` seen before the pass
  (the engine's own numbers, null when none has been seen, for example a first-turn `/compact`). They are the best available
  "before" figure and can be stale (a `/compact` typed right after a pass still reports the pre-pass figure until the next measure); the "after" figure comes
  from the next event or from the session file (the report spec).

## 3. Contracts (single source; amends specs 2 and 3 where stated)

**Defaults** (`DEFAULT_CONFIG`): `triggerTokens` 120000 (was 0), and new `adviseTokens` 150000, `usageLog` `true`. All other defaults are unchanged.

**Event shape** (`hooks/usage.ts`), written with `JSON.stringify`:

```json
{ "version": 1, "at": "2026-10-05T00:00:00.000Z", "sessionId": "s-1", "agentId": null, "event": "shake",
  "label": "proactive", "outcome": "shook", "reason": null, "results": 5, "chars": 113480, "estimatedSavings": 28170,
  "artifactIds": ["…"], "contextTokens": 51346, "contextPercent": 26, "adviseTokens": null }
```

`event` is `"shake"` or `"advice"`. `label` is `proactive`, `aggressive`, `manual`, `auto` or `plugin` for a shake event and `null`
for advice. `outcome` is `shook`, `skipped`, `fallback` or `failed` (null for advice). `reason` is the skip reason without its
`ctrscm: ` prefix (`nothing worth shaking`, `shake not applied`, ...), `compaction failed` for a nested compaction that rejected,
else null. `results`, `chars` (sum of externalized text lengths) and `estimatedSavings` are 0 and `artifactIds` is `[]` unless the
outcome is `shook`. `sessionId` is `$.session.id()` (null when it rejects). `agentId` is `e.agentId ?? null`. For an advice event
`contextTokens`/`contextPercent` are the measured figures and `adviseTokens` the configured value; for a shake event `adviseTokens` is null.

`at` is `new Date(await $.clock.now()).toISOString()`, read inside the same guarded write so a clock rejection takes the D3 path.

**File path:** `{root}/usage/{stamp}-{uuid}.json` with `stamp = at` with every `:` and `.` replaced by `-` (for example
`2026-10-05T00-00-00-000Z`) and `uuid` from `crypto.randomUUID()`.

**Advice texts** (toast text equals log text): `CTRSCM: context is {tokens} tokens (advice threshold {adviseTokens}); consider /compact or a new session`.

**Status text** replaces spec 2's block exactly (the literal rows below; changed rows marked with `*`):

```text
CTRSCM status
auto: {on|off} (trigger {triggerPercent}% or {triggerTokens} tokens, 0 = off; cooldown {cooldownTurns} turns)
advice: at {adviseTokens} tokens, 0 = off *
shake: protect {protectTokens}, aggressive protect {aggressiveProtectTokens}, min savings {minSavings}, min result {minResultTokens} (estimated tokens)
protected tools: {comma-separated list, or none}
artifacts: {root, or unavailable (no HOME)}
usage log: {on|off} ({root}/usage, or unavailable (no HOME)) *
this session: {passes} passes, {results} results shaken, ~{savings} estimated tokens saved
last: {last}
pending: {none|aggressive shake}
```

## 4. `hooks/config.ts`

Extend `Config` with `adviseTokens: number` and `usageLog: boolean`; `DEFAULT_CONFIG` per section 3. `adviseTokens`: safe integer at least 0 (same
parsing and problem text rule as spec 4's other numeric options: `option adviseTokens: must be a safe integer at least 0; using the default`).
`usageLog`: the strings `"on"`/`"off"` (trimmed, lower-cased) or a boolean; anything else keeps the default and adds
`option usageLog: must be "on" or "off"; using the default`. Never throws. The `triggerTokens` default change is a value change only.

## 5. `hooks/trigger.ts`

New pure function:

```ts
export function decideAdvice(
  context: { tokens?: number },
  config: Pick<Config, "adviseTokens" | "cooldownTurns">,
  state: { cooldown: number },
): { advise: boolean; cooldown: number }
```

In order: `config.adviseTokens === 0` or `context.tokens === undefined` gives `{ advise: false, cooldown: 0 }`; `state.cooldown > 0` gives
`{ advise: false, cooldown: state.cooldown - 1 }`; `context.tokens >= config.adviseTokens` gives `{ advise: true, cooldown: config.cooldownTurns }`;
otherwise `{ advise: false, cooldown: 0 }`. Worked example (`adviseTokens` 150000, `cooldownTurns` 3): tokens 149999 gives no advice; 150000
advises (cooldown 3); then three measurements at 160000 give no advice (cooldown 2, 1, 0); the fourth advises again.

## 6. `hooks/usage.ts` (pure: no `$`, no I/O)

```ts
export type UsageEvent = { version: 1; at: string; sessionId: string | null; agentId: string | null; event: "shake" | "advice";
  label: string | null; outcome: "shook" | "skipped" | "fallback" | "failed" | null; reason: string | null; results: number; chars: number;
  estimatedSavings: number; artifactIds: string[]; contextTokens: number | null; contextPercent: number | null; adviseTokens: number | null }
export function usageEventPath(root: string, at: string, uuid: string): string
```

`usageEventPath` returns `{root without trailing slashes}/usage/{stamp}-{uuid}.json` per section 3. (The event is built inline in `register.ts` as
a `UsageEvent` literal; only the type and the path function are module exports.)

## 7. `hooks/status.ts`

`statusText(config, root, stats, isPending)` produces the section 3 block; `{root}` has trailing `/` characters removed (as `usageEventPath` does). `root` undefined gives `usage log: {on|off} (unavailable (no HOME))`.

## 8. `hooks/register.ts`

New closure state: `adviceCooldown = 0`, `lastContext: { tokens: number | null; percent: number | null }` (null/null initially).

- **`session.measure`** (spec 2 section 7, extended): when `e.changed` includes `"context"`, first store `lastContext` from `e.context`. Spec 2's request logic is
  unchanged. When it made no request (and `!isRequesting`), run `decideAdvice(e.context, config, { cooldown: adviceCooldown })`, store the returned
  cooldown, and when `advise` is true: `$.ui.toast(text)` and `$.ui.log(text)` (section 3 text), and write an advice event (D1, if `config.usageLog` and a root exists).
  A request in this measurement skips the advice step entirely (the figure is the pre-pass size) and leaves `adviceCooldown` unchanged.
- **`session.compact`:** write one shake event (D1, D2) on every return path below, using the outcome and reason in the table; the label is the request name for a marked call and
  the trigger name for an unmarked one. The write is guarded (D3) and never changes the returned value.

| Return path (`hooks/register.ts`) | Marked call | Unmarked `manual`/`auto`/`plugin` call |
| --- | --- | --- |
| `precompute` | no event | no event |
| `manual` with non-whitespace instructions to the built-in | not reachable | no event |
| no transcript (`messages` not an array) | `skipped`, `no transcript` | not reachable |
| recovery tool not registered | `skipped`, `recovery tool not registered` | `fallback`, `recovery tool not registered` |
| nothing worth shaking | `skipped`, `nothing worth shaking` | `fallback`, `nothing worth shaking` |
| artifact root unavailable (lookup rejected or undefined) | no event (D3) | no event (D3) |
| artifact write failed | `failed`, `artifact write failed` | `fallback`, `artifact write failed` |
| success | `shook`, reason null | `shook`, reason null |

  `fallback` is the outcome whenever the configured fallback was taken (`next(e)` for `builtin`, the skip answer for `skip`); the `reason` records the underlying cause, not the generic
  `shake not applied` (which stays only in `stats.last`). The nested-compaction rejection caught in `session.measure` writes a `failed` event with reason `compaction failed`; if the host can
  reject after the hook already wrote its own event, both events exist (accepted).
- Resolve `sessionId` once per event with `$.session.id()` in a try (null on rejection, no log line for that).
- `/ctrscm` passes the artifact root exactly as spec 2.

`.claude-plugin/plugin.json`: add string options `adviseTokens` ("150000") and `usageLog` ("on", `options` `["on", "off"]`); change the `triggerTokens` default to "120000".
Defaults must equal section 3.

## 9. Tests (written first, literal expected values)

Registered-hook tests cannot inject custom `PluginOptions` (backlog B10), so they run with the defaults; behavior that needs a non-default option (`usageLog` off, `autoShake` off) is covered by the
pure tests only.

- `config`: defaults on empty options include `triggerTokens` 120000, `adviseTokens` 150000, `usageLog` true; `adviseTokens` `"0"` accepted, `"abc"` and `-1` keep the default with the problem text in section 4;
  `usageLog` `"off"`, `"ON "`, `false`; an invalid `usageLog` keeps the default with one problem. Existing assertions of the old `triggerTokens` default 0 (`tests/config.test.ts` near lines 15, 43 and 86) change to 120000.
- `trigger`: `decideAdvice` for off (0), undefined tokens, 149999, 150000, the cooldown sequence in section 5, and the cooldown value returned after advice.
- `usage`: `usageEventPath("/home/example/.ctrscm/artifacts/", "2026-10-05T00:00:00.000Z", "u-1")` equals `/home/example/.ctrscm/artifacts/usage/2026-10-05T00-00-00-000Z-u-1.json`.
- `status`: the section 3 block for the default config with root `/home/example/.ctrscm/artifacts/` (note the trailing slash), the stats and pending state of spec 2's literal block, equals the block
  with `auto: on (trigger 50% or 120000 tokens, 0 = off; cooldown 3 turns)`, `advice: at 150000 tokens, 0 = off`, `usage log: on (/home/example/.ctrscm/artifacts/usage)`; with root undefined the rows read
  `artifacts: unavailable (no HOME)` and `usage log: on (unavailable (no HOME))`; with `adviseTokens` 0 and `usageLog` false the rows read `advice: at 0 tokens, 0 = off` and `usage log: off (/home/example/.ctrscm/artifacts/usage)`.
  The existing status assertions (`tests/status.test.ts` near lines 14 to 15 and 34 to 35) change accordingly.
- `register`, through `$` with the defaults; beneath answers `session.id` returns `{ value: "s-1" }`, `clock.now` fixed at `2026-10-05T00:00:00.000Z` (`mock.clock`), `fs.write` records `{ path, text }`, `ui.toast` and `ui.log` record,
  `session.measure` echoes `changed`, `command.register`/`tool.register` as in earlier tests, `HOME` `/home/example`.
  Existing register tests that reach a tracked outcome now also see the event write: they must provide the answers above (their `writes` and `logs` assertions then include the event file, for example the `writes` length 2 at
  `tests/register.test.ts:101` becomes 3 and 4 at `:206` becomes 5; the artifact-write-failure test near `:581` now logs a second line beginning `CTRSCM: usage log write failed: `). Keep every assertion literal.
  - Advice sequence (default config, so proactive requests happen at 120000 tokens or 50%): M1 `{ tokens: 150000, percent: 75 }` logs `CTRSCM: requesting proactive shake (context 75%)`, shows no toast, and the nested bare
    compaction writes one shake event `{ label: "proactive", outcome: "skipped", reason: "no transcript", results: 0, contextTokens: 150000, contextPercent: 75 }`; M2 `{ tokens: 149999, percent: 75 }` (request cooldown) requests nothing,
    toasts nothing, writes nothing; M3 `{ tokens: 150000, percent: 75 }` toasts and logs `CTRSCM: context is 150000 tokens (advice threshold 150000); consider /compact or a new session` and writes one advice event whose parsed JSON equals
    `{ "version": 1, "at": "2026-10-05T00:00:00.000Z", "sessionId": "s-1", "agentId": null, "event": "advice", "label": null, "outcome": null, "reason": null, "results": 0, "chars": 0, "estimatedSavings": 0, "artifactIds": [],
    "contextTokens": 150000, "contextPercent": 75, "adviseTokens": 150000 }`; M4 `{ tokens: 160000, percent: 80 }` (advice cooldown) toasts nothing; M5 `{ tokens: 160000, percent: 80 }` makes a proactive request again (request cooldown over) and
    no advice. A measure with `changed: ["rateLimits"]` does nothing.
  - Shake events: a marked proactive `$.session.compact({ trigger: "plugin", instructions: "ctrscm:proactive", messages } as never)` on transcript X (spec 2) with no prior measure writes one event with
    `label "proactive"`, `outcome "shook"`, `reason null`, `results 1`, `chars 80000`, `estimatedSavings 19960`, `artifactIds` of length 1 equal to the artifact id observed through the `fs.write` hook,
    `contextTokens null`, `contextPercent null`, `sessionId "s-1"`, at the fixed clock, and the event path equals `usageEventPath("/home/example/.ctrscm/artifacts", "2026-10-05T00:00:00.000Z", <the uuid in the observed path>)`;
    a marked call on a below-`minSavings` transcript writes `skipped` / `nothing worth shaking` and never calls the layer beneath; an unmarked `auto` compaction on that transcript takes the default `builtin` fallback and writes
    `fallback` / `nothing worth shaking` (the event write is observed before the layer beneath returns: have the beneath hook record the number of event writes seen when it runs, expected 1); a `manual` compaction with
    instructions `summarize` writes no event; `precompute` writes no event; a rejected event `fs.write` (artifact writes succeed) logs `CTRSCM: usage log write failed: ` once and the returned `{ messages }` is unchanged; with no
    `HOME` (and `artifactDir` unset) no event is written and nothing is logged; with a rejected `HOME` lookup no event is written and exactly one line `CTRSCM: artifact root lookup failed: ` plus the message is logged, in the compaction hook and in the measure advice path alike.

## 9a. `README.md`

In `## Options`: add rows for `adviseTokens` (`150000`, advice notice threshold, 0 = off) and `usageLog` (`on`, per-event usage files under the artifact root) and change the `triggerTokens` default to `120000`.
Add two sentences: the log files hold counts and ids only (no tool text), one file per event under `{artifact root}/usage/`; and on a 200k window the default `triggerPercent` 50 (100k tokens) fires before
`triggerTokens` 120000, which only matters on larger windows; `adviseTokens` 150000 and `triggerTokens` 120000 follow the owner's observation that answer quality degrades from roughly 150k tokens. In `## Commands`:
`/ctrscm` also shows the advice setting and the usage log location. No other README section changes.

## 10. Out of scope

The report tool that joins the log with session files (a later spec); making the trigger relative to the engine's `autoCompactThreshold`; automatic compaction by the advice;
cleanup or rotation of the log or the artifacts; measuring the quality effect of context size; any change to `hooks/shake.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`.

## 11. Acceptance

Run from `/home/zbalint/workspace/CTRSCM` after implementation (all require the new code):

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail, every behavior in section 9 present
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
rg -n "as never" hooks                                           # no output
git status --short   # only files named in section 0
```

Further bars: the defaults in `plugin.json`, `DEFAULT_CONFIG` and section 3 are identical (`triggerTokens` 120000, `adviseTokens` 150000, `usageLog` on); the status text,
advice text, event shape and path match section 3 byte for byte (the tests assert literals); `hooks/shake.ts`, `hooks/artifacts.ts`, `hooks/recover.ts` are byte-identical to the
base commit; no event contains tool-result text, tool input or paths other than the artifact root in the file path; nothing is committed. Live behavior (advice shown in a
real session, event files on disk) is not part of this acceptance; a tester verifies it afterwards.

## 12. Pre-lock gate notes (2026-10-06)

Baseline at the base commit (`5856699`): `claude plugin validate . --strict` passes, `claude plugin test .` 51 pass, `tsc` exit 0 (run by the architect at acceptance of spec 4). Probes (throwaway plugin, real engine, 2026-10-05):
`$.session.measure`, `$.session.compact` inside a measure hook and a bare test compaction without `messages`; the remaining seams (`$.session.id`, `ui.toast`, `clock.now`, `fs.write`) are plain ops exercised by earlier tests.
Scope derived from the finished sections: files that assert the old `triggerTokens` default 0 (`tests/config.test.ts`) or the old status block (`tests/status.test.ts`) and register tests that reach a tracked outcome
(`tests/register.test.ts`), all in section 0 (found by `rg "triggerTokens|trigger 50%|usage|writes"` over `tests/`); `tests/trigger.test.ts` is unaffected except the new cases. `plugin.json` (two new options, one changed default) is in section 0; README sections in section 9a.
`docs/usage.md` and `docs/architecture.md` are architect-edited. Values stated twice (defaults, event shape, advice and status texts, path) were compared across sections 3, 5 to 9 and 11. Worked numbers recomputed: advice sequence M1 to M5 with request
cooldown 3 and advice cooldown 3 (M2 request cooldown 2, M3 1 advises, M4 0, M5 requests again); transcript X proactive gives results 1, chars 80000, savings 19960.

Consultant review (`m_573`), dispositions: F1 existing register tests need the beneath answers and adjusted counts (section 9); F2 the 149999 case replaced by the sequence that avoids a proactive request (section 9, M2); F3 root skip removed from the mapping and D3 states root failures leave no record; F4 full path/outcome table in section 8, fallback events written before `next(e)`, unmarked reasons record the underlying cause,
unmarked write failure is `fallback`; F5 literal advice event and sequence, shake event with no prior measure so context figures are null, `at` source stated; F6 stale-figure note in D7; F7 old-assertion locations listed; F8 trailing slash handled in `statusText`; the 200k-window note added to the README (section 9a). Not adopted: none. Left open on purpose: the report tool, the engine-relative trigger, live behavior (advice shown and event files on disk, verified by a tester afterwards).

## 13. Amendment 1: a rejected HOME lookup is still logged (2026-10-06, architect review of the first implementation)

Origin: the developer removed spec 1's `CTRSCM: artifact root lookup failed: {message}` log line from `session.compact` (and the new event helper swallows the rejection), reading D3 ("nothing is logged")
as covering the lookup error. That reading removes a locked spec 1/2 behavior ("a rejected `HOME` lookup (logged as in spec 1)", spec 2 section 7) and conflicts with `AGENTS.md` ("never swallow an error silently").
D3's "nothing is logged" meant no usage-log line. Ruling: the lookup error is logged exactly once per lookup with the spec 1 line, everywhere the mod resolves the root
(the compaction hook, and the event helper in the measure paths); an unset or empty `HOME` (no rejection) logs nothing; neither case writes an event. D3 and the last test bullet in section 9 are edited in place.
Gate re-run for the amendment: `rg -n "nothing is logged" docs/specs/spec-5-usage-log-and-advice.md` shows only qualified statements.
