# Spec 2: proactive Shake, `/shake` and `/ctrscm` commands, image safety

## 0. Status

**LOCKED** (2026-10-05, pre-lock gate run; notes in section 12). The owner delegated every design choice to the
architect; decisions are D1 to D9 in section 2. Consultant review: a2amx `m_517`, all findings dispositioned in section 12.

**Scope.** May create or edit exactly these files and no others:

- `.claude-plugin/plugin.json`
- `hooks/config.ts`, `hooks/shake.ts`, `hooks/register.ts`, and the new `hooks/trigger.ts`, `hooks/status.ts`
- `tests/config.test.ts`, `tests/shake.test.ts`, `tests/register.test.ts`, the new `tests/trigger.test.ts`,
  `tests/status.test.ts`, and `tests/fixtures/*.ts` (one export per file)
- `README.md` (`## Status`, `## Trying it`, and new `## Options` and `## Commands` sections only),
  `docs/backlog.md` (add rows for new findings only)

Does not touch: `hooks/artifacts.ts`, `hooks/recover.ts`, `tests/artifacts.test.ts`, `tests/recover.test.ts`,
`AGENTS.md`, `docs/intent.md`, `docs/architecture.md`, `docs/specs/*`, `.gitignore`, `LICENSE`,
`.gitattributes`, `a2amx.toml`, `package.json`, `package-lock.json`, `tsconfig.json`, `hooks/hooks.json`,
anything outside the repository. No new dependency. Do not commit, stage or merge: leave the diff uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, starting at the commit
that holds this spec. **Shared task `context_id`:** `ctrscm-proactive-shake`. **Governing documents:** this spec;
spec 1 (`docs/specs/spec-1-core-shake.md`, everything it locks and this spec does not change stays in force);
`docs/architecture.md`; `AGENTS.md`. **Reference declarations:** `types/claude-code.d.ts` (already in the tree).

**Public test seams:** the pure functions of `hooks/config.ts`, `hooks/shake.ts`, `hooks/trigger.ts`,
`hooks/status.ts`; and the registered hooks driven through `$` (`$.session.start`, `$.session.measure`,
`$.session.compact`, `$.command.run`, `$.tool.call`) in `tests/register.test.ts`.

## 1. Why

Spec 1 shakes only when Claude Code itself compacts. The engine's auto-compaction window cannot be set below
100k tokens, so a session reaches provider-side summarization before Shake is ever asked. OMP's Shake instead runs
proactively as the context fills, which is what makes OMP sessions run for hours. This spec adds that: a
`session.measure` hook compares the context fill with configurable thresholds after each turn and asks the engine to
compact through `$.session.compact`, which lands in the existing `session.compact` hook; the proactive pass never falls back
to the built-in summarizer. It adds a `/shake` command (aggressive pass, smaller protected tail) and a `/ctrscm` status
command, and one safety rule found by reading the declarations (images). Live evidence from spec 1 (context
`ctrscm-live-verify`): a manual `/compact` shook two results and the model recovered the exact text through
`mcp__ctrscm__recover`; recovery is callable after `--resume`; images in their own tool-result message survived.
Probes for this spec (throwaway plugin outside the repository, 2026-10-05) established: `$.session.compact()` called
from a `session.measure` or `turn.complete` hook runs the `session.compact` hook; called from a `command.run` hook it
is refused by the host ("it would compact under the turn this hook is holding; call it from a later event"), and so
is `$.command.run`. Hence `/shake` only queues a request (D5).

## 2. Decisions

- **D1.** The proactive trigger is a `session.measure` hook (the engine pushes the context figures after each
  main-thread turn; no polling, no extra `$.session.usage()` call). It acts only when `e.changed` includes `"context"`.
- **D2.** A request is made with `await $.session.compact({ instructions: MARK })` where `MARK` is
  `PROACTIVE_MARK` (`"ctrscm:proactive"`) or `AGGRESSIVE_MARK` (`"ctrscm:aggressive"`). The marker travels in
  `instructions` because that is the only argument `$.session.compact` takes, and it keeps the request testable without
  hidden state. The `session.compact` hook recognizes a marked call by `e.instructions === MARK` (exact equality,
  whatever the trigger) and never passes a marked call to `next(e)`: the built-in summarizer must never run
  unprompted, and the marker must never reach it. A marked `precompute` keeps spec 1's answer (step 1 of section 7 runs first).
- **D3.** Thresholds: Shake is requested when `triggerTokens > 0` and the engine's `context.tokens >= triggerTokens`, or
  when `context.percent >= triggerPercent`. A figure the engine did not report (undefined) never triggers.
- **D4.** After every request the trigger waits `cooldownTurns` measurements before it may request again (a request
  that shook nothing included), so a transcript with nothing left to shake is not retried every turn.
- **D5.** `/shake` cannot compact from its own `command.run` hook (probe). It sets a pending flag and answers at
  once; the next `session.measure` that reports a context change (the next turn's end) consumes the flag and requests an aggressive pass,
  ignoring thresholds and cooldown.
- **D6.** An aggressive pass uses `aggressiveProtectTokens` (default 4000, OMP's manual `/shake` value) instead of
  `protectTokens`; everything else is the configured selection.
- **D7.** A marked request that cannot shake answers `{ skip: ... }` with a reason (section 7), whatever
  `fallback` says. `fallback` keeps its spec 1 meaning for unmarked compactions only.
- **D8.** Image safety: a user message is never rebuilt, and none of its results is selected, when any of its
  `toolResults` carries an image block (section 5). `SessionMessage` exposes no content blocks, so the check scans
  each result's `result` field for them. The `base64` key rule is deliberately conservative: any record carrying base64
  data is left alone.
- **D9.** Options stay strings in `plugin.json` (spec 1 D9). `autoShake` is `"on"` or `"off"`.

## 3. Contracts (single source)

**Defaults** added to `DEFAULT_CONFIG` (`hooks/config.ts`), all others unchanged from spec 1: `autoShake` `true`,
`triggerPercent` 50, `triggerTokens` 0 (off), `cooldownTurns` 3, `aggressiveProtectTokens` 4000.

**Constants** (`hooks/trigger.ts`): `PROACTIVE_MARK = "ctrscm:proactive"`, `AGGRESSIVE_MARK = "ctrscm:aggressive"`.

**Skip reasons** (answered as `{ skip: "ctrscm: <reason>" }` by a marked call): `recovery tool not registered`,
`no transcript`, `nothing worth shaking`, `artifact root unavailable`, `artifact write failed`. One more reason, `compaction failed`, is never answered
by the hook: `session.measure` records it when the nested `$.session.compact` rejects (section 7).

**Log lines** (`$.ui.log`, counts and ids only): `CTRSCM: requesting proactive shake (context {percent}%)`,
`CTRSCM: requesting aggressive shake`, `CTRSCM: {request} shake failed: {message}`, `CTRSCM: command registration failed: {message}`. Spec 1 lines stay as locked, including
`CTRSCM: shook {n} tool results (~{savings} estimated tokens)`. `{percent}` is `context.percent` or `?` when undefined.

**Status text** (`statusText`, section 6), exactly, one line per row, no trailing newline:

```text
CTRSCM status
auto: {on|off} (trigger {triggerPercent}% or {triggerTokens} tokens, 0 = off; cooldown {cooldownTurns} turns)
shake: protect {protectTokens}, aggressive protect {aggressiveProtectTokens}, min savings {minSavings}, min result {minResultTokens} (estimated tokens)
protected tools: {comma-separated list, or none}
artifacts: {root, or unavailable (no HOME)}
this session: {passes} passes, {results} results shaken, ~{savings} estimated tokens saved
last: {last}
pending: {none|aggressive shake}
```

`{last}` is `none yet`, `{label} shook {n} results (~{savings} estimated tokens)`, or `{label} skipped: {reason}` where
`{label}` is `proactive`, `aggressive`, or the spec 1 trigger name (`manual`, `auto`, `plugin`) for an unmarked
compaction, and `{reason}` is a skip reason without its `ctrscm: ` prefix (for an unmarked fallback `shake not applied`).

**Command replies** (`command.run` answers `{ text }`): `/shake` queued: `CTRSCM: aggressive shake queued; it runs when
the next turn completes`; `/shake` while `isRecoverReady` is false: `CTRSCM: recovery tool unavailable; shake not queued`;
`/ctrscm`: the status text.

## 4. `hooks/config.ts`

Extend `Config` with `autoShake: boolean`, `triggerPercent: number`, `triggerTokens: number`, `cooldownTurns:
number`, `aggressiveProtectTokens: number`, and `DEFAULT_CONFIG` per section 3.

- `autoShake` accepts the strings `"on"` and `"off"` (trimmed, lower-cased) or a boolean. Anything else keeps the default
  and adds one problem `option autoShake: must be "on" or "off"; using the default`.
- `triggerPercent`: safe integer 1 to 99. `triggerTokens`, `cooldownTurns`, `aggressiveProtectTokens`: safe integer at least
  0. Parsing, the string rule and the problem text follow spec 1 section 4. Extend the existing numeric helper's
  signature with a maximum and a reason text (do not add a second helper); the problem for `triggerPercent` reads
  `option triggerPercent: must be a safe integer from 1 to 99; using the default`, for the others as spec 1 with minimum 0.
- The problem texts of the three spec 1 numeric options stay byte-identical (`tests/config.test.ts` asserts them).
- Never throws.

## 5. `hooks/shake.ts`

Add `export function hasImage(value: unknown): boolean`: true when `value` is, or contains at any depth of at most
8, an object with `type === "image"` or an own key named `base64`; arrays and plain objects are walked; cycles are
bounded by the depth limit; never throws. In `selectResults`, a user message is skipped (none of its results is a
candidate) when `hasImage(result)` is true for any of its `toolResults` entries' `result` field. `rebuild` is unchanged.
Worked example (transcript W): spec 1 section 5's messages m0 to m5 with defaults, except m2's `toolResults` is
`[tu1 (text 80000 chars, result the same string), tu3 (text "", result { "type": "image", "source": { "data": "AAAA" } })]`.
`selectResults` returns `{ selected: [], savings: 0 }`: m2 is skipped whole because of tu3 (and m4 is protected, tail 1).
With tu3 removed it returns `selected` `[tu1]` and `savings` 19960, as in spec 1.

## 6. `hooks/trigger.ts` and `hooks/status.ts` (pure: no `$`, no I/O)

```ts
export type Request = "proactive" | "aggressive"
export function markOf(request: Request): string
export function requestOf(instructions: string | undefined): Request | undefined   // exact equality with a mark
export function decideRequest(
  context: { tokens?: number; percent?: number },
  config: Pick<Config, "autoShake" | "triggerPercent" | "triggerTokens" | "cooldownTurns">,
  state: { cooldown: number; isPending: boolean },
): { request: Request | undefined; cooldown: number }
```

`decideRequest`, in order: (1) `state.isPending` gives `{ request: "aggressive", cooldown: config.cooldownTurns }`;
(2) `state.cooldown > 0` gives `{ request: undefined, cooldown: state.cooldown - 1 }`; (3) `config.autoShake` and the
D3 test true gives `{ request: "proactive", cooldown: config.cooldownTurns }`; (4) otherwise `{ request: undefined,
cooldown: 0 }`.

```ts
export type Stats = { passes: number; results: number; savings: number; last: string }
export function statusText(
  config: Config, root: string | undefined, stats: Stats, isPending: boolean,
): string
```

`statusText` produces the section 3 text. `Stats.last` holds the already formatted `{last}` value; the initial
value is `none yet`.

## 7. `hooks/register.ts`

State in the `register` closure (new): `cooldown = 0`, `isPending = false`, `isRequesting = false`, `stats: Stats` (initial
`{ passes: 0, results: 0, savings: 0, last: "none yet" }`).

- **`session.start`:** as spec 1, and in addition `await $.command.register({ name: "shake", description: ..., })` and
  `await $.command.register({ name: "ctrscm", description: ... })`, each in its own try; a rejection logs one
  `$.ui.log` line `CTRSCM: command registration failed: {message}` and does not affect the recovery tool.
- **`session.measure`:** when `!isRequesting` and `e.changed.includes("context")`:
  `decideRequest(e.context, config, { cooldown, isPending })`; store the returned cooldown; clear `isPending` when it was
  consumed (`request === "aggressive"`). With a request: set `isRequesting`, log the matching request line, `await
  $.session.compact({ instructions: markOf(request) })` in a try, on rejection log `CTRSCM: {request} shake failed:
  {message}` and set `stats.last` to `{request} skipped: compaction failed`; `finally` clear `isRequesting`. Always
  `return next(e)`.
- **`command.run` on `{ command: "shake" }`:** when `!isRecoverReady` answer the unavailable text; else set `isPending`
  and answer the queued text. Never calls `next`. **On `{ command: "ctrscm" }`:** answer
  `{ text: statusText(config, root, stats, isPending) }` with the root resolved as spec 1 (`undefined` when unavailable or when
  the `HOME` lookup rejects; nothing throws out of `command.run`).
- **`session.compact`:** spec 1 section 8 applies with these changes, in this order.
  1. `precompute`: unchanged.
  2. `request = requestOf(e.instructions)`. When defined: this is a marked call (steps 3 to 7 below, with `label` = the
     request name, `fallback` = `{ skip }` with the skip reason, `settings` = `config` with `protectTokens` replaced by
     `aggressiveProtectTokens` for `aggressive`). Step 2 of spec 1 (manual with instructions to the built-in) does
     not apply to a marked call.
  3. `!Array.isArray(e.messages)` gives skip `no transcript` (a bare `$.session.compact()` in a test supplies none).
  4. `!isRecoverReady` gives skip `recovery tool not registered`.
  5. `selectResults(e.messages, settings)` empty gives skip `nothing worth shaking`; no root, or a rejected `HOME` lookup (logged as in spec 1), gives skip `artifact root
     unavailable`; a write failure logs spec 1's line and gives skip `artifact write failed`.
  6. Success: as spec 1 (`rebuild`, the spec 1 log line) plus `stats`: `passes += 1`, `results += n`, `savings += savings`.
  7. Every outcome of steps 3 to 6 sets `stats.last` per section 3 with the request name as `{label}`. An unmarked call
     behaves exactly as spec 1 and in addition records, for the triggers `manual` (without non-whitespace instructions), `auto` and
     `plugin` only: success updates `stats` as step 6 and sets `last` with the trigger name as `{label}`; a fallback
     taken sets `last` to `{trigger} skipped: shake not applied`. `precompute` and `manual` with non-whitespace instructions
     record nothing.

`.claude-plugin/plugin.json`: add string options (type `"string"`, `title`, `description`, `required` false, `default`):
`autoShake` ("on", `options` `["on", "off"]`), `triggerPercent` ("50"), `triggerTokens` ("0"), `cooldownTurns` ("3"),
`aggressiveProtectTokens` ("4000"). Defaults must equal section 3. The existing options are unchanged.

## 8. Tests (written first, one behavior at a time, literal expected values)

- `config`: defaults on empty options include the five new ones; `autoShake` `"off"`, `"ON "` and `false`; invalid
  `autoShake`, `triggerPercent` `"0"`/`"100"`/`"abc"`, `cooldownTurns` `"-1"` keep defaults with one problem each.
- `shake`: `hasImage` true for `{ type: "image" }`, nested array, `base64` key; false for strings and plain data; the
  section 5 worked example (both variants); spec 1 tests keep passing.
- `trigger`: `requestOf` exact match only (`"ctrscm:proactive"`, `"ctrscm:aggressive"`; undefined for `""`,
  `"ctrscm:proactive "`, undefined input); `decideRequest` for pending, cooldown decrement, percent trigger (49 no, 50
  yes), tokens trigger (`triggerTokens` 0 never, 40000 at 40000 yes), `autoShake` false, undefined figures, and the
  cooldown returned after a request.
- `status`: for the default config, root `/home/example/.ctrscm/artifacts`, stats `{ passes: 2, results: 3, savings: 12000,
  last: "proactive shook 2 results (~8000 estimated tokens)" }` and pending true, `statusText` equals:

```text
CTRSCM status
auto: on (trigger 50% or 0 tokens, 0 = off; cooldown 3 turns)
shake: protect 16000, aggressive protect 4000, min savings 4000, min result 200 (estimated tokens)
protected tools: Skill
artifacts: /home/example/.ctrscm/artifacts
this session: 2 passes, 3 results shaken, ~12000 estimated tokens saved
last: proactive shook 2 results (~8000 estimated tokens)
pending: aggressive shake
```

  and with root undefined, `protectedTools` `[]`, `autoShake` false and pending false the rows read `auto: off (trigger ...`,
  `protected tools: none`, `artifacts: unavailable (no HOME)`, `pending: none`.
- `register`, through `$`: `session.start` registers both commands and a rejected command registration logs one line
  and still registers the recovery tool; `$.session.measure` over the threshold logs `CTRSCM: requesting proactive
  shake (context 75%)` and the nested compaction reports `no transcript` in `/ctrscm`'s `last:` row; under the
  threshold and with `changed: ["rateLimits"]` it requests nothing; the cooldown suppresses the next three measures;
  `$.command.run({ command: "shake" })` answers the queued text, the next measure logs `requesting aggressive shake`
  regardless of percent and `/ctrscm` then shows `pending: none`; marked `$.session.compact({ trigger: "plugin",
  instructions: "ctrscm:proactive", messages } as never)` with the spec 1 worked-example transcript writes artifacts
  and returns messages, never calls the layer beneath, and with a transcript below `minSavings` answers
  `{ skip: "ctrscm: nothing worth shaking" }` even when `fallback` is `"builtin"` (the layer beneath is not called);
  with transcript X (spec 1's m0 to m5 plus m6, an assistant message of 40000 chars of text, cost 10000, so tail[4] = 10001) a marked
  aggressive call returns messages whose m2 and m4 results are both placeholders (savings 39920) while a marked proactive call
  shakes m2 only (savings 19960); an
  unmarked `manual`/`auto` compaction behaves as in spec 1 (existing tests unchanged); with transcript X where m2's `toolResults` is
  `[tu1, tu3]` as in transcript W, a marked aggressive call returns messages in which m2 is deeply equal to the input
  and m4's result text is the placeholder (an image-bearing message is never rebuilt, another message still is).

Test seam additions (probed by the architect in a throwaway plugin, 2026-10-05): beneath the plugin answer
`on("session.measure", ($, e) => ({ changed: e.changed }))`, `on("command.register", () => ({ value: { command: "x" } }))`,
and for `command.run` dispatch `on("command.run", () => ({ text: "core" }))`. `$.session.measure({ context: { window: 200000, tokens:
150000, percent: 75 }, rateLimits: [], changed: ["context"] })` and `$.command.run({ command: "shake" })` need no casts.
The casts allowed are unchanged (`as never` on the dispatch of `$.session.compact` and `$.tool.call`, tests only).

## 9. Out of scope

Elision of fenced or XML blocks in prose; `/shake` that runs immediately (the host refuses compaction inside a
command hook); cleanup of artifacts; Windows paths; exact token counts; a status pane; per-tool thresholds; any change
to `hooks/artifacts.ts`, `hooks/recover.ts` or the recovery tool; making `autoShake` react to rate limits. Adjacent
temptations to refuse: new modules beyond the two named, a persistent store of stats, logging tool-result bodies.

## 10. Acceptance

Run from `/home/zbalint/workspace/CTRSCM` after implementation (all require the new code, so none runs at lock time):

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail, every behavior in section 8 present
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
rg -n "as never" hooks                                           # no output
git status --short   # only files named in section 0
```

Further bars: the defaults in `plugin.json`, `DEFAULT_CONFIG` and section 3 are identical; the status text, skip
reasons and command replies match section 3 byte for byte (the tests assert literals); `hooks/artifacts.ts` and
`hooks/recover.ts` are byte-identical to the base commit (`git diff --stat` lists neither); nothing is committed.
Live behavior (the proactive trigger firing in a real session, `/shake` running at the next turn, the notice a skipped
proactive pass prints) is not part of this acceptance; a tester verifies it afterwards.

## 11. Open items after this spec

Live checks L1 (proactive trigger at a low `triggerTokens` in a real session), L2 (`/shake` queued then run), L3
(what the person sees when a proactive pass skips), L4 (cache cost of a shake versus the built-in compaction, from the
round 3 measurements). Backlog B2 and B4 close with this spec (the architect edits those rows at acceptance, outside the developer's scope);
B11 stays open.

## 12. Pre-lock gate notes (2026-10-05)

Baseline: at the base commit `claude plugin validate . --strict` passes, `claude plugin test .` passes (25), `tsc` exits 0
(run by the architect at acceptance of spec 1). Probes, all against the real engine in a throwaway plugin outside the
repository (`claude plugin test`): `$.session.compact` from a `session.measure` hook and from a `turn.complete` hook runs
the `session.compact` hook; from a `command.run` hook it is refused by the host, and `$.command.run` from a `command.run`
hook is refused too; `instructions` reach the hook; a bare test call supplies no `messages` (`Array.isArray` false) and no
`trigger`; `$.command.register` is answered with `{ value: { command } }`; the registered `command.run` hook runs via
`$.command.run`. Scope was derived from the finished sections: every file named in sections 4 to 8 is in section 0; the
acceptance `rg` scans cover `hooks` and `tests`, both in scope; no generated file is produced; `AGENTS.md` and
`docs/architecture.md` are architect-edited (`AGENTS.md` already updated with the new modules and the invariant wording
for unprompted requests). Repeated values (defaults, marks, skip reasons, log lines, status text, reply texts) were
compared by search across sections 2, 3, 6, 7, 8 and 10. Worked examples were recomputed: transcript W (no selection,
then savings 19960), transcript X (tail[4] = 10001; aggressive savings 39920, proactive 19960), the cooldown sequence 3, 2, 1,
0, and the status block.

Consultant review (`m_517`, context `ctrscm-proactive-shake`), dispositions: F1 section 11 now says the architect edits
B2/B4; F2 worked example made literal (transcript W); F3 and F4 literal transcript X examples; F5 D2 clause added; F6
D5 wording; F7 log line added to section 3; F8 wording "non-whitespace instructions"; F9 AGENTS.md invariant reworded by
the architect (owner delegated design; flagged in the owner report); F10 literal status block in section 8; F11 note
in D8; F12 `HOME` lookup rejection covered. Not adopted: none. Left open on purpose: live behavior L1 to L4 (section 11).
