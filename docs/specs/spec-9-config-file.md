# Spec 9: a default config file at `~/.ctrscm/config.json`

## 0. Status

**LOCKED** (2026-10-06), revised after the consultant review (`m_665`, dispositions in section 8); gate record in section 9. Spec 8 is implemented (`344fab3`), so the `hooks/register.ts` overlap is gone. Backlog B20 follow-up, owner request.

**Scope.** New files: `hooks/configFile.ts`, `tests/configFile.test.ts`. Edits: `hooks/config.ts`, `hooks/register.ts`, `hooks/status.ts`, `.claude-plugin/plugin.json`, `README.md`, `tests/config.test.ts`, `tests/status.test.ts`,
`tests/register.test.ts`. Does not touch: `hooks/trigger.ts`, `hooks/shake.ts`, `hooks/artifacts.ts`, `hooks/recover.ts`, `hooks/usage.ts`, `hooks/usageLog.ts`, `hooks/report.ts`, `docs/*` and `AGENTS.md` (the architect edits `docs/usage.md`, `docs/architecture.md`,
`docs/backlog.md`, the `AGENTS.md` module table). No new dependency. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>`, branch `develop`, at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-config`.
**Public test seams:** `parseConfig` and `mergeOptions` (pure), `readConfigFile` over a fake `fs`, `statusText`, and the registered hooks driven through `$` (`$.fs.stat`/`$.fs.read` as an in-memory map, `$.env`).

## 1. Why

The owner's session never received its options file: the live process had two `--settings` flags and the second replaced the first (backlog B20), so every option fell back to the built-in default. Options reach the mod only as the `options` argument of `register`, filled by
the engine from `pluginConfigs`, and a launch the owner does not control can lose them. Wanted behavior (owner, 2026-10-06): (1) no config file in `~/.ctrscm` and nothing passed: the built-in defaults, as today; (2) a file and nothing passed: the file;
(3) a file and options passed: the passed options win.

## 2. Decisions

- **D1. Precedence per key:** a passed option beats the file, the file beats the built-in default (`DEFAULT_CONFIG`). A passed `triggerTokens` leaves the file's `adviseTokens` in force. An option is PASSED when its value is a string that is not blank after trimming (or a boolean or array, as today);
  an INVALID passed value is still "passed": it falls to the built-in default with the problem line, as today, and the file does not rescue it (one simple rule, no per-source validation).
- **D2. The engine fills manifest defaults, so they go.** Probe `m_661` (CLI 2.1.291): with no manifest default an unset field arrives as an empty string. `.claude-plugin/plugin.json` drops the `default` of all 13 `userConfig` fields (verified equal to `DEFAULT_CONFIG` today), and the three fields
  that carry `options` (`fallback`, `autoShake`, `usageLog`; `claude plugin validate --strict` demands a default among the options) become plain string fields without `options`; `parseConfig` keeps rejecting values outside the allowed words. The built-in defaults then live only in `DEFAULT_CONFIG` and the README table.
  Cost, accepted: the engine's option UI loses the choice list of those three fields (how it renders a field without default is unverified).
- **D3. A blank string means unset for EVERY key** (`parseConfig`, new, first step: a string that trims to empty is treated as `undefined`). Today only `artifactDir` does that; the other keys log a problem or, for `protectedTools`, silently become empty. Consequence: `protectedTools: ''` now gives the default
  `['Skill']` (test `tests/config.test.ts:72` changes), so the way to protect no tool becomes the word `none` (`protectedTools: 'none'` gives `[]`; a file may also give `[]`). The README states both.
- **D4. The file:** `$HOME/.ctrscm/config.json`, found with `$.fs.stat` (it follows symbolic links; a rejection means no file, case 1, silently) and required to be `kind === 'file'`; then `$.fs.read`. A stat that succeeds followed by a failing read is `unreadable`. It is NOT under `artifactDir` (that is itself configurable).
  `$.env.get('HOME')` unset or rejecting: no file is read and one log line `CTRSCM: config file skipped: HOME unavailable` is written. The content must be a JSON object; a value is a string, a number (converted with `String`), a boolean, or, for `protectedTools` only, an array of strings. Any other value type is a problem and the key is skipped.
- **D5. Reading and applying.** Once, at the first `session.start` (guarded by a flag; a second `session.start` does not read again), before the tool and commands are registered. An ignored file logs one line `CTRSCM: config file ignored: {reason}` with reason `unreadable`, `not JSON` or `not an object`; the reason NEVER carries the parser's message or any file text.
  Unknown keys are logged once as `CTRSCM: config file option {name}: unknown` and ignored. When a usable file exists the merged options (`mergeOptions(passed, file)`) are parsed with `parseConfig`, the result is applied onto the existing config object with `Object.assign` (so every hook sees it), and the problem lines come from THIS parse (they replace the ones of the `register`-time parse, which are not logged
  when a file is applied; the once-guard `problemsLogged` stays). Without a usable file nothing changes.
- **D6. `mergeOptions(passed: PluginOptions, file: Record<string, unknown>): { options: PluginOptions; passed: number; fromFile: number }`** pure, in `hooks/config.ts`; `parseConfig`'s return shape is NOT changed (no `explicit` set). `passed` counts keys whose passed value is not blank, `fromFile` the keys taken from the file; the default count is the number of options minus both.
- **D7. Status.** `/ctrscm` gets two lines after `usage log:`: `options: {passed} passed, {fromFile} from file, {defaults} default` and `config file: {path}` or `config file: none`. The four full-block expectations in `tests/status.test.ts` (lines 7, 29, 51, 58 at the base commit) change; `statusText` gains the counts and the path.
- **D8.** Never print file contents or option values in logs or status; names and counts only.

## 3. Mechanical changes

1. `hooks/config.ts`: D3 blank handling in `parseConfig`, the `none` word for `protectedTools`, `mergeOptions` (D6). `parseConfig` callers: `hooks/register.ts:71` and `tests/config.test.ts` only (`rg -n parseConfig hooks tests`).
2. `hooks/configFile.ts`: `readConfigFile(fs: { stat: (path: string) => Promise<{ kind: string }>; read: (path: string) => Promise<string> }, home: string | undefined): Promise<{ file?: Record<string, unknown>; logs: string[] }>`; type the structural `fs` from the Mod API's `stat` result, check `types/claude-code.d.ts` for its exact shape before typing.
3. `hooks/register.ts`: the D5 read and merge in `session.start` before the registrations, the status counts and path kept in closure variables.
4. `hooks/status.ts`: D7. `.claude-plugin/plugin.json` and `README.md` (a `## Config file` section: path, format, the three cases above, precedence per key, the `none` word, that a blank option means unset).
5. Tests, literal expected values: (a) `config.test.ts`: `protectedTools: ''` gives `['Skill']`, `'none'` gives `[]`, a blank string for every other key keeps the default with no problem line, the existing whole-object cases unchanged; (b) the three owner cases and a per-key case through `mergeOptions` and `parseConfig` (pure only: case 3 is not drivable through registered hooks, backlog B10);
   (c) `configFile.test.ts` over a fake `fs`: missing file, a directory named `config.json`, unreadable, not JSON, an array, unknown key, a number value, `protectedTools: []`; (d) `register.test.ts`: `session.start` with an in-memory `fs` holding `config.json` then `/ctrscm` shows `options: 0 passed, 1 from file, 12 default` and the path; no file shows `config file: none`; a second `session.start` does not read again; HOME rejecting logs the one line.
   Existing tests may keep options as today; if `claude plugin test` hands `register` blank strings the behavior is the same by D3.

## 4. Out of scope

Writing or generating the file, watching it for changes, a reload command, `~` expansion in values, other formats, changing the `a2amx` launch (B20), the engine's `pluginConfigs` handling, any option's meaning or default (except `none`), the usage log, advice or Shake logic, spec 8's report.

## 5. Probe result

Done: unset fields arrive as empty strings (`m_661`, tester correction `m_663`: the hook artifact is the evidence, not stdout). Not probed: how the engine's option UI shows a field without default.

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
rg -n '"default"|"options"' .claude-plugin/plugin.json   # no output
git status --short   # only the files in section 0
```

Live check afterwards (owner or tester): `~/.ctrscm/config.json` with `{"triggerTokens": 150000}`, a session with no options: `/ctrscm` shows 150000 and `options: 0 passed, 1 from file, 12 default`; pass `triggerTokens` through `--settings`: the passed value shows.

## 8. Consultant review dispositions (`m_665`)

F1 adopted (D3: blank is unset for every key; `none` for no protected tools). F2 accepted with the cost stated (D2). F3 adopted (D4: `stat`, symbolic links, HOME). F4 resolved by a simpler rule (D1: an invalid passed value falls to the built-in default). F5 noted: no stale capture at load; the spec 8 additions read `config.usageLog` at call time (check at review).
F6 adopted (D6: no `explicit` set, so the return shape is unchanged and only about 3 assertions change; D7 counts four full blocks; case 3 pure-only). F7 adopted (D5: no parser message).

## 9. Pre-lock gate record (2026-10-06, base `6505403`)

Run: `parseConfig` callers are `hooks/register.ts:71` and `tests/config.test.ts` (line 72 is the `protectedTools: ''` assertion D3 changes); the 13 `userConfig` fields equal `DEFAULT_CONFIG` (`artifactDir` default is the empty string); the four full-block `statusText` assertions sit at `tests/status.test.ts` lines 7, 29, 51, 58; `$.fs.stat` returns `FsStat` with `kind: 'file' | 'dir' | 'other'` and an optional second argument, so the structural `{ stat: (path: string) => Promise<{ kind: string }> }` accepts it; the `rg` scan for `node:`, `any`, `eval`, dynamic import and `@ts-` over `hooks tests` finds nothing today.
Worked example for D1 and D6, the owner's file (11 keys, none passed): `options: 0 passed, 11 from file, 2 default` (`artifactDir`, `protectedTools`). Deferred to implementation: the acceptance commands that need the new code (`rg` on `plugin.json`, `claude plugin test`, tsc).
