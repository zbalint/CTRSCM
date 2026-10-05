# Using CTRSCM

How to switch the mod on, set its options and see what it did. Everything here was run in the live tests
(`docs/verification.md`) unless marked **not verified**.

## Enabling it

CTRSCM is a Claude Code plugin whose behavior lives in a hooks module (early access: it only loads where function hooks are
enabled, tested on Claude Code 2.1.289). The route that was run:

```sh
claude --plugin-dir /path/to/CTRSCM
```

This loads the plugin for that session only. Nothing is installed and no persistent setting changes.

**Not verified:** a persistent install. `claude plugin install` takes a plugin from a marketplace, and this repository
ships no marketplace; `claude plugin list` shows nothing for a `--plugin-dir` plugin, so `claude plugin configure ctrscm`
and `claude plugin enable` have nothing to act on today.

## Configuring it

Options are strings (defaults and meaning in the README options table). The route that was run: a settings file with
`pluginConfigs`, passed on the launch command line.

```json
{
  "pluginConfigs": {
    "ctrscm": {
      "options": {
        "autoShake": "on",
        "triggerPercent": "50",
        "triggerTokens": "0",
        "cooldownTurns": "3",
        "protectTokens": "16000",
        "minSavings": "4000",
        "minResultTokens": "200",
        "aggressiveProtectTokens": "4000",
        "protectedTools": "Skill",
        "fallback": "builtin",
        "artifactDir": ""
      }
    }
  }
}
```

```sh
claude --plugin-dir /path/to/CTRSCM --settings /path/to/ctrscm-settings.json
```

An option you leave out keeps its default. A value that does not parse (for example `triggerPercent` `150`) keeps the
default and one `CTRSCM: option ...` line is logged at session start. `/ctrscm` prints the values in effect.

What to tune first:

- `triggerPercent` is a percentage of the model's full context window (for example 200k). The engine's own automatic
  compaction can fire first when its window is smaller; Shake still runs for it, just not as a proactive request. To make
  the proactive request come first, set `triggerTokens` several thousand tokens (more than one turn's growth) below the
  engine's threshold.
- `protectTokens` is the newest part of the conversation Shake never touches (default 16000 estimated tokens). `/shake`
  uses `aggressiveProtectTokens` instead.
- `artifactDir` defaults to `$HOME/.ctrscm/artifacts`. Artifacts are plain copies of the shaken tool output (they can
  hold anything a tool printed, including secrets) and nothing deletes them; remove old directories by hand.

## Commands

- `/ctrscm` prints the configuration in effect, the artifact directory, this session's totals (passes, results shaken,
  estimated tokens saved) and the last outcome.
- `/shake` queues an aggressive pass; it runs when the next turn completes.
- `/compact` keeps its normal meaning; with custom instructions it always goes to the built-in summarizer.

## What it logs today

- `$.ui.log` lines in the session (they show in the interface): `CTRSCM: requesting proactive shake (context N%)`,
  `CTRSCM: shook N tool results (~T estimated tokens)`, option problems and failures. Counts and ids only, never tool-result text.
- `/ctrscm` totals are kept in memory for the running session and are lost when it ends.
- The artifact directories under `artifactDir` are the durable trace: one directory per shaken result (`manifest.json` with
  the tool name, time and sizes, plus the chunk files).

There is **no persistent usage log** and nothing measures the effect on the prompt cache. The numbers in
`docs/verification.md` (tokens before and after a compaction, cache creation and read) came from analyzing the session
files after the run. Backlog items B15 and B16 track a persistent per-event log and a report tool.
