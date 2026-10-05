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
    if (e.trigger === 'manual' && typeof e.instructions === 'string' && /\S/.test(e.instructions)) {
      return next(e)
    }
    const fallback = () =>
      config.fallback === 'builtin' ? next(e) : { skip: 'ctrscm: shake not applied' }
    if (!isRecoverReady) return fallback()

    const selection = selectResults(e.messages, config)
    if (selection.selected.length === 0) return fallback()
    let root: string | undefined
    try {
      const home = config.artifactDir === undefined ? await $.env.get('HOME') : undefined
      root = rootOf(config.artifactDir, home)
    } catch (error) {
      $.ui.log(`CTRSCM: artifact root lookup failed: ${errorMessage(error)}`)
      return fallback()
    }
    if (root === undefined) return fallback()

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
      return fallback()
    }

    const messages = rebuild(e.messages, placeholders)
    $.ui.log(`CTRSCM: shook ${selection.selected.length} tool results (~${selection.savings} estimated tokens)`)
    return { messages }
  })
}
