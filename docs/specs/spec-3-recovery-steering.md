# Spec 3: steer recovery toward small pages, pin marker precedence, document trigger sizing

## 0. Status

**LOCKED** (2026-10-06, pre-lock gate run; notes in section 8). The owner delegated every design choice to the
architect; decisions are D1 to D4 in section 2. Consultant input: a2amx `m_546` (context `ctrscm-live-verify`),
dispositions in section 8.

**Scope.** May edit exactly these files and no others: `hooks/recover.ts`, `tests/recover.test.ts`,
`tests/register.test.ts`, `README.md` (the `## Options` section only). Does not touch: any other `hooks/*.ts`
(`shake.ts`, `artifacts.ts`, `register.ts`, `config.ts`, `trigger.ts`, `status.ts`), `.claude-plugin/plugin.json`,
`AGENTS.md`, `docs/*` (the architect updates `docs/architecture.md`, `docs/backlog.md` and spec 1's header at
acceptance), `package*.json`, `tsconfig.json`. No new dependency. Do not commit, stage or merge: leave the diff
uncommitted.

**Location and branch:** main checkout `/home/zbalint/workspace/CTRSCM`, branch `develop`, starting at the commit
that holds this spec. **Shared task `context_id`:** `ctrscm-recovery-steering`. **Governing documents:** this spec;
specs 1 and 2 stay in force except where section 3 amends them; `AGENTS.md`. **Public test seams:** `recoverResult` and
the recovery constants in `hooks/recover.ts`; the registered hooks driven through `$` in `tests/register.test.ts`
(`$.session.compact` with `as never`, `$.tool.call` with `as never`, as spec 1 allows).

## 1. Why

Live rounds 3 and 4 (`docs/verification.md`): the model asked `mcp__ctrscm__recover` for `maxChars` 100000 in every
observed call and pulled a whole 22k-char result back into context. Because recovery results are never shaken again
(spec 1 section 5, step 4), every recovered page stays in context until a built-in compaction, so one oversized
recovery undoes the saving. Separately, in one run (Stage A, five placeholders) the model answered that a result was
"externalized" and told the person to reread, with the recovery tool allowed and zero calls; with 11 placeholders in
Stage B it recovered the right ids twice. The tool description says what the tool is but not when to use it. The
consultant read the code and the evidence (`m_546`): the description is not locked verbatim by spec 1 (section 7 asks for
"text telling the model that CTRSCM placeholders name an artifact id and that this tool returns the original text in
pages"), the placeholder is locked and stays untouched here, and the page limits are advertised in the schema, which is
what the model anchors on. This spec changes the description and the limits, pins an ordering the live runs exposed,
and documents trigger sizing.

## 2. Decisions

- **D1.** The recovery tool description is replaced by the exact text in section 3. The placeholder text, prefix and
  `PLACEHOLDER_TOKEN_ESTIMATE` are unchanged (a placeholder change waits for live evidence, backlog B14).
- **D2.** `DEFAULT_PAGE_CHARS` becomes 8000 and `MAX_PAGE_CHARS` 20000. Larger is invalid, not clamped (spec 1 stays),
  but the deny message now states the limit.
- **D3.** A plugin-requested compaction is labeled `manual` in the engine's session record (live round 4), and `manual` with
  non-whitespace `instructions` goes to the built-in summarizer. The marker check in `session.compact` already runs
  first; a test pins that ordering with trigger `manual`.
- **D4.** The proactive trigger measures `context.percent` against the model's full window, not the engine's compaction
  window, and the engine's own automatic compaction can fire first (live round 4). The README says so.

## 3. `hooks/recover.ts` (amends spec 1 sections 3 and 7)

- `RECOVER_DESCRIPTION`, exactly (one string, no line breaks):

```text
Read back the exact original text of a tool result that CTRSCM replaced with a placeholder of the form [CTRSCM shaken tool result: ... id="<id>"]. The text is not lost. When you need any detail from such a result, call this tool with that id instead of re-running the original tool, guessing, or asking the person to repeat it. Results are returned in pages: start with maxChars 8000 or less, and use offset to read further pages only when the header says more: true.
```

- `DEFAULT_PAGE_CHARS = 8000`, `MAX_PAGE_CHARS = 20000`; `RECOVER_SCHEMA.properties.maxChars.maximum` is `20000`.
- Every invalid `maxChars` (not a number, not an integer, below 1, above 20000) is answered `{ deny: "invalid maxChars (1 to 20000)" }`.
  All other texts and the validation order stay as in spec 1 section 3 and 7 (`invalid artifact id`, `invalid offset`,
  `artifact not found or incomplete`, `offset {offset} is past the end ({totalChars} chars)`, and the success text).
- The success header, the placeholder and the artifact format are unchanged.

## 4. Tests

- `tests/recover.test.ts`: the registration constants test asserts the new schema (`maximum: 20000`) and the exact description
  string above; defaults apply 8000 when `maxChars` is absent (use an artifact longer than 8000 chars, assert the
  header `range: 0..7999 of {totalChars} chars` and `more: true`); `maxChars` 20000 is accepted and 20001 answers
  `{ deny: "invalid maxChars (1 to 20000)" }`, as do `"4"` (a string) and `0`; the existing literal page tests keep their
  values (adjust only where they used the old maximum).
- `tests/register.test.ts`: a marked request is never passed to the layer beneath even when the engine labels it `manual`:
  `$.session.compact({ trigger: "manual", instructions: "ctrscm:aggressive", messages } as never)` with the spec 2
  worked-example transcript X returns `{ messages }` with placeholders and the beneath hook is not called; the same call with
  `instructions: "summarize the tests"` and trigger `manual` calls the layer beneath once and returns its result.

## 5. `README.md` (`## Options` only)

Add, below the options table, one paragraph stating: `triggerPercent` is a percentage of the model's full context window
(for example 200k), not of the engine's automatic compaction window; the engine's own automatic compaction can fire first
when its window is smaller (for example `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`), in which case the compaction still runs through
Shake but not as a proactive request; set `triggerTokens` several thousand tokens (more than one turn's growth) below the
engine's threshold when the proactive request should come first. Also state the new recovery page limits (default 8000
characters, maximum 20000). No other README section changes.

## 6. Out of scope

Placeholder wording (`hooks/shake.ts`); shaking recovered pages by replacing them with a placeholder naming the same
artifact (backlog); making the trigger use the compaction window; the resume question B11 (a live experiment decides
it); any change to artifacts or the manifest; `register.ts`.

## 7. Acceptance

Run from `/home/zbalint/workspace/CTRSCM` after implementation (all require the new code):

```sh
. ~/.nvm/nvm.sh && npm ci && npx tsc -p tsconfig.json   # exit 0, no output
claude plugin validate . --strict          # exit 0, "Validation passed"
claude plugin test .                       # exit 0, 0 fail, every behavior in section 4 present
rg -n "node:|: any\b|as any|eval\(|import\(|@ts-" hooks tests   # no output
rg -n "as never" hooks                                           # no output
rg -n "100000|invalid maxChars'" hooks tests                     # no output (old limit and old message gone)
git status --short   # only files named in section 0
```

Further bars: `git diff --stat` lists nothing under `hooks/` except `hooks/recover.ts`; the description in code equals section 3
byte for byte (the test asserts the literal); nothing is committed.

## 8. Pre-lock gate notes (2026-10-06)

Baseline at the base commit: validate passes, 47 tests pass, tsc exit 0 (run by the architect). Scope derived from the finished
sections: the old limit and message copies were found by search across the tree (`rg "100000|20000|invalid maxChars|MAX_PAGE|
DEFAULT_PAGE|maxChars"`): `hooks/recover.ts` (schema, two constants, deny text), `tests/recover.test.ts` (lines asserting the schema, 100000,
100001 and the deny texts), `docs/specs/spec-1-core-shake.md` sections 3, 7 and 12 (historical; the architect annotates its header),
`docs/architecture.md` (generic wording, no numbers); all code and test hits are in section 0, the rest are architect-owned. No
file other than `hooks/recover.ts` consumes the constants (`register.ts` passes `e.maxChars` through unvalidated). Values stated twice
(description, limits, deny text) were compared between sections 3, 4 and 7. Probe fact for section 4's `manual` test: a plugin-requested
compaction is recorded `manual` (live round 4) and the marker check precedes the manual-instructions check in `register.ts`
(read, `hooks/register.ts` `session.compact`).

Consultant input (`m_546`), dispositions: B description adopted verbatim; C page limits adopted (8000 default, 20000 maximum);
the over-limit deny now states the limit (spec 1's "larger is invalid, not clamped" kept, only the message changes); C2 (shake recovered
pages by naming the same artifact) deferred to the backlog; D3 and D4 documented in the README and pinned by a test;
the placeholder change is deferred until live experiment E2 gives evidence; experiments E1 (resume replay) and E2 (live check of this spec)
are tester work, not part of this acceptance.
