# Architecture

Status: design for v1. Facts marked **verified** were read from source on 2026-10-05
(Claude Code 2.1.289; `anthropics/claude-code` at `2bfb629`, file `mods/types/claude-code.d.ts`;
OMP at `693fd6e12b`, file `packages/agent/src/compaction/shake.ts`) or run (`claude plugin test`,
`claude plugin validate` on the shipped `agents-md` mod, and a throwaway probe of the
`session.compact` test seam). Anything else is an open item below.

## What it does

When Claude Code compacts (`/compact`, the engine's threshold, a plugin call), a
`session.compact` hook receives the whole transcript. CTRSCM picks old, heavy tool-result text,
writes each to an artifact on disk, and answers `{ messages }` of its own: the same transcript
with those results replaced by a placeholder naming a recovery tool. If Shake cannot save enough,
or anything fails, it calls `next(e)` and the built-in summarizer runs.

Why this ordering is right: built-in compaction invalidates the prompt cache anyway, so shaking
at that moment adds no cache cost; and tool output is most of a long session's context, so
removing it often avoids a summary altogether.

## Verified Mod API facts

- **Transcript rewrite.** `session.compact` input is `{ trigger, agentId?, instructions?, messages }`;
  the hook may answer `{ messages }` (replaces the transcript; there is no summary string, "the
  summary is a message") or `{ skip: reason }` (conversation stays as is), or call `next(e)` for
  the built-in result. Triggers: `manual`, `auto`, `plugin`, `precompute`. `precompute` is the one
  dispatch that installs nothing; its result is kept for the compaction that comes.
- **Messages.** `SessionMessage = { role, text, toolUses, toolResults?, handle? }`. A tool result is
  a `ToolResultSummary` `{ tool_use_id, text, isError, result? }` on a **user** message; `text` is
  what the model read. A message returned with its `handle` stands as the engine has it; one
  without is built from `role`, `text` and tool blocks.
- **Tool names.** An assistant message's `toolUses[]` is `{ tool_use_id, tool, input, result?, text?, isError? }`;
  pairing a result to its tool name goes through `tool_use_id`.
- **Custom tool.** `$.tool.register({ name, description, inputSchema })` at `session.start` declares
  `mcp__<plugin>__<name>`; a `tool.call` hook on that name answers `{ result }`, or `{ deny: message }` to return an error to the model.
  A `tool.call` event carries the tool's inputs as top-level fields.
- **Files.** `$.fs` has `read`, `write`, `list`, `exists`, `stat`; a read or write over 4 MiB
  rejects; `write` creates directories; there is **no delete**. `$.store` is about 4 MiB of JSON
  total. `crypto.randomUUID()` is declared in the runtime.
- **Identity and context.** `$.session.id()`, `$.session.usage()` (context percent and the auto-compact
  threshold), `$.session.compact(args)` (the same call `/compact` makes) exist. There is no
  token-count API: counts are estimates.
- **Hook budget.** A hook has 10,000 ms per dispatch; past it the hook is treated as absent and
  `next(e)` runs on its behalf, so a timeout degrades to built-in compaction.
- **Test seam.** `claude plugin test .` runs locally. `$.session.compact({ trigger, messages } as ...)`
  dispatches the hook with a chosen transcript (a bare `$.session.compact()` supplies none, because
  no core runs in a test). The world beneath is answered with `on('session.id' | 'session.messages' |
  'fs.write' | 'fs.read' | …)`.
- **OMP's Shake** (reference behavior): auto defaults protect the newest 16,000 tokens, need 4,000
  tokens total savings, and protect the `skill` tool and artifact-recovery reads; manual `/shake`
  protects 4,000 tokens; results flagged useless bypass the protected tail; tool calls are never
  removed; one artifact per Shake pass; it also elides large fenced and XML blocks in prose (CTRSCM
  v1 does not).

## Design decisions (v1)

- **Where it runs:** `session.compact` (spec 1) and, from spec 2, a `session.measure` hook that asks
  for a marked proactive compaction at a configurable threshold, with `/shake` and `/ctrscm` commands.
  `precompute` answers `{ skip }` (documented as computing and keeping nothing). A marked request
  never reaches the built-in summarizer. The host refuses `$.session.compact` from a `command.run`
  hook, so `/shake` queues a request that runs at the next measure.
- **Selection:** a tool result is eligible when it has text, sits outside the protected recent tail,
  is not an error, is not a protected tool, is not already a placeholder, and is large enough to save
  tokens. Defaults: protect 16,000 estimated tokens, require 4,000 estimated savings, minimum result
  200 estimated tokens, protect `Skill` and CTRSCM's own recovery tool.
- **Estimates:** `ceil(chars / 4)`, named and reported as estimates.
- **Rewrite scope:** only user messages that carry an eligible `toolResults` entry are rebuilt (their
  `handle` is dropped); every other message is returned as the engine's own object. A shaken entry
  keeps `tool_use_id` and `isError`, gets the placeholder as `text`, and loses `result` (it would
  carry the full bulk).
- **Artifacts:** one directory per result, `<root>/<uuid>/chunk-0000.txt …` then `manifest.json` last
  (the commit marker). Chunks hold at most 262,144 UTF-16 units, never splitting a surrogate pair.
  Root: the `artifactDir` option, else `$HOME/.ctrscm/artifacts`; if `HOME` is
  unset the compaction falls back. No project-directory fallback.
- **Recovery:** `mcp__ctrscm__recover` takes `{ id, offset?, maxChars? }` and returns a bounded page
  with a header stating the range and whether more remains.
- **Fallback:** `builtin` (default, `next(e)`) or `skip`. A `/compact` with custom instructions always
  goes to the built-in summarizer, because the person asked for a summary.
- **Failure:** any artifact write failure, missing home directory or failed tool registration means
  fallback; nothing partial is returned. Orphaned artifact files are left on disk (no delete
  primitive) and are inert without a manifest.

## Open verification items

Not answerable from declarations; each needs a live run (`claude --plugin-dir .`). They gate a
"v1 works" claim, not the implementation of spec 1.

| ID | Question |
| --- | --- |
| V1 | Does a rebuilt user message (no `handle`) round-trip a shaken tool result correctly in interactive mode? |
| V2 | Is a non-text block (an image) in a rebuilt user message preserved or lost? If lost, spec 2 must skip such messages |
| V3 | Observable prompt-cache behavior after a rewritten transcript |
| V4 | Headless (`-p`) mode and `--resume` behavior of rebuilt messages |
| V5 | Does `{ skip }` on `precompute` have any effect on the real compaction that follows? |
| V6 | Does the 10 s hook budget count `$.fs` waits when an artifact set is large? (The declarations say the clock stops while `$` calls and `next(e)` are in flight; confirm live) |
| V7 | Does the model use the recovery tool sensibly from the placeholder alone? |

The original intent document's Section 26 questions map as: Q1 no token API (above); Q2 contract
(above); Q3 = V6; Q4 yes; Q5 not applicable (Linux and WSL only in v1); Q6 no delete primitive;
Q7 = V1, V4; Q8 = V3; Q9 = V5; Q10 deferred (backlog).
