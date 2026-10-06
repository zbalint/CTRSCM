import type { TurnUsageEvent, UsageEvent } from './usage'

export type ReportEvent = UsageEvent | TurnUsageEvent

// shortcut: fixed ratios are not read from the engine; upgrade when the engine exposes the model's rates, or if the owner's sessions use the 5-minute cache (write 125). Cache writes are 1.25x (5 minutes) or 2x (1 hour) of base input on every model, but the read ratio is per model (0.1x for Sonnet 5.5, Sonnet 5, Opus 5 and Haiku 4.5; 0.05x for Opus 5.5; 0.025x for Fable 5.1 and Mythos 5.1, per the prompt-caching pricing page on 2026-10-06), so on the cheaper-read models the pay-back is too short; upgrade to a per-model read ratio keyed on the turn event's model if the owner mostly uses them.
const CACHE_WRITE_RATIO = 200
const CACHE_READ_RATIO = 10

type OrderedEvent = {
  event: ReportEvent
  index: number
}

type CompleteTurnEvent = TurnUsageEvent & {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

type CostTurnEvent = TurnUsageEvent & {
  sessionCostUsd: number
}

type OrderedCompleteTurn = OrderedEvent & { event: CompleteTurnEvent }
type OrderedCostTurn = OrderedEvent & { event: CostTurnEvent }
type OrderedUsageEvent = OrderedEvent & { event: UsageEvent }

type EventWithTurn = OrderedEvent & { event: TurnUsageEvent }

function isTurn(event: ReportEvent): event is TurnUsageEvent {
  return event.event === 'turn'
}

function isTurnEntry(entry: OrderedEvent): entry is EventWithTurn {
  return isTurn(entry.event)
}

function isCompleteTurn(event: ReportEvent): event is CompleteTurnEvent {
  return (
    isTurn(event) &&
    event.agentId === null &&
    event.inputTokens !== null &&
    event.outputTokens !== null &&
    event.cacheCreationTokens !== null &&
    event.cacheReadTokens !== null
  )
}

function isCompleteTurnEntry(entry: OrderedEvent): entry is OrderedCompleteTurn {
  return isCompleteTurn(entry.event)
}

function isCostTurnEntry(entry: OrderedEvent): entry is OrderedCostTurn {
  return isTurn(entry.event) && entry.event.sessionCostUsd !== null
}

function isBoundaryPass(event: ReportEvent): event is UsageEvent {
  return event.event === 'shake' && (event.outcome === 'shook' || event.outcome === 'fallback')
}

function isBoundaryEntry(entry: OrderedEvent): entry is OrderedUsageEvent {
  return isBoundaryPass(entry.event)
}

function isShookEntry(entry: OrderedEvent): entry is OrderedUsageEvent {
  return entry.event.event === 'shake' && entry.event.outcome === 'shook'
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = values.slice().sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function promptOf(event: CompleteTurnEvent): number {
  return event.inputTokens + event.cacheCreationTokens + event.cacheReadTokens
}

function timeOf(at: string): string {
  const date = new Date(at)
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(11, 19)
  return at.slice(11, 19) || at
}

function figure(value: number | undefined): string {
  return value === undefined ? 'n/a' : String(value)
}

function passLine(
  passNumber: number,
  pass: OrderedUsageEvent,
  previous: OrderedUsageEvent | undefined,
  next: OrderedUsageEvent | undefined,
  turns: OrderedCompleteTurn[],
): string[] {
  const before = turns
    .filter(({ event }) => {
      if (previous !== undefined && event.at <= previous.event.at) return false
      return event.at <= pass.event.at
    })
    .slice(-3)
  const after = turns
    .filter(({ event }) => {
      if (event.at <= pass.event.at) return false
      return next === undefined || event.at <= next.event.at
    })
    .slice(0, 3)
  const beforePrompts = before.map(({ event }) => promptOf(event))
  const afterPrompts = after.map(({ event }) => promptOf(event))
  const beforeCreation = before.map(({ event }) => event.cacheCreationTokens)
  const firstAfterCreation = after[0]?.event.cacheCreationTokens
  const line = `pass ${passNumber} at ${timeOf(pass.event.at)}, saved ~${pass.event.estimatedSavings} estimated: prompt tokens summed over each turn's responses ${figure(median(afterPrompts))} after vs ${figure(median(beforePrompts))} before, cache creation ${figure(firstAfterCreation)} in the first turn after vs ${figure(median(beforeCreation))} before (${before.length} turns before, ${after.length} after); counts are per turn and turns differ in length`
  // contextTokens lags the final response; require at least one before and two after numeric samples so the lower-middle median absorbs one stale after value.
  const beforeContext = before
    .map(({ event }) => event.contextTokens)
    .filter((tokens): tokens is number => typeof tokens === 'number')
  const afterContext = after
    .map(({ event }) => event.contextTokens)
    .filter((tokens): tokens is number => typeof tokens === 'number')
  if (beforeContext.length < 1 || afterContext.length < 2) return [line]
  const medianBefore = median(beforeContext)
  const medianAfter = median(afterContext)
  if (medianBefore === undefined || medianAfter === undefined) return [line]
  const saved = medianBefore - medianAfter
  if (saved <= 0) {
    return [line, `  measured: no drop in context (median ${medianBefore} before, ${medianAfter} after)`]
  }
  const medianBeforeCreation = median(beforeCreation)
  if (firstAfterCreation === undefined || medianBeforeCreation === undefined) return [line]
  const extra = firstAfterCreation - medianBeforeCreation
  if (extra <= 0) {
    return [
      line,
      `  measured: context ~${saved} tokens lower (median ${medianBefore} before, ${medianAfter} after); no extra cache write in the first turn after`,
    ]
  }
  // shortcut: later turns are assumed to hit the cache; if it expires between turns, both arms rewrite and a pass pays back immediately.
  const numerator = extra * (CACHE_WRITE_RATIO - CACHE_READ_RATIO)
  const denominator = saved * CACHE_READ_RATIO
  const turnsToPayBack = Math.floor((numerator + denominator - 1) / denominator)
  return [
    line,
    `  measured: context ~${saved} tokens lower (median ${medianBefore} before, ${medianAfter} after); first turn after wrote ~${extra} more cache tokens than usual; pays back in ~${turnsToPayBack} later turns at assumed list-price ratios (cache write ${CACHE_WRITE_RATIO / 100}x, cache read ${CACHE_READ_RATIO / 100}x)`,
  ]
}

function costLine(events: OrderedEvent[], latestCostUsd: number | null): string {
  const readings = events.filter(isCostTurnEntry)
  const first = readings[0]?.event
  if (first === undefined) return 'list-price cost this session: unknown'
  let latest: number | null = latestCostUsd
  if (latest === null) {
    const last = readings.at(-1)?.event
    latest = last?.sessionCostUsd ?? null
    if (readings.length < 2 || latest === null) return 'list-price cost this session: unknown'
  }
  const difference = Math.round((latest - first.sessionCostUsd) * 10000) / 10000
  return `list-price cost this session: ~$${difference}`
}

export function reportText(
  events: ReportEvent[],
  sessionId: string,
  skipped: number,
  latestCostUsd: number | null,
): string {
  const ordered = events
    .filter((event) => event.sessionId === sessionId)
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.at.localeCompare(right.event.at) || left.index - right.index)
  const turns = ordered.filter(isTurnEntry)
  const shookPasses = ordered.filter(isShookEntry)
  const completeTurns = ordered.filter(isCompleteTurnEntry)
  const outputTokens = completeTurns.reduce((total, { event }) => total + event.outputTokens, 0)
  const cacheCreationTokens = completeTurns.reduce((total, { event }) => total + event.cacheCreationTokens, 0)
  const cacheReadTokens = completeTurns.reduce((total, { event }) => total + event.cacheReadTokens, 0)
  const lines = [
    `CTRSCM report, session ${sessionId.slice(0, 8)}: ${turns.length} turn events, ${shookPasses.length} shook passes`,
    `totals, main loop: ${completeTurns.length} turns, ${outputTokens} output tokens, ${cacheCreationTokens} cache creation tokens, ${cacheReadTokens} cache read tokens`,
  ]
  for (let index = 0; index < shookPasses.length; index += 1) {
    const pass = shookPasses[index]
    if (pass === undefined) continue
    const orderedIndex = ordered.indexOf(pass)
    const previous = ordered.slice(0, orderedIndex).reverse().find(isBoundaryEntry)
    const next = ordered.slice(orderedIndex + 1).find(isBoundaryEntry)
    lines.push(...passLine(index + 1, pass, previous, next, completeTurns))
  }
  if (skipped > 0) lines.push(`skipped ${skipped} unreadable files`)
  lines.push(costLine(ordered, latestCostUsd))
  return lines.join('\n')
}
