# Spec 7: friction found in live use (follow-up to spec 6)

## 0. Status

**DRAFT** (2026-10-06). D1 and D2 decided by the architect (owner delegated, section 2). Not locked: the pre-lock gate is open. Implementation starts after spec 6 is accepted,
because both touch `hooks/register.ts` and `tests/register.test.ts`. Source: backlog B23 (owner asked for these to be folded into a spec).

**Scope (proposed).** `hooks/config.ts`, `hooks/shake.ts` (placeholder text only), `.claude-plugin/plugin.json` (default), `README.md` (`## Options` row),
`tests/config.test.ts`, `tests/shake.test.ts`, `tests/register.test.ts` (placeholder literals). Does not touch `hooks/artifacts.ts`, `hooks/recover.ts`,
`hooks/trigger.ts`, `hooks/usage.ts`, `docs/*` (architect). No commit. `context_id`: `ctrscm-friction`.

## 1. Why

Live use of the architect session (2026-10-06) showed five frictions (B23). Three are mod-side and fixable here; two are not.

| B23 item | Mod-side fix | Disposition |
| --- | --- | --- |
| 1 recovery tool is deferred, first recover needs a ToolSearch load | none found: `$.tool.register` has no deferral option in `types/claude-code.d.ts` (rg for defer/alwaysLoad shows only context-category rows) | report upstream; usage doc note |
| 2 results of ~600 tokens are shaken, small outputs vanish | raise the `minResultTokens` default (D1) | this spec |
| 3 placeholders seen before the first pass | cause unknown | needs a probe first (section 4); no code in this spec |
| 4 a pass costs a cache rebuild, the mod cannot say how much | usage log has no cost field | B16 (report tool), out of scope |
| 5 a shaken body is cited from its preview | placeholder wording (D2) | this spec |

## 2. Decisions (owner delegated them to the architect, 2026-10-06; the owner can change them)

- **D1 (decided: 1000).** New default for `minResultTokens`. Evidence: 200 shook 2.5 KB results (~600 estimated tokens) whose recovery costs a round trip and about the
  same tokens back. `minSavings` 4000 already guards a pass as a whole, so this only decides which single results join it. Decided default **1000**, a smaller step from the tested 200 than the first proposal of 1500, chosen because no measurement exists for either; the
  option stays configurable and the range check (safe integer at least 1) is unchanged.
- **D2 (decided: add the sentence).** Placeholder hint: append one sentence to the placeholder, `Recover the full text before quoting details from it.` The
  placeholder is currently 203 to 222 characters (verification log, rounds 6 and 7); the sentence adds about 55. Alternative: no change (the recover tool
  description already says to call it for any detail).

## 3. Mechanical changes (once D1 and D2 are decided)

1. `hooks/config.ts:22` `minResultTokens: 200` becomes the D1 value; `.claude-plugin/plugin.json` default and the `README.md` row (`| minResultTokens | 200 |`) equal it;
   `docs/usage.md` line 49 is architect-edited.
2. `hooks/shake.ts` `placeholderOf`: append the D2 sentence. Every test and fixture that holds the old placeholder text changes (gate step 5: grep the old text across
   `tests/`).
3. Tests with literal values: config default; `selectResults` includes a result of exactly the new threshold and excludes one token below; placeholder literal.

## 4. Not in this spec

Item 3 needs a probe before any design: start a session with the mod and no pass, read a large result, and compare `$.session.messages()` text with what the model sees
(the session file shows whether the mod or the engine wrote the placeholder). Out of scope: cost accounting (B16), the deferral (upstream), any trigger change.

## 5. Acceptance

Same commands as spec 6 section 7 (`tsc`, `claude plugin validate . --strict`, `claude plugin test .`, the `rg` scan); `git status --short` shows only the files in section 0;
`rg -n "minResultTokens" hooks .claude-plugin README.md` shows one value everywhere.
