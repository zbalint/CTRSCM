import type { SessionMessage } from 'claude-code'
import type { Config } from './config'

export const RECOVER_TOOL = 'mcp__ctrscm__recover'
export const PLACEHOLDER_PREFIX = '[CTRSCM shaken tool result:'
export const PLACEHOLDER_TOKEN_ESTIMATE = 40

export type Selected = {
  toolUseId: string
  toolName: string | undefined
  text: string
  tokens: number
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function placeholderOf(id: string, chars: number, tokens: number): string {
  return `[CTRSCM shaken tool result: ~${tokens} estimated tokens (${chars} chars) externalized; recover with mcp__ctrscm__recover id="${id}"]`
}
export function hasImage(value: unknown): boolean {
  const visit = (current: unknown, depth: number): boolean => {
    if (typeof current !== 'object' || current === null) return false
    try {
      if (
        Object.prototype.hasOwnProperty.call(current, 'base64') ||
        ('type' in current && current.type === 'image')
      ) {
        return true
      }
      if (depth >= 8) return false
      if (
        !Array.isArray(current) &&
        Object.getPrototypeOf(current) !== Object.prototype &&
        Object.getPrototypeOf(current) !== null
      ) return false
      for (const child of Object.values(current)) {
        if (visit(child, depth + 1)) return true
      }
    } catch {
      return false
    }
    return false
  }
  return visit(value, 0)
}

export function selectResults(
  messages: readonly SessionMessage[],
  settings: Pick<Config, 'protectTokens' | 'minSavings' | 'minResultTokens' | 'protectedTools'>,
): { selected: Selected[]; savings: number } {
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const toolUse of message.toolUses) toolNames.set(toolUse.tool_use_id, toolUse.tool)
  }

  const costs = messages.map((message) => {
    let cost = estimateTokens(message.text)
    if (message.role === 'assistant') {
      for (const toolUse of message.toolUses) cost += estimateTokens(JSON.stringify(toolUse.input))
    }
    for (const toolResult of message.toolResults ?? []) cost += estimateTokens(toolResult.text)
    return cost
  })
  const tail: number[] = new Array(messages.length)
  let after = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    tail[index] = after
    after += costs[index] ?? 0
  }

  const selected: Selected[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || message.role !== 'user' || (tail[index] ?? 0) < settings.protectTokens) continue
    if ((message.toolResults ?? []).some((result) => hasImage(result.result))) continue
    for (const result of message.toolResults ?? []) {
      const tokens = estimateTokens(result.text)
      const toolName = toolNames.get(result.tool_use_id)
      if (
        result.text.length === 0 ||
        result.isError ||
        (toolName !== undefined && settings.protectedTools.includes(toolName)) ||
        toolName === RECOVER_TOOL ||
        result.text.startsWith(PLACEHOLDER_PREFIX) ||
        tokens < settings.minResultTokens ||
        tokens <= PLACEHOLDER_TOKEN_ESTIMATE
      ) continue
      selected.push({ toolUseId: result.tool_use_id, toolName, text: result.text, tokens })
    }
  }

  const savings = selected.reduce(
    (total, result) => total + result.tokens - PLACEHOLDER_TOKEN_ESTIMATE,
    0,
  )
  return savings < settings.minSavings || selected.length === 0
    ? { selected: [], savings }
    : { selected, savings }
}

export function rebuild(
  messages: readonly SessionMessage[],
  placeholders: ReadonlyMap<string, string>,
): SessionMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !message.toolResults?.some((result) => placeholders.has(result.tool_use_id))) {
      return message
    }
    return {
      role: message.role,
      text: message.text,
      toolUses: message.toolUses,
      toolResults: message.toolResults.map((result) => {
        const placeholder = placeholders.get(result.tool_use_id)
        return placeholder === undefined
          ? result
          : { tool_use_id: result.tool_use_id, text: placeholder, isError: false }
      }),
    }
  })
}
