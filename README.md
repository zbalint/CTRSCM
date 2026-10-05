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

Spec 2 (proactive Shake, `/shake`, `/ctrscm`, image-safe selection) is implemented and tested.

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

All options are strings in the plugin configuration. Defaults:

| Option | Default | Meaning |
| --- | --- | --- |
| `protectTokens` | `16000` | Estimated recent context protected from ordinary Shake. |
| `minSavings` | `4000` | Minimum estimated savings required to apply Shake. |
| `minResultTokens` | `200` | Minimum estimated result size eligible for externalization. |
| `protectedTools` | `Skill` | Comma-separated tools whose results stay in the transcript. |
| `artifactDir` | empty | Artifact root; empty uses `$HOME/.ctrscm/artifacts`. |
| `fallback` | `builtin` | Use built-in compaction or skip when Shake is not applied. |
| `autoShake` | `on` | Enable proactive threshold requests. |
| `triggerPercent` | `50` | Context percentage threshold. |
| `triggerTokens` | `0` | Context token threshold; `0` disables this threshold. |
| `cooldownTurns` | `3` | Changed-context measurements between proactive requests. |
| `aggressiveProtectTokens` | `4000` | Estimated recent context protected by `/shake`. |

`triggerPercent` is a percentage of the model's full context window (200k on the model the live tests used, 1M on the 1M-context models, where the default 50% is 500k tokens and `triggerTokens` is the better knob), not of the engine's automatic compaction window; the engine's own automatic compaction can fire first when its window is smaller (for example `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`), in which case the compaction still runs through Shake but not as a proactive request; set `triggerTokens` several thousand tokens (more than one turn's growth) below the engine's threshold when the proactive request should come first. Recovery pages default to 8000 characters and have a maximum of 20000 characters.

## Commands

A shaken result's placeholder names the tool call it replaced (the tool name and a short hint such as the file path or command start) next to the artifact id.

- `/shake` queues an aggressive Shake pass for the next completed turn. It does not compact
  from inside its own command hook.
- `/ctrscm` prints the current thresholds, artifact root, session totals, last outcome and
  whether an aggressive request is pending.

## Contributing

Read [AGENTS.md](AGENTS.md) first. Work happens on `develop` or a feature branch.

## License

See [LICENSE](LICENSE).
