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

Design and first spec only; nothing is implemented yet.

- Spec 1 (core Shake) is locked: [docs/specs/spec-1-core-shake.md](docs/specs/spec-1-core-shake.md).
- The Mod API was read from the published declarations (Claude Code 2.1.289, `anthropics/claude-code`
  at `2bfb629`); what is verified and what is still open is in [docs/architecture.md](docs/architecture.md).
- Mods are early access: hooks modules load only where function hooks are enabled, and the
  API may change between releases without notice.

## Scope

CTRSCM is deliberately narrow. It is not a summarizer, a memory system, or a context manager.
Version 1 externalizes tool-result text only, on the `session.compact` event, and falls back to
Claude Code's built-in compaction whenever Shake cannot safely make enough progress.

## Design documents

| Document | Holds |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Design, verified API facts, open verification items |
| [docs/specs/](docs/specs/) | Locked implementation specs |
| [docs/backlog.md](docs/backlog.md) | Open items and ideas |
| [docs/intent.md](docs/intent.md) | Original intent document (unverified input) |
| [AGENTS.md](AGENTS.md) | Conventions for anyone changing the repository |

## Trying it

Once spec 1 is implemented:

```sh
claude --plugin-dir .
```

then `/compact`, or let the engine compact at its threshold. Tests and manifest validation:

```sh
claude plugin validate . --strict
claude plugin test .
```

## Contributing

Read [AGENTS.md](AGENTS.md) first. Work happens on `develop` or a feature branch.

## License

See [LICENSE](LICENSE).
