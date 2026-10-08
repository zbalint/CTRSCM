# CTRSCM

Claude Tool Result Shake Compaction Mod: a Claude Code Mod that replaces summary-based
compaction, where it can, with mechanical **Shake** compaction. Old, heavy tool-result text
is written to local artifacts and replaced in the live transcript by a short reference.
Every user and assistant message and every tool call stays verbatim, and every removed
result stays recoverable through a small tool.

The idea comes from the Shake mode in OMP (`can1357/oh-my-pi`, `packages/agent/src/compaction/shake.ts`),
which runs before provider-side compaction and reclaims most of the context window without
a summarizer.

## Status

Specs 1 to 9 are implemented and tested: Shake compaction with recovery, proactive Shake, `/shake`, `/ctrscm`, image-safe selection,
recovery steering, placeholder labels, the usage log and advice, the turn-end compaction request, per-turn usage events with `/ctrscm report`,
and the default config file.

- The plugin validates strictly; the mock-based suite covers configuration, proactive thresholds,
  cooldowns, command queues, status output, image safety, chunked artifacts, recovery pages and
  registered hook fallbacks.
- Live interactive behavior remains open verification work listed in
  [docs/specs/spec-2-proactive-shake.md](docs/specs/spec-2-proactive-shake.md) (L1–L4) and
  [docs/verification.md](docs/verification.md).
- Mods are early access: hooks modules load only where function hooks are enabled, and the
  API may change between releases without notice.

## Scope

CTRSCM is deliberately narrow. It is not a summarizer, a memory system, or a context manager.
Version 1 externalizes tool-result text only, on the `session.compact` event, and falls back to
Claude Code's built-in compaction whenever Shake cannot safely make enough progress.

## Design documents

| Document | Holds |
| --- | --- |
| [docs/usage.md](docs/usage.md) | How to enable, configure and observe the mod |
| [docs/architecture.md](docs/architecture.md) | Design, verified API facts, open verification items |
| [docs/specs/](docs/specs/) | Locked implementation specs |
| [docs/backlog.md](docs/backlog.md) | Open items and ideas |
| [docs/intent.md](docs/intent.md) | Original intent document (unverified input) |
| [AGENTS.md](AGENTS.md) | Conventions for anyone changing the repository |

## Trying it

The Shake implementation is available from this repository:

```sh
claude --plugin-dir .
```

Then use `/shake` to queue an aggressive pass for the next turn, or `/compact` to run the
configured compaction behavior. Proactive Shake requests run after a changed-context measurement
when a configured threshold is reached. Tests and manifest validation:

```sh
claude plugin validate . --strict
claude plugin test .
. ~/.nvm/nvm.sh && npx tsc -p tsconfig.json
```

## Options

Options reach the mod as strings in the plugin configuration, or from the config file below. Defaults:

| Option | Default | Meaning |
| --- | --- | --- |
| `protectTokens` | `16000` | Estimated recent context protected from ordinary Shake. |
| `minSavings` | `4000` | Minimum estimated savings required to apply Shake. |
| `minResultTokens` | `1000` | Minimum estimated result size eligible for externalization. |
| `protectedTools` | `Skill` | Comma-separated tools whose results stay in the transcript. |
| `artifactDir` | empty | Artifact root; empty uses `$HOME/.ctrscm/artifacts`. |
| `fallback` | `builtin` | Use built-in compaction or skip when Shake is not applied. |
| `autoShake` | `on` | Enable proactive threshold requests. |
| `triggerPercent` | `50` | Context percentage threshold. |
| `triggerTokens` | `120000` | Context token threshold; `0` disables this threshold. |
| `adviseTokens` | `150000` | Context token threshold for advice; `0` disables advice. |
| `idleShakeMinutes` | `0` | Minutes idle before the first prompt back requests an idle Shake (the prompt cache is cold by then); `0` disables it. |
| `usageLog` | `on` | Write one count-and-id usage event file per tracked event under the artifact root. |
| `cooldownTurns` | `3` | Changed-context measurements between proactive requests. |
| `aggressiveProtectTokens` | `4000` | Estimated recent context protected by `/shake`. |

Usage log files hold counts and ids only (no tool text), with one file per event under `{artifact root}/usage/`. On a 200k window, default `triggerPercent` 50 (100k tokens) fires before `triggerTokens` 120000, which only matters on larger windows; `adviseTokens` 150000 and `triggerTokens` 120000 follow the owner's observation that answer quality degrades from roughly 150k tokens.

`/ctrscm report` summarizes the current session's turn counts and estimated per-pass prompt and cache changes.

`triggerPercent` is a percentage of the model's full context window (200k on the model the live tests used, 1M on the 1M-context models, where the default 50% is 500k tokens and `triggerTokens` is the better knob), not of the engine's automatic compaction window; the engine's own automatic compaction can fire first when its window is smaller (for example `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`), in which case the compaction still runs through Shake but not as a proactive request; set `triggerTokens` several thousand tokens (more than one turn's growth) below the engine's threshold when the proactive request should come first. Recovery pages default to 8000 characters and have a maximum of 20000 characters.

## Config file

CTRSCM reads `$HOME/.ctrscm/config.json` once at the first `session.start`. The file is a
flat JSON object whose option values are strings, numbers, or booleans; `protectedTools`
may also be an array of strings. A number is converted to its string form before normal
option parsing. Unknown keys and invalid value types are ignored and reported by name,
never with their values.

Configuration follows per-key precedence:

1. A passed option wins.
2. Otherwise, a value from the config file wins.
3. Otherwise, the built-in default in the table above applies.

With no file and no passed options, CTRSCM uses the built-in defaults. With a file and no
passed options, the file supplies its values. With both, each passed key wins while file
values for other keys remain active. A blank string is unset and allows the next source to
win. Use `protectedTools: "none"` or `protectedTools: []` to protect no tool; a blank
`protectedTools` value is unset and therefore keeps the default `Skill`.

## Commands

A shaken result's placeholder names the tool call it replaced (the tool name and a short hint such as the file path or command start) next to the artifact id.

- `/shake` queues an aggressive Shake pass for the next completed turn. It does not compact
  from inside its own command hook.
- `/ctrscm` prints the current thresholds, advice setting, the context size now and the engine's own compaction threshold (spec 10; `unavailable` or `unknown` when the engine does not answer), artifact root, usage log location, where the options came from (passed, config file,
  default), the config file path, session totals, last outcome and whether an aggressive request is pending.
- `/ctrscm report` summarizes the session's turn usage and the cache effect of each Shake pass.

## Credits

Shake compaction is the idea of **OMP** (oh-my-pi), <https://github.com/can1357/oh-my-pi>, MIT licensed,
copyright (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük, (c) 2026 Stencil Labs, Inc., and the
oh-my-pi contributors. The design here follows OMP's Shake (`packages/agent/src/compaction/shake.ts`,
read at commit `693fd6e12b`): mechanically replacing heavy old tool-result text with a short placeholder
while keeping every message and tool call, an artifact the model can read back, the protected recent tail,
the minimum-savings gate, the protected skill tool and the manual aggressive pass. CTRSCM is an independent
TypeScript implementation for Claude Code Mods, written from a description of that behavior; it contains
no OMP source code. Thank you to the OMP authors for the idea and for publishing it.

## Contributing

Read [AGENTS.md](AGENTS.md) first. Work happens on `develop` or a feature branch.

## License

See [LICENSE](LICENSE).
