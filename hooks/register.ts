import type { On, PluginOptions } from 'claude-code'
import { mergeOptions, parseConfig } from './config'
import { readConfigFile } from './configFile'
import { writeArtifact } from './artifacts'
import { RECOVER_DESCRIPTION, RECOVER_NAME, RECOVER_SCHEMA, recoverResult } from './recover'
import {
  RECOVER_TOOL,
  placeholderOf,
  rebuild,
  selectResults,
} from './shake'
import { statusText, type OptionSources, type Stats } from './status'
import { decideAdvice, decideRequest, markOf, requestOf, type Request } from './trigger'
import { reportText } from './report'
import { usageEventPath, type TurnUsageEvent, type UsageEvent } from './usage'
import { readUsageEvents } from './usageLog'

function rootOf(artifactDir: string | undefined, home: string | undefined): string | undefined {
  if (artifactDir !== undefined) return artifactDir
  return home === undefined || home === '' ? undefined : `${home}/.ctrscm/artifacts`
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type UsageWriteOperations = {
  now: () => Promise<number>
  sessionId: () => Promise<string>
  write: (path: string, text: string) => Promise<void>
  log: (text: string) => void
}

async function writeUsageEvent(
  enabled: boolean,
  root: string | undefined,
  event: Omit<UsageEvent, 'version' | 'at' | 'sessionId'> | Omit<TurnUsageEvent, 'version' | 'at' | 'sessionId'>,
  operations: UsageWriteOperations,
): Promise<void> {
  if (!enabled || root === undefined) return
  try {
    const at = new Date(await operations.now()).toISOString()
    let sessionId: string | null = null
    try {
      sessionId = await operations.sessionId()
    } catch {
      sessionId = null
    }
    const uuid = crypto.randomUUID()
    await operations.write(
      usageEventPath(root, at, uuid),
      JSON.stringify({ version: 1, at, sessionId, ...event }),
    )
  } catch (error) {
    operations.log(`CTRSCM: usage log write failed: ${errorMessage(error)}`)
  }
}

async function quietRoot(
  artifactDir: string | undefined,
  readHome: () => Promise<string | undefined>,
  log: (text: string) => void,
): Promise<string | undefined> {
  try {
    return rootOf(artifactDir, artifactDir === undefined ? await readHome() : undefined)
  } catch (error) {
    log(`CTRSCM: artifact root lookup failed: ${errorMessage(error)}`)
    return undefined
  }
}

export function register(on: On, options: PluginOptions): void {
  const parsed = parseConfig(options)
  const config = parsed.config
  let problems = parsed.problems
  const initialSources = mergeOptions(options, {})
  let optionSources: OptionSources = { passed: initialSources.passed, fromFile: 0, path: undefined }
  let configFileRead = false
  let isRecoverReady = false
  let problemsLogged = false
  let cooldown = 0
  let isPending = false
  let isRequesting = false
  let wanted: Request | undefined
  let adviceCooldown = 0
  let lastContext: { tokens: number | null; percent: number | null } = { tokens: null, percent: null }
  let lastCostUsd: number | null = null
  const stats: Stats = { passes: 0, results: 0, savings: 0, last: 'none yet' }

  on('session.start', async ($, e, next) => {
    if (!configFileRead) {
      configFileRead = true
      let home: string | undefined
      try {
        home = await $.env.get('HOME')
      } catch {
        home = undefined
      }
      const loaded = await readConfigFile(
        {
          stat: (path) => $.fs.stat(path),
          read: (path) => $.fs.read(path),
        },
        home,
      )
      for (const log of loaded.logs) $.ui.log(log)
      if (loaded.file !== undefined) {
        const merged = mergeOptions(options, loaded.file)
        const fileParsed = parseConfig(merged.options)
        Object.assign(config, fileParsed.config)
        problems = fileParsed.problems
        optionSources = {
          passed: merged.passed,
          fromFile: merged.fromFile,
          path: home === undefined ? undefined : `${home}/.ctrscm/config.json`,
        }
      }
    }
    if (!problemsLogged) {
      for (const problem of problems) $.ui.log(`CTRSCM: ${problem}`)
      problemsLogged = true
    }
    try {
      await $.tool.register({
        name: RECOVER_NAME,
        description: RECOVER_DESCRIPTION,
        inputSchema: RECOVER_SCHEMA,
      })
      isRecoverReady = true
    } catch (error) {
      isRecoverReady = false
      $.ui.log(`CTRSCM: recovery registration failed: ${errorMessage(error)}`)
    }
    try {
      await $.command.register({
        name: 'shake',
        description: 'Queue an aggressive Shake pass for the next turn.',
      })
    } catch (error) {
      $.ui.log(`CTRSCM: command registration failed: ${errorMessage(error)}`)
    }
    try {
      await $.command.register({
        name: 'ctrscm',
        description: 'Show CTRSCM Shake status.',
      })
    } catch (error) {
      $.ui.log(`CTRSCM: command registration failed: ${errorMessage(error)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'shake' }, ($) => {
    if (!isRecoverReady) {
      return { text: 'CTRSCM: recovery tool unavailable; shake not queued' }
    }
    isPending = true
    return { text: 'CTRSCM: aggressive shake queued; it runs when the next turn completes' }
  })

  on('command.run', { command: 'ctrscm' }, async ($, e) => {
    if (e.args.trim() === 'report') {
      let root: string | undefined
      try {
        const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
        root = rootOf(config.artifactDir, home)
      } catch {
        return { text: 'CTRSCM report: usage log unavailable' }
      }
      if (root === undefined) return { text: 'CTRSCM report: usage log unavailable' }
      let sessionId: string
      try {
        sessionId = await $.session.id()
      } catch {
        return { text: 'CTRSCM report: session id unavailable' }
      }
      try {
        const result = await readUsageEvents(
          {
            list: (path) => $.fs.list(path),
            read: (path) => $.fs.read(path),
          },
          root,
          sessionId,
        )
        return { text: reportText(result.events, sessionId, result.skipped, lastCostUsd) }
      } catch (error) {
        return { text: `CTRSCM report: no usage events yet (${errorMessage(error)})` }
      }
    }
    let root: string | undefined
    try {
      const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
      root = rootOf(config.artifactDir, home)
    } catch {
      root = undefined
    }
    return { text: statusText(config, root, stats, isPending, optionSources) }
  })

  on('session.measure', async ($, e, next) => {
    lastCostUsd = e.cost?.usd ?? null
    if (e.changed.includes('context')) {
      lastContext = {
        tokens: e.context.tokens ?? null,
        percent: e.context.percent ?? null,
      }
      if (!isRequesting && wanted === undefined) {
        const decision = decideRequest(e.context, config, { cooldown, isPending })
        cooldown = decision.cooldown
        if (decision.request === 'aggressive') isPending = false
        if (decision.request !== undefined) {
          const request = decision.request
          isRequesting = true
          if (request === 'proactive') {
            $.ui.log(`CTRSCM: requesting proactive shake (context ${e.context.percent ?? '?'}%)`)
          } else {
            $.ui.log('CTRSCM: requesting aggressive shake')
          }
          try {
            await $.session.compact({ instructions: markOf(request) })
          } catch {
            wanted = request
            if (request === 'aggressive') isPending = true
          } finally {
            isRequesting = false
          }
        } else {
          const advice = decideAdvice(e.context, config, { cooldown: adviceCooldown })
          adviceCooldown = advice.cooldown
          if (advice.advise) {
            const text = `CTRSCM: context is ${e.context.tokens} tokens (advice threshold ${config.adviseTokens}); consider /compact or a new session`
            $.ui.toast(text)
            $.ui.log(text)
            const root = await quietRoot(config.artifactDir, () => $.env.get('HOME'), (text) => $.ui.log(text))
            await writeUsageEvent(
              config.usageLog,
              root,
              {
                agentId: null,
                event: 'advice',
                label: null,
                outcome: null,
                reason: null,
                results: 0,
                chars: 0,
                estimatedSavings: 0,
                artifactIds: [],
                contextTokens: e.context.tokens ?? null,
                contextPercent: e.context.percent ?? null,
                adviseTokens: config.adviseTokens,
              },
              {
                now: () => $.clock.now(),
                sessionId: () => $.session.id(),
                write: (path, text) => $.fs.write(path, text),
                log: (text) => $.ui.log(text),
              },
            )
          }
        }
      }
    }
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const turnContext = { tokens: lastContext.tokens, percent: lastContext.percent }
    const turnCostUsd = lastCostUsd
    const result = await next(e)
    if (config.usageLog) {
      const root = await quietRoot(config.artifactDir, () => $.env.get('HOME'), (text) => $.ui.log(text))
      await writeUsageEvent(
        config.usageLog,
        root,
        {
          agentId: e.agentId ?? null,
          event: 'turn',
          reason: e.reason,
          model: e.usage?.model ?? null,
          inputTokens: e.usage?.input_tokens ?? null,
          outputTokens: e.usage?.output_tokens ?? null,
          cacheCreationTokens: e.usage?.cache_creation_input_tokens ?? null,
          cacheReadTokens: e.usage?.cache_read_input_tokens ?? null,
          contextTokens: turnContext.tokens,
          contextPercent: turnContext.percent,
          sessionCostUsd: turnCostUsd,
        },
        {
          now: () => $.clock.now(),
          sessionId: () => $.session.id(),
          write: (path, text) => $.fs.write(path, text),
          log: (text) => $.ui.log(text),
        },
      )
    }
    if (wanted === undefined || isRequesting || e.reason !== 'answer' || e.agentId !== undefined) return result
    const request = isPending ? 'aggressive' : wanted
    wanted = undefined
    isPending = false
    isRequesting = true
    $.ui.log(`CTRSCM: retrying ${request} shake at turn end`)
    try {
      await $.session.compact({ instructions: markOf(request) })
    } catch (error) {
      $.ui.log(`CTRSCM: ${request} shake failed: ${errorMessage(error)}`)
      stats.last = `${request} skipped: compaction failed`
      const root = await quietRoot(config.artifactDir, () => $.env.get('HOME'), (text) => $.ui.log(text))
      await writeUsageEvent(
        config.usageLog,
        root,
        {
          agentId: null,
          event: 'shake',
          label: request,
          outcome: 'failed',
          reason: 'compaction failed',
          results: 0,
          chars: 0,
          estimatedSavings: 0,
          artifactIds: [],
          contextTokens: lastContext.tokens,
          contextPercent: lastContext.percent,
          adviseTokens: null,
        },
        {
          now: () => $.clock.now(),
          sessionId: () => $.session.id(),
          write: (path, text) => $.fs.write(path, text),
          log: (text) => $.ui.log(text),
        },
      )
    } finally {
      isRequesting = false
      cooldown = config.cooldownTurns
    }
    return result
  })
  on('tool.call', { tool: RECOVER_TOOL }, async ($, e) => {
    let root: string | undefined
    try {
      const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
      root = rootOf(config.artifactDir, home)
    } catch {
      return { deny: 'artifact root unavailable' }
    }
    if (root === undefined) return { deny: 'artifact root unavailable' }
    const fs = {
      read: (path: string) => $.fs.read(path),
      write: (path: string, text: string) => $.fs.write(path, text),
    }
    return recoverResult(fs, root, {
      id: e.id,
      offset: e.offset,
      maxChars: e.maxChars,
    })
  })

  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return { skip: 'ctrscm: nothing to precompute' }
    const request = requestOf(e.instructions)
    if (
      request === undefined &&
      e.trigger === 'manual' &&
      typeof e.instructions === 'string' &&
      /\S/.test(e.instructions)
    ) {
      return next(e)
    }
    const markedSkip = async (reason: string, root: string | undefined, shouldWrite = true) => {
      stats.last = `${request ?? 'unknown'} skipped: ${reason}`
      if (shouldWrite) await writeShakeEvent(root, 'skipped', reason)
      return { skip: `ctrscm: ${reason}` }
    }
    const markedFailure = async (reason: string, root: string | undefined) => {
      stats.last = `${request ?? 'unknown'} skipped: ${reason}`
      await writeShakeEvent(root, 'failed', reason)
      return { skip: `ctrscm: ${reason}` }
    }
    const trackedTrigger = e.trigger === 'manual' || e.trigger === 'auto' || e.trigger === 'plugin'
    const writeShakeEvent = async (
      root: string | undefined,
      outcome: Exclude<UsageEvent['outcome'], null>,
      reason: string | null,
      results = 0,
      chars = 0,
      estimatedSavings = 0,
      artifactIds: string[] = [],
    ) => {
      await writeUsageEvent(
        config.usageLog,
        root,
        {
          agentId: e.agentId ?? null,
          event: 'shake',
          label: request ?? e.trigger,
          outcome,
          reason,
          results,
          chars,
          estimatedSavings,
          artifactIds,
          contextTokens: lastContext.tokens,
          contextPercent: lastContext.percent,
          adviseTokens: null,
        },
        {
          now: () => $.clock.now(),
          sessionId: () => $.session.id(),
          write: (path, text) => $.fs.write(path, text),
          log: (text) => $.ui.log(text),
        },
      )
    }
    const eventRoot = () => quietRoot(config.artifactDir, () => $.env.get('HOME'), (text) => $.ui.log(text))
    const fallback = async (reason: string, root: string | undefined, shouldWrite = true) => {
      if (trackedTrigger) stats.last = `${e.trigger} skipped: shake not applied`
      if (shouldWrite) await writeShakeEvent(root, 'fallback', reason)
      return config.fallback === 'builtin' ? next(e) : { skip: 'ctrscm: shake not applied' }
    }
    if (request !== undefined && !Array.isArray(e.messages)) return markedSkip('no transcript', await eventRoot())
    if (!isRecoverReady) {
      return request === undefined
        ? fallback('recovery tool not registered', await eventRoot())
        : markedSkip('recovery tool not registered', await eventRoot())
    }

    const settings =
      request === 'aggressive' ? { ...config, protectTokens: config.aggressiveProtectTokens } : config
    const selection = selectResults(e.messages, settings)
    if (selection.selected.length === 0) {
      return request === undefined
        ? fallback('nothing worth shaking', await eventRoot())
        : markedSkip('nothing worth shaking', await eventRoot())
    }
    const chars = selection.selected.reduce((total, selected) => total + selected.text.length, 0)
    let root: string | undefined
    try {
      const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
      root = rootOf(config.artifactDir, home)
    } catch (error) {
      $.ui.log(`CTRSCM: artifact root lookup failed: ${errorMessage(error)}`)
      return request === undefined
        ? fallback('artifact root unavailable', undefined, false)
        : markedSkip('artifact root unavailable', undefined, false)
    }
    if (root === undefined) {
      return request === undefined
        ? fallback('artifact root unavailable', undefined, false)
        : markedSkip('artifact root unavailable', undefined, false)
    }

    const placeholders = new Map<string, string>()
    const artifactIds: string[] = []
    let written = 0
    const fs = {
      read: (path: string) => $.fs.read(path),
      write: (path: string, text: string) => $.fs.write(path, text),
    }
    try {
      for (const selected of selection.selected) {
        const id = crypto.randomUUID()
        await writeArtifact(
          fs,
          root,
          {
            version: 1,
            id,
            agentId: e.agentId ?? null,
            toolUseId: selected.toolUseId,
            toolName: selected.toolName ?? null,
            createdAt: new Date(await $.clock.now()).toISOString(),
          },
          selected.text,
        )
        placeholders.set(selected.toolUseId, placeholderOf(id, selected.text.length, selected.tokens, selected.label))
        artifactIds.push(id)
        written += 1
      }
    } catch (error) {
      $.ui.log(`CTRSCM: artifact write failed after ${written} artifacts: ${errorMessage(error)}`)
      return request === undefined
        ? fallback('artifact write failed', root)
        : markedFailure('artifact write failed', root)
    }

    const messages = rebuild(e.messages, placeholders)
    $.ui.log(`CTRSCM: shook ${selection.selected.length} tool results (~${selection.savings} estimated tokens)`)
    if (request !== undefined || trackedTrigger) {
      stats.passes += 1
      stats.results += selection.selected.length
      stats.savings += selection.savings
      const label = request ?? e.trigger
      stats.last = `${label} shook ${selection.selected.length} results (~${selection.savings} estimated tokens)`
    }
    await writeShakeEvent(
      root,
      'shook',
      null,
      selection.selected.length,
      chars,
      selection.savings,
      artifactIds,
    )
    return { messages }
  })
}
