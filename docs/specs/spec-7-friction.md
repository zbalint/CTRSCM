# Spec 7: friction found in live use (follow-up to spec 6)

## 0. Status

**LOCKED** (2026-10-06). Source: backlog B23. D1 and D2 were decided by the architect with the owner's delegation (section 2); the owner can change them.

**Scope.** May edit exactly these files: `hooks/config.ts`, `hooks/shake.ts`, `.claude-plugin/plugin.json`, `README.md`, `tests/config.test.ts`, `tests/shake.test.ts`,
`tests/status.test.ts`, `tests/register.test.ts`. Does not touch: `hooks/artifacts.ts`, `hooks/recover.ts`, `hooks/trigger.ts`, `hooks/usage.ts`, `hooks/status.ts`,
`docs/*` (the architect edits `docs/usage.md`, `docs/examples/ctrscm-150k.json`, `docs/verification.md`, `docs/backlog.md`), `AGENTS.md`, `package*.json`, `tsconfig.json`, the other tests.
No commit, no stage, no merge: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>`, branch `develop`, starting at the commit that holds this spec. **Shared task `context_id`:** `ctrscm-friction`.
**Public test seams:** `parseConfig` and `DEFAULT_CONFIG` (`tests/config.test.ts`), `placeholderOf` and `selectResults` (`tests/shake.test.ts`), `statusText` (`tests/status.test.ts`), the registered hooks through `$`
(`tests/register.test.ts`).

## 1. Why

Live use of the architect session (2026-10-06) showed five frictions (B23). Two are fixable in the mod and are this spec; the others are not.

| B23 item | Disposition |
| --- | --- |
| 1 recovery tool is deferred, first recover needs a ToolSearch load | not fixable here: `$.tool.register` has no deferral option in `types/claude-code.d.ts`; report upstream |
| 2 results of ~600 tokens are shaken, small outputs vanish | this spec, D1 |
| 3 placeholders seen before the first pass | needs a probe first (section 6); no code here |
| 4 a pass costs a cache rebuild, the mod cannot say how much | B16 (report tool), out of scope |
| 5 a shaken body is cited from its preview | this spec, D2 |

## 2. Decisions

- **D1.** The default of `minResultTokens` is **1000** (was 200). Evidence: 200 shook results of about 600 estimated tokens, whose recovery costs a round trip and about the same tokens back. The
  pass-level `minSavings` (4000) still guards a pass as a whole. 1000 is a smaller step than the 1500 first proposed; nothing measured either value. The option stays configurable; its range check is unchanged
  (safe integer, at least 1).
- **D2.** The placeholder says to recover before quoting. New text, one single place, `placeholderOf` in `hooks/shake.ts`:

  `[CTRSCM shaken tool result: {label, }~{tokens} estimated tokens ({chars} chars) externalized; before quoting details, recover the full text with mcp__ctrscm__recover id="{id}"]`

  The ending `id="{id}"]` and the prefix `[CTRSCM shaken tool result:` are unchanged (`PLACEHOLDER_PREFIX` is the only thing code matches; `hooks/recover.ts`'s tool description names the `id="<id>"]` form).

## 3. Mechanical changes

1. `hooks/config.ts:22` `minResultTokens: 200` becomes `1000`. `.claude-plugin/plugin.json` line 9: `"default": "200"` becomes `"default": "1000"`. `README.md` line 69: the `200` default cell becomes `1000`.
2. `hooks/shake.ts` `placeholderOf` (line 24): the template string becomes the D2 text.
3. Tests, literal expected values (gate step 5, old text searched across the whole tree):
   - `tests/config.test.ts` lines 9 and 84 (the default `minResultTokens`) become `1000`; lines 30, 39, 79 and 99 are explicit-value and range cases and stay.
   - `tests/status.test.ts` lines 17 and 39: `min result 200` becomes `min result 1000` (they print `DEFAULT_CONFIG`).
   - `tests/shake.test.ts` lines 78 and 83 and `tests/register.test.ts` line 96: the placeholder literals take the D2 text. `tests/shake.test.ts` line 18 sets `minResultTokens: 200` explicitly and stays.
   - If no existing test in `tests/shake.test.ts` selects a result of exactly `minResultTokens` and rejects one estimated token below it, add one (using that file's own setting of 200).

## 4. Architect-edited documents (not in scope for the developer)

`docs/usage.md` line 49 and `docs/examples/ctrscm-150k.json` line 12 set `"minResultTokens": "200"` explicitly, which would override the new default: the architect changes both to `"1000"`; the usage guide's
placeholder example and `docs/verification.md` get a round entry when the change is live.

## 5. Out of scope

Cost accounting (B16), the deferral of the recovery tool (upstream), any trigger or advice change, the `shortcut:` note at `hooks/shake.ts:6` (it names a lower bound on `minResultTokens`; raising the default does not touch it).

## 6. Not in this spec (needs a probe first)

B23 item 3: start a session with the mod and no pass, read a large result, and compare `$.session.messages()` text with what the model sees; the session file shows whether the mod or the engine wrote the placeholder.

## 7. Acceptance

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
rg -n "minResultTokens: |\"minResultTokens\"" hooks .claude-plugin   # config.ts:22 shows 1000, plugin.json shows "default": "1000"
git status --short   # only files named in section 0
```

Further bars: `hooks/trigger.ts`, `hooks/status.ts`, `hooks/artifacts.ts`, `hooks/recover.ts` and `hooks/usage.ts` byte-identical to the base commit; no other literal `externalized; recover with` remains
under `hooks` or `tests` (`rg -n "externalized; recover with" hooks tests` prints nothing).

## 8. Pre-lock gate

Step 3 and 5: `rg` over the tree found `minResultTokens` in 9 files and the old placeholder text in `hooks/shake.ts`, two tests and `docs/intent.md` (unverified input, untouched); every hit is in section 3 or 4. Step 9: no code parses the
placeholder beyond `PLACEHOLDER_PREFIX` (`rg` over `hooks`). Step 8: example instance, a 700-token result: shaken at 200, not at 1000, and a 1200-token result is still shaken; both consistent with `minSavings`. Step 7: values 1000 and the
D2 text appear in D1/D2, section 3 and section 7, and nowhere else. Baseline: `claude plugin test .` ran 69 pass 0 fail at `136628c`.
