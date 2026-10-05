# AGENTS.md

Conventions for anyone (human or agent) changing this repository. Design lives in
`docs/`; read `docs/architecture.md` before touching a module, and the governing
spec under `docs/specs/` before implementing.

CTRSCM is a Claude Code **Mod**: a plugin whose behavior lives in a hooks module
(`hooks/register.ts`, one `register(on, options)` entry). The repository root is the
plugin directory.

## Commands

Run all of these before calling a change done; they must pass with no warnings:

```sh
claude plugin validate . --strict
claude plugin test .
```

- To try the mod live: `claude --plugin-dir .` (early access: hooks modules load only
  where function hooks are enabled, and the API may change between releases).
- There is no TypeScript compiler on this machine, so there is no typecheck gate. Write
  types as if one ran (`strict`, `noUncheckedIndexedAccess`) and import engine types
  with `import type … from 'claude-code'`.
- `types/` holds the engine's declarations (`/plugin-types` writes them) and is
  gitignored. The reference copy is `mods/types/claude-code.d.ts` in the
  `anthropics/claude-code` repository.

## TypeScript conventions

- No `any`, no `as` casts except `as const` and the documented test seam (`as never` on
  the dispatch of `$.session.compact` and `$.tool.call`, tests only; see the spec). No `eval`, no dynamic `import`.
- Never swallow an error silently: report it with `$.ui.log` or return it as a tool
  error. A failed artifact write must reach the fallback, never a partial transcript.
- All file access goes through `$.fs`; all environment access through `$.env`. Do not
  import `node:*` modules: the hooks module runs in an environment of its own.
- Pure logic (selection, placeholders, chunking, rebuilding messages) lives in modules
  that take plain data and return plain data, with no `$`. I/O modules take the `$`
  member they need (`$.fs`) as a parameter.
- When cutting a corner on purpose, leave a `// shortcut:` comment naming the ceiling
  and the upgrade trigger.
- Comments explain why, not what. Match the density of the surrounding code.

## Product invariants

These hold in every spec. A change that breaks one needs an owner decision.

- Never summarize, rewrite, or delete user or assistant text. Only eligible tool-result
  text is externalized.
- Never remove a tool call, reorder messages, or change a `tool_use_id`.
- Recoverability beats savings: an artifact is committed (chunks, then manifest last)
  before any placeholder naming it is returned. An orphaned artifact is acceptable; an
  unrecoverable placeholder is not.
- Any failure falls back (built-in compaction by default); a partially shaken
  transcript is never returned.
- Never print or log tool-result bodies. Logs name counts and ids only.
- Do not state an estimated token count as an exact one.

## Tests

- Test through public interfaces at agreed seams (the pure modules, and the registered
  hooks driven through `$`); do not test private functions or mock internal
  collaborators.
- Write the failing test first, then the minimum code to pass it, one behavior at a time.
- Expected values come from literals or worked examples, never recomputed with the logic
  under test.
- Tests answer the world beneath the mod with `on(...)` hooks and the `mock` helpers
  (`claude-code/testing`); no real files outside a temp location, no network.
- A test file is named for what it covers under `hooks/`; shared data lives under
  `tests/fixtures/`, one export per file.

## Modules

| Module | Owns |
| --- | --- |
| `hooks/register.ts` | The `register(on, options)` entry; wires `session.start`, `session.compact`, and the recovery `tool.call` |
| `hooks/config.ts` | Parsing `PluginOptions` into a validated config with defaults |
| `hooks/shake.ts` | Pure selection of eligible tool results, placeholders, token estimates, rebuilding messages |
| `hooks/artifacts.ts` | Chunking, artifact write (chunks then manifest), manifest validation, paged read, over `$.fs` |
| `hooks/recover.ts` | The recovery tool's name, schema and call handler |

## Documents

| Path | Holds |
| --- | --- |
| `README.md` | What this is, status, how to try it |
| `docs/architecture.md` | The design, the verified Mod API facts, open verification items |
| `docs/backlog.md` | The running list of open items; a tracker, not a design |
| `docs/specs/spec-N-name.md` | One locked spec per implementation slice |
| `docs/intent.md` | The original ChatGPT-generated intent document. **Unverified input**, not a spec; where it disagrees with `docs/architecture.md` or a spec, they win |

## Public repository rules

Examples and fixtures use fictional names and paths (`/work`, `tool-a`, `example.invalid`).
No personal data, no credentials, no content copied from private memory stores.
