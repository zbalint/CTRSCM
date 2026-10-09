# Spec 4: name the replaced tool call in the placeholder

## 0. Status

**LOCKED** (2026-10-06, pre-lock gate run; notes in section 10). The owner delegated every design choice to the
architect; decisions are D1 to D5 in section 2. Consultant review: a2amx `m_560`, all findings dispositioned in section 10.

**Scope.** May edit exactly these files and no others: `hooks/shake.ts`, `hooks/register.ts`, `tests/shake.test.ts`,
`tests/register.test.ts`, `README.md` (one sentence in `## Options` or the intro of `## Commands`, section 6).
Does not touch: every other `hooks/*.ts`, `.claude-plugin/plugin.json`, `AGENTS.md`, `docs/*` (the architect amends spec 1's
placeholder text, `docs/architecture.md` and `docs/backlog.md` at acceptance), `package*.json`, `tsconfig.json`. No new
dependency. Do not commit, stage or merge: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>`, branch `develop`, starting at the commit that
holds this spec (spec 3's accepted implementation is already in the tree). **Shared task `context_id`:** `ctrscm-placeholder-label`.
**Governing documents:** this spec; specs 1 to 3 stay in force except where section 3 amends them; `AGENTS.md`.
**Public test seams:** `placeholderOf`, `selectResults`, `rebuild` in `hooks/shake.ts`; the registered hooks driven
through `$` (`$.session.compact` with `as never`, as spec 1 allows).

## 1. Why

Live rounds 4 and 5 (`docs/verification.md`): when several large results are shaken, every placeholder reads the same
except its artifact id (`~5674 estimated tokens (22696 chars)`). Asked for a value from one named file, the model twice
answered that the result was "externalized" and gave no recovery call (round 4 Stage A with five placeholders; round 5 turn 2,
even though it could quote a placeholder), although in round 4 Stage B it picked the right id among 11 placeholders twice.
The model has no way to tell which placeholder replaced which call without matching positions across the transcript. The
tool call itself stays in the transcript verbatim, so naming it in the placeholder adds no information that is not
already there; it only puts it next to the id. Spec 3 already improved the recovery tool's description; this spec makes
the placeholder self-identifying. The placeholder prefix stays byte-identical so every existing placeholder is still
recognized.

## 2. Decisions

- **D1.** The placeholder gains a label naming the call: the tool name and one short hint from the call's input, between the
  prefix and the token count (section 3). The prefix `[CTRSCM shaken tool result:` is unchanged.
- **D2.** The hint comes from the first of these input keys, in this order: `file_path`, `path`, `command`, `pattern`,
  `url`, `query`, `description`, whose value is a string that is non-empty after the cleanup below. Cleanup, in this order:
  every character matching `\p{Cc}` or `\p{Cf}` (controls, escape characters, bidi overrides) becomes a space; whitespace runs collapse to
  one space; the text is trimmed; `"` becomes `'` and `]` becomes `)` (the id field stays unambiguous); then the text is cut to
  80 code points, trimmed again, with `...` appended when it was cut. The same character mapping (`\p{Cc}`, `\p{Cf}` to a space,
  then collapse and trim) is applied to the tool name. No key qualifies: no hint, the label is the tool name alone. No tool
  name known (the call is not in the transcript): no label, the placeholder is exactly the spec 1 text.
- **D3.** `PLACEHOLDER_TOKEN_ESTIMATE` stays 40 although a labeled placeholder is longer (typically 45 to 65, at most about 78
  estimated tokens with a 64-character tool name and an 83-character hint). This is a deliberate shortcut (an estimate, not a count)
  and keeps every spec 1 and spec 2 worked number valid. Leave a `// shortcut:` comment in `hooks/shake.ts` naming the ceiling (savings
  overstated by at most about 40 estimated tokens per result) and the upgrade trigger (a `minResultTokens` below about 78, where a
  small result could grow when shaken, or an exact token counter).
- **D4.** The label is derived only from `toolUses[].tool` and `toolUses[].input` (the call, which the transcript keeps
  verbatim). It never reads a result body, and the placeholder never contains result text. The hint copies call input that is
  already in the transcript, so it adds no text the model could not read; it is never written to a manifest or a log.
- **D5.** `rebuild` is unchanged: placeholders arrive as a map from `tool_use_id` to the final string.

## 3. Contracts (amends spec 1 section 3)

`placeholderOf(id, chars, tokens, label?)` returns, with a label:

```text
[CTRSCM shaken tool result: {label}, ~{tokens} estimated tokens ({chars} chars) externalized; recover with mcp__ctrscm__recover id="{id}"]
```

and, without a label (`label` undefined), exactly the spec 1 text (the unchanged literal in `tests/shake.test.ts`).
`{label}` is the tool name, then a single space and the hint when one exists (`Read /work/a.ts`, `Bash ls`, `Grep TODO`).

Worked examples: `Read` with input `{ "file_path": "/work/a.ts", "offset": 1 }` gives label `Read /work/a.ts`; `Bash` with input
`{ "command": "git log\n  --oneline  -5" }` gives `Bash git log --oneline -5`; `mcp__x__find` with input `{ "n": 3 }` gives
`mcp__x__find`; a `command` of 100 `a` characters gives hint 80 `a` followed by `...`; a `command` of exactly 80 `a` characters
gives hint 80 `a` without `...`, and of 81 gives 80 `a` followed by `...`; `{ "command": "   ", "pattern": "TODO" }` for `Grep` gives
`Grep TODO` (an all-whitespace value does not qualify).

## 4. `hooks/shake.ts`

- `Selected` gains `label: string | undefined`.
- `selectResults` keeps, per `tool_use_id`, the tool name and the input (extend the existing name map), and fills `label`
  with `labelOf(tool, input)` for each selected result (`undefined` when the tool is unknown).
- New exported pure function `labelOf(tool: string | undefined, input: Record<string, unknown> | undefined): string | undefined`
  implementing D2. It never throws.
- `placeholderOf` gains the optional fourth parameter as in section 3 (extend the signature; update callers).
- Everything else, including every eligibility rule and the savings arithmetic, is unchanged.

## 5. `hooks/register.ts`

One change: pass `selected.label` as the fourth argument of `placeholderOf`. No other change.

## 6. README.md

In `## Commands` (intro) or `## Options`, one sentence: a shaken result's placeholder names the tool call it replaced
(tool name and a short hint such as the file path or command start) next to the artifact id.

## 7. Tests (written first, literal expected values)

- `tests/shake.test.ts`: `placeholderOf` with and without a label (exact strings; the existing unlabeled literal stays);
  `labelOf` for the worked examples in section 3 (including the 80 and 81 boundary and the all-whitespace value), for key
  precedence (`file_path` over `command`), for a quote and a bracket in the hint (`"` to `'`, `]` to `)`), for an escape
  character and a bidi override in the hint (each becomes a space, collapsed), and for an input without any listed key;
  `selectResults` on the spec 1 worked example with default settings selects `[tu1]` with `label` `Bash ls` (the existing
  `toEqual` at `tests/shake.test.ts:110-113` gains `label: 'Bash ls'`, numbers unchanged); with `protectTokens` 0 it selects
  `[tu1, tu2]`, savings 39920, labels `Bash ls` and `Read /work/a.ts`; the existing assertion at `tests/shake.test.ts:154`
  (a call with tool `Unknown`) gains `label: 'Unknown'`; a result whose call is not in the transcript has `label` `undefined`;
  every other spec 1 and 2 value is unchanged.
- `tests/register.test.ts`: the compaction on the spec 1 worked-example transcript returns a placeholder for `tu1` equal to
  `[CTRSCM shaken tool result: Bash ls, ~20000 estimated tokens (80000 chars) externalized; recover with mcp__ctrscm__recover id="<id>"]`
  with `<id>` the artifact id the test observed through the `fs.write` hook (the existing assertion at `tests/register.test.ts:90`
  is tightened to this exact string; the `stringContaining(PLACEHOLDER_PREFIX)` assertions elsewhere stay).

## 8. Out of scope

Changing the prefix or `PLACEHOLDER_TOKEN_ESTIMATE`; a stored tool-result record on rebuilt entries (a live
experiment must show it matters first; backlog); orphaned artifacts; labels for results of tools that are not
in the transcript; any change to `hooks/recover.ts`, `hooks/artifacts.ts`, `hooks/config.ts`, `hooks/trigger.ts`,
`hooks/status.ts`.

## 9. Acceptance

Run from `<repo>` after implementation (all require the new code):

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail, every behavior in section 7 present
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
rg -n "as never" hooks                                           # no output
git status --short   # only files named in section 0
```

Further bars: `git diff --stat` lists under `hooks/` only `shake.ts` and `register.ts`; the unlabeled `placeholderOf` output is
byte-identical to spec 1's literal; the prefix constant is unchanged; nothing is committed. Live behavior (does the model
pick the right id more often) is not part of this acceptance; a tester verifies it afterwards.

## 10. Pre-lock gate notes (2026-10-06)

Baseline at the base commit (spec 3 accepted, `c0a6abf`): `claude plugin validate . --strict` passes, `claude plugin test .` 49 pass,
`tsc` exit 0 (run by the architect at acceptance of spec 3). Pure change, no engine probe needed: every
seam used (`placeholderOf`, `selectResults`, `rebuild`, `$.session.compact` with `as never`) is already exercised by specs 1 to 3.
Scope derived from the finished sections: the only production caller of `placeholderOf` is `hooks/register.ts`; the only test files that assert
placeholder text or `Selected` objects are `tests/shake.test.ts` (lines asserting `Selected` shapes and the unlabeled literal) and `tests/register.test.ts`
(`stringContaining(PLACEHOLDER_PREFIX)` assertions that stay valid because the prefix is unchanged, and the exact tu1 string, tightened); `tests/recover.test.ts`
only quotes the form inside the recovery description (unchanged, still true). Repeated values compared across sections 2, 3, 4 and 7: the
80 code point cut, the key order, the label forms, the worked examples (recomputed: protectTokens 0 on spec 1's transcript selects `tu1` and `tu2`, savings 39920).

Consultant review (`m_560`), dispositions: F1 and F2 test expectations corrected (two `Selected` assertions gain a label; `tu2`'s label is tested with
`protectTokens` 0); F3 D2 now tests non-emptiness after cleanup; F4 second trim after the cut and 80/81 boundary tests; F5 cross-references and the
reason for the dependency corrected; F6 control and format characters (`\p{Cc}`, `\p{Cf}`) become spaces in the hint and the tool name, and D4 states the
copy never reaches a manifest or log; F7 the shortcut comment names the worst-case ceiling (about 78 estimated tokens) and the `minResultTokens` trigger;
F8 checked, no change. Not adopted: none. Left open on purpose: whether labels raise the recovery rate (a live check by a tester after acceptance).
