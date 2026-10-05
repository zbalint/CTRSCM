import type { On, PluginOptions } from 'claude-code'
import { parseConfig } from './config'
import { writeArtifact } from './artifacts'
import { RECOVER_DESCRIPTION, RECOVER_NAME, RECOVER_SCHEMA, recoverResult } from './recover'
import {
  RECOVER_TOOL,
  placeholderOf,
  rebuild,
  selectResults,
} from './shake'
import { statusText, type Stats } from './status'
import { decideRequest, markOf, requestOf } from './trigger'
function rootOf(artifactDir: string | undefined, home: string | undefined): string | undefined {
  if (artifactDir !== undefined) return artifactDir
  return home === undefined || home === '' ? undefined : `${home}/.ctrscm/artifacts`
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function register(on: On, options: PluginOptions): void {
  const parsed = parseConfig(options)
  const config = parsed.config
  let isRecoverReady = false
  let problemsLogged = false
  let cooldown = 0
  let isPending = false
  let isRequesting = false
  const stats: Stats = { passes: 0, results: 0, savings: 0, last: 'none yet' }

  on('session.start', async ($, e, next) => {
    if (!problemsLogged) {
      for (const problem of parsed.problems) $.ui.log(`CTRSCM: ${problem}`)
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

  on('command.run', { command: 'ctrscm' }, async ($) => {
    let root: string | undefined
    try {
      const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
      root = rootOf(config.artifactDir, home)
    } catch {
      root = undefined
    }
    return { text: statusText(config, root, stats, isPending) }
  })

  on('session.measure', async ($, e, next) => {
    if (!isRequesting && e.changed.includes('context')) {
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
        } catch (error) {
          $.ui.log(`CTRSCM: ${request} shake failed: ${errorMessage(error)}`)
          stats.last = `${request} skipped: compaction failed`
        } finally {
          isRequesting = false
        }
      }
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
    const markedSkip = (reason: string) => {
      stats.last = `${request ?? 'unknown'} skipped: ${reason}`
      return { skip: `ctrscm: ${reason}` }
    }
    const trackedTrigger = e.trigger === 'manual' || e.trigger === 'auto' || e.trigger === 'plugin'
    const fallback = () => {
      if (trackedTrigger) stats.last = `${e.trigger} skipped: shake not applied`
      return config.fallback === 'builtin' ? next(e) : { skip: 'ctrscm: shake not applied' }
    }
    if (request !== undefined && !Array.isArray(e.messages)) return markedSkip('no transcript')
    if (!isRecoverReady) return request === undefined ? fallback() : markedSkip('recovery tool not registered')

    const settings =
      request === 'aggressive' ? { ...config, protectTokens: config.aggressiveProtectTokens } : config
    const selection = selectResults(e.messages, settings)
    if (selection.selected.length === 0) {
      return request === undefined ? fallback() : markedSkip('nothing worth shaking')
    }
    let root: string | undefined
    try {
      const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
      root = rootOf(config.artifactDir, home)
    } catch (error) {
      $.ui.log(`CTRSCM: artifact root lookup failed: ${errorMessage(error)}`)
      return request === undefined ? fallback() : markedSkip('artifact root unavailable')
    }
    if (root === undefined) return request === undefined ? fallback() : markedSkip('artifact root unavailable')

    const placeholders = new Map<string, string>()
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
        placeholders.set(selected.toolUseId, placeholderOf(id, selected.text.length, selected.tokens))
        written += 1
      }
    } catch (error) {
      $.ui.log(`CTRSCM: artifact write failed after ${written} artifacts: ${errorMessage(error)}`)
      return request === undefined ? fallback() : markedSkip('artifact write failed')
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
    return { messages }
  })
}
