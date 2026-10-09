# Spec 16: reject a relative `artifactDir` (audit N4)

## 0. Status

**LOCKED** (2026-10-09), revision 1. Source: project audit second pass (context `ctrscm-audit`), consultant `m_873` verified the defect by reading `hooks/config.ts` and `$.fs` (`types/claude-code.d.ts` ~2731: a relative path is under the session's working directory). Owner delegated the decision.

**Scope.** Edits: `hooks/config.ts`, `tests/config.test.ts`, `README.md` (the `artifactDir` table row only). Does not touch anything else (the architect edits `docs/usage.md` and `docs/backlog.md` after acceptance). No new file, no new dependency, no new option. No commit, stage, merge or push: leave the diff uncommitted.

**Location and branch:** main checkout `<repo>` = `/home/zbalint/workspace/CTRSCM`, branch `develop`, at the commit that holds this spec. Start only after spec 15 (`ctrscm-audit-fixes`) is accepted and committed, so the tree is clean. **Shared task `context_id`:** `ctrscm-artifactdir`.
**Public test seams:** `parseConfig` (pure).

## 1. Why

`artifactDir` accepts any non-blank string. A relative value (`ctrscm-artifacts`, or `~/x`, which is not expanded and is just a relative name) resolves against the session's working directory, so artifacts written from `/work/a` cannot be found from `/work/b` after `--resume`: every placeholder from that session is then unrecoverable, which the product invariants forbid ("an unrecoverable placeholder is not acceptable"). The usage log and `/ctrscm report` split by directory the same way.

## 2. Decisions

- **D1.** In `parseConfig` (`hooks/config.ts`, the `artifactDir` block, ~lines 183 to 187): after trimming, accept a value only when it starts with `/`. Otherwise leave `config.artifactDir` `undefined` (the `$HOME/.ctrscm/artifacts` default) and push the problem `option artifactDir: must be an absolute path; using the default` (same pattern as the other option problems, so `register.ts` logs it unchanged). Blank and absent values stay silent as today.
- **D2.** Add one `// shortcut:` comment at that block: absolute means a leading `/`, so Windows drive paths are rejected; upgrade when a Windows target exists (backlog B6).
- **D3.** `README.md` `artifactDir` row becomes `| \`artifactDir\` | empty | Artifact root, an absolute path; empty uses \`$HOME/.ctrscm/artifacts\`. |`. No other README text.

## 3. Tests

Write the failing test first. In `tests/config.test.ts`: `artifactDir: ' /tmp/ctrscm '` still gives `'/tmp/ctrscm'` (existing assertion, lines 34 and 44); `'ctrscm-artifacts'`, `'./x'` and `'~/x'` each give `artifactDir` `undefined` and the problem text of D1; a blank value and an absent value give `undefined` with no problem. Existing tests pass unchanged except where a full `problems` list is asserted (extend only if one of them passes a relative `artifactDir`; the file currently does not).

## 4. Out of scope

Rewording the invalid-passed-value problem when a valid file value exists (N1, backlog), the on/off parsing duplicate (N2), Windows paths, tilde expansion, any change in `register.ts`.

## 5. Probe result

Baseline: tree at `5f9a78f` plus the spec 15 working diff; `hooks/config.ts` and `tests/config.test.ts` are unmodified by spec 15's scope. Architect read `hooks/config.ts` 183 to 187, `tests/config.test.ts` (artifactDir lines 12, 34, 44, 105, 212, 228) and `hooks/register.ts` `rootOf` (the value is used verbatim as the root).

## 6. Acceptance

```sh
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
claude plugin validate . --strict
claude plugin test .
rg -n "must be an absolute path|shortcut:" hooks/config.ts
git diff --check
git status --short
```

All three gates pass with no warnings, the test count is the post-spec-15 count plus the new tests, 0 fail, and `git status --short` shows only the three files named in section 0.
