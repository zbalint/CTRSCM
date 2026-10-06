import type { FsEntry } from 'claude-code'
import type { TurnUsageEvent, UsageEvent } from './usage'

export type UsageLogFs = {
  list: (path: string) => Promise<FsEntry[]>
  read: (path: string) => Promise<string>
}

export type UsageLogEvent = UsageEvent | TurnUsageEvent

function property(value: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(value, name)?.value
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function parseUsageEvent(value: object, event: 'shake' | 'advice'): UsageEvent | undefined {
  const artifactIdsValue = property(value, 'artifactIds')
  if (!Array.isArray(artifactIdsValue)) return undefined
  const artifactIds: string[] = []
  for (const artifactId of artifactIdsValue) {
    if (typeof artifactId !== 'string') return undefined
    artifactIds.push(artifactId)
  }
  const version = property(value, 'version')
  const at = property(value, 'at')
  const sessionId = property(value, 'sessionId')
  const agentId = property(value, 'agentId')
  const label = property(value, 'label')
  const outcome = property(value, 'outcome')
  const reason = property(value, 'reason')
  const results = property(value, 'results')
  const chars = property(value, 'chars')
  const estimatedSavings = property(value, 'estimatedSavings')
  const contextTokens = property(value, 'contextTokens')
  const contextPercent = property(value, 'contextPercent')
  const adviseTokens = property(value, 'adviseTokens')
  if (
    version !== 1 ||
    typeof at !== 'string' ||
    !nullableString(sessionId) ||
    !nullableString(agentId) ||
    !nullableString(label) ||
    (outcome !== 'shook' && outcome !== 'skipped' && outcome !== 'fallback' && outcome !== 'failed' && outcome !== null) ||
    !nullableString(reason) ||
    typeof results !== 'number' ||
    !Number.isFinite(results) ||
    typeof chars !== 'number' ||
    !Number.isFinite(chars) ||
    typeof estimatedSavings !== 'number' ||
    !Number.isFinite(estimatedSavings) ||
    !nullableNumber(contextTokens) ||
    !nullableNumber(contextPercent) ||
    !nullableNumber(adviseTokens)
  ) return undefined
  return {
    version: 1,
    at,
    sessionId,
    agentId,
    event,
    label,
    outcome,
    reason,
    results,
    chars,
    estimatedSavings,
    artifactIds,
    contextTokens,
    contextPercent,
    adviseTokens,
  }
}

function parseTurnEvent(value: object): TurnUsageEvent | undefined {
  const version = property(value, 'version')
  const at = property(value, 'at')
  const sessionId = property(value, 'sessionId')
  const agentId = property(value, 'agentId')
  const reason = property(value, 'reason')
  const model = property(value, 'model')
  const inputTokens = property(value, 'inputTokens')
  const outputTokens = property(value, 'outputTokens')
  const cacheCreationTokens = property(value, 'cacheCreationTokens')
  const cacheReadTokens = property(value, 'cacheReadTokens')
  const contextTokens = property(value, 'contextTokens')
  const contextPercent = property(value, 'contextPercent')
  const sessionCostUsd = property(value, 'sessionCostUsd')
  if (
    version !== 1 ||
    typeof at !== 'string' ||
    !nullableString(sessionId) ||
    !nullableString(agentId) ||
    typeof reason !== 'string' ||
    !nullableString(model) ||
    !nullableNumber(inputTokens) ||
    !nullableNumber(outputTokens) ||
    !nullableNumber(cacheCreationTokens) ||
    !nullableNumber(cacheReadTokens) ||
    !nullableNumber(contextTokens) ||
    !nullableNumber(contextPercent) ||
    !nullableNumber(sessionCostUsd)
  ) return undefined
  return {
    version: 1,
    at,
    sessionId,
    agentId,
    event: 'turn',
    reason,
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    contextTokens,
    contextPercent,
    sessionCostUsd,
  }
}

function parseEvent(value: unknown): UsageLogEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const event = property(value, 'event')
  if (event === 'shake') return parseUsageEvent(value, 'shake')
  if (event === 'advice') return parseUsageEvent(value, 'advice')
  if (event === 'turn') return parseTurnEvent(value)
  return undefined
}

// shortcut: one file per turn, the whole usage directory (every session) is read on each report; move to one append file per session, or a start stamp, when it passes a few thousand files.
export async function readUsageEvents(
  fs: UsageLogFs,
  root: string,
  sessionId: string,
): Promise<{ events: UsageLogEvent[]; skipped: number }> {
  const cleanRoot = root.replace(/\/+$/, '')
  const entries = await fs.list(`${cleanRoot}/usage`)
  const events: UsageLogEvent[] = []
  let skipped = 0
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.read(`${cleanRoot}/usage/${entry.name}`))
    } catch {
      skipped += 1
      continue
    }
    const eventKind = typeof parsed === 'object' && parsed !== null ? property(parsed, 'event') : undefined
    if (eventKind !== 'shake' && eventKind !== 'advice' && eventKind !== 'turn') continue
    const event = parseEvent(parsed)
    if (event === undefined) {
      skipped += 1
      continue
    }
    if (event.sessionId === sessionId) events.push(event)
  }
  return { events, skipped }
}
