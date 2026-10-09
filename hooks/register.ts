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
import { statusText, type EngineStatus, type OptionSources, type Stats } from './status'
import { decideAdvice, decideRequest, markOf, requestOf, type Request } from './trigger'
import { reportText } from './report'
import { ERROR_TEXT_LIMIT, usageEventPath, type DeferUsageEvent, type TurnUsageEvent, type UsageEvent } from './usage'
import { readUsageEvents } from './usageLog'

function rootOf(artifactDir: string | undefined, home: string | undefined): string | undefined {
  if (artifactDir !== undefined) return artifactDir
  return home === undefined || home === '' ? undefined : `${home}/.ctrscm/artifacts`
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// shortcut: fixed floor keeps tiny sessions out; make it an option if the owner wants tuning.
const IDLE_MIN_CONTEXT_TOKENS = 30000

type UsageWriteOperations = {
  now: () => Promise<number>
  sessionId: () => Promise<string>
  write: (path: string, text: string) => Promise<void>
  log: (text: string) => void
}

async function writeUsageEvent(
  enabled: boolean,
  root: string | undefined,
  event:
    | Omit<UsageEvent, 'version' | 'at' | 'sessionId'>
    | Omit<DeferUsageEvent, 'version' | 'at' | 'sessionId'>
    | Omit<TurnUsageEvent, 'version' | 'at' | 'sessionId'>,
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
type ContextSnapshot = { tokens: number | null; percent: number | null }

function failedCompactionEvent(
  label: Request,
  error: unknown,
  context: ContextSnapshot,
): Omit<UsageEvent, 'version' | 'at' | 'sessionId'> {
  return {
    agentId: null,
    event: 'shake',
    label,
    outcome: 'failed',
    reason: 'compaction failed',
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: context.tokens,
    contextPercent: context.percent,
    adviseTokens: null,
    error: errorMessage(error).slice(0, ERROR_TEXT_LIMIT),
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
  // shortcut: once per registration; make it periodic or per session if a cadence is wanted.
  let passHintShown = false
  let isPending = false
  let isRequesting = false
  let wanted: Request | undefined
  let adviceCooldown = 0
  let lastContext: ContextSnapshot = { tokens: null, percent: null }
  let lastTurnAt: number | undefined
  let resumedContextTokens: number | undefined
  const runningTurns = new Set<string>()
  let lastCostUsd: number | null = null
  const stats: Stats = { passes: 0, results: 0, savings: 0, last: 'none yet' }

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'resume' || e.source === 'fork' || e.source === 'clear') {
      lastTurnAt = undefined
      resumedContextTokens = undefined
      lastContext = { tokens: null, percent: null }
    }

    const seconds = e.seconds_since_last_response
    const contextTokens = e.context_tokens
    if (
      (e.source !== 'resume' && e.source !== 'fork') ||
      e.prompt_cache_likely_expired !== true ||
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      typeof contextTokens !== 'number' ||
      !Number.isFinite(contextTokens) ||
      contextTokens < 0
    ) {
      return next(e)
    }
    try {
      lastTurnAt = (await $.clock.now()) - seconds * 1000
      resumedContextTokens = contextTokens
    } catch (error) {
      $.ui.log(`CTRSCM: idle clock failed: ${errorMessage(error)}`)
    }
    return next(e)
  })

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
    let engine: EngineStatus
    try {
      const usage = await $.session.usage({ breakdown: 'summary' })
      const context = usage.context
      engine = {
        kind: 'ok',
        window: context.window,
        ...(context.tokens === undefined ? {} : { tokens: context.tokens }),
        ...(context.percent === undefined ? {} : { percent: context.percent }),
        ...(context.breakdown === undefined
          ? {}
          : {
              autoCompact: {
                isEnabled: context.breakdown.isAutoCompactEnabled,
                ...(context.breakdown.autoCompactThreshold === undefined
                  ? {}
                  : { threshold: context.breakdown.autoCompactThreshold }),
              },
            }),
      }
    } catch (error) {
      engine = { kind: 'unavailable', reason: errorMessage(error) }
    }
    return { text: statusText(config, root, stats, isPending, optionSources, engine) }
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
          let deferError: string | undefined
          let deferTrackedTurns: string[] | undefined
          isRequesting = true
          if (request === 'proactive') {
            $.ui.log(`CTRSCM: requesting proactive shake (context ${e.context.percent ?? '?'}%)`)
          } else {
            $.ui.log('CTRSCM: requesting aggressive shake')
          }
          try {
            await $.session.compact({ instructions: markOf(request) })
          } catch (error) {
            deferError = errorMessage(error).slice(0, ERROR_TEXT_LIMIT)
            deferTrackedTurns = [...runningTurns]
            $.ui.log(`CTRSCM: ${request} shake deferred to turn end: ${errorMessage(error)}`)
            wanted = request
            if (request === 'aggressive') isPending = true
          } finally {
            isRequesting = false
          }
          if (deferError !== undefined && deferTrackedTurns !== undefined && config.usageLog) {
            const root = await quietRoot(config.artifactDir, () => $.env.get('HOME'), (text) => $.ui.log(text))
            await writeUsageEvent(
              config.usageLog,
              root,
              {
                agentId: null,
                event: 'defer',
                kind: request,
                error: deferError,
                trackedTurns: deferTrackedTurns,
                contextTokens: e.context.tokens ?? null,
                contextPercent: e.context.percent ?? null,
              },
              {
                now: () => $.clock.now(),
                sessionId: () => $.session.id(),
                write: (path, text) => $.fs.write(path, text),
                log: (text) => $.ui.log(text),
              },
            )
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
  on('turn.start', ($, e, next) => {
    runningTurns.add(e.turnId)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    runningTurns.delete(e.turnId)
    if (e.agentId === undefined) runningTurns.clear()
    const turnContext = { tokens: lastContext.tokens, percent: lastContext.percent }
    const turnCostUsd = lastCostUsd
    const result = await next(e)
    if (e.agentId === undefined) {
      try {
        lastTurnAt = await $.clock.now()
      } catch (error) {
        $.ui.log(`CTRSCM: idle clock failed: ${errorMessage(error)}`)
        lastTurnAt = undefined
      }
      resumedContextTokens = undefined
    }
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
        failedCompactionEvent(request, error, lastContext),
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
  on('prompt.edit', async ($, e, next) => {
    const contextTokens = lastContext.tokens ?? resumedContextTokens
    if (
      config.idleShakeMinutes <= 0 ||
      !config.autoShake ||
      e.origin.kind !== 'composer' ||
      runningTurns.size > 0 ||
      !isRecoverReady ||
      isRequesting ||
      isPending ||
      wanted !== undefined ||
      lastTurnAt === undefined ||
      contextTokens === undefined ||
      contextTokens === null ||
      contextTokens < IDLE_MIN_CONTEXT_TOKENS
    ) {
      return next(e)
    }
    isRequesting = true
    let now: number
    try {
      now = await $.clock.now()
    } catch (error) {
      $.ui.log(`CTRSCM: idle clock failed: ${errorMessage(error)}`)
      isRequesting = false
      return next(e)
    }
    if (now - lastTurnAt < config.idleShakeMinutes * 60000) {
      isRequesting = false
      return next(e)
    }
    lastTurnAt = undefined
    resumedContextTokens = undefined
    $.ui.log(`CTRSCM: idle shake requested (idle ${config.idleShakeMinutes} min)`)
    try {
      await $.session.compact({ instructions: markOf('idle') })
    } catch (error) {
      $.ui.log(`CTRSCM: idle shake rejected: ${errorMessage(error)}`)
      stats.last = 'idle skipped: compaction failed'
      const root = await quietRoot(config.artifactDir, () => $.env.get('HOME'), (text) => $.ui.log(text))
      await writeUsageEvent(
        config.usageLog,
        root,
        failedCompactionEvent('idle', error, lastContext),
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
    return next(e)
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
    const marked = async (
      reason: string,
      root: string | undefined,
      outcome: 'skipped' | 'failed',
      shouldWrite = true,
      extra?: Pick<UsageEvent, 'eligibleSavings' | 'minSavings'>,
    ) => {
      stats.last = `${request ?? 'unknown'} skipped: ${reason}`
      if (shouldWrite) await writeShakeEvent(root, outcome, reason, 0, 0, 0, [], extra)
      return { skip: `ctrscm: ${reason}` }
    }
    const writeShakeEvent = async (
      root: string | undefined,
      outcome: Exclude<UsageEvent['outcome'], null>,
      reason: string | null,
      results = 0,
      chars = 0,
      estimatedSavings = 0,
      artifactIds: string[] = [],
      extra?: Pick<UsageEvent, 'eligibleSavings' | 'minSavings'>,
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
          ...extra,
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
    const fallback = async (
      reason: string,
      root: string | undefined,
      shouldWrite = true,
      extra?: Pick<UsageEvent, 'eligibleSavings' | 'minSavings'>,
    ) => {
      stats.last = `${e.trigger} skipped: shake not applied`
      if (shouldWrite) await writeShakeEvent(root, 'fallback', reason, 0, 0, 0, [], extra)
      return config.fallback === 'builtin' ? next(e) : { skip: 'ctrscm: shake not applied' }
    }
    if (request !== undefined && !Array.isArray(e.messages)) return marked('no transcript', await eventRoot(), 'skipped')
    if (!isRecoverReady) {
      return request === undefined
        ? fallback('recovery tool not registered', await eventRoot())
        : marked('recovery tool not registered', await eventRoot(), 'skipped')
    }

    const settings =
      request === 'aggressive'
        ? { ...config, protectTokens: config.aggressiveProtectTokens, protectTurns: 0, minSavings: 0 }
        : request === 'idle'
          ? { ...config, minSavings: 0 }
          : config
    const selection = selectResults(e.messages, settings)
    if (selection.selected.length === 0) {
      const extra = { eligibleSavings: selection.savings, minSavings: settings.minSavings }
      if (request === 'aggressive') $.ui.log('CTRSCM: aggressive shake skipped: nothing worth shaking')
      return request === undefined
        ? fallback('nothing worth shaking', await eventRoot(), true, extra)
        : marked('nothing worth shaking', await eventRoot(), 'skipped', true, extra)
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
        : marked('artifact root unavailable', undefined, 'skipped', false)
    }
    if (root === undefined) {
      return request === undefined
        ? fallback('artifact root unavailable', undefined, false)
        : marked('artifact root unavailable', undefined, 'skipped', false)
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
        : marked('artifact write failed', root, 'failed')
    }

    const messages = rebuild(e.messages, placeholders)
    $.ui.log(`CTRSCM: shook ${selection.selected.length} tool results (~${selection.savings} estimated tokens)`)
    stats.passes += 1
    if (!passHintShown) {
      $.ui.log('CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved')
      passHintShown = true
    }
    stats.results += selection.selected.length
    stats.savings += selection.savings
    const label = request ?? e.trigger
    stats.last = `${label} shook ${selection.selected.length} results (~${selection.savings} estimated tokens)`
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
