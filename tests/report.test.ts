import { expect, test } from 'claude-code/testing'
import type { ReportEvent } from '../hooks/report'
import { reportText } from '../hooks/report'

function turn(
  at: string,
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  sessionCostUsd: number | null = null,
): ReportEvent {
  return {
    version: 1,
    at,
    sessionId: 's-1',
    agentId: null,
    event: 'turn',
    reason: 'answer',
    model: 'model-a',
    inputTokens,
    outputTokens: 100,
    cacheCreationTokens,
    cacheReadTokens,
    contextTokens: null,
    contextPercent: null,
    sessionCostUsd,
  }
}

function shake(at: string, outcome: 'shook' | 'fallback' = 'shook', estimatedSavings = 15000): ReportEvent {
  return {
    version: 1,
    at,
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome,
    reason: null,
    results: 0,
    chars: 0,
    estimatedSavings,
    artifactIds: [],
    contextTokens: null,
    contextPercent: null,
    adviseTokens: null,
  }
}

test('reportText reproduces the prompt and cache-creation worked example', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 800, 50000),
    turn('2026-10-06T00:00:02.000Z', 10, 900, 52000),
    turn('2026-10-06T00:00:03.000Z', 10, 1000, 51000),
    shake('2026-10-06T00:00:04.000Z'),
    turn('2026-10-06T00:00:05.000Z', 10, 30000, 5000),
    turn('2026-10-06T00:00:06.000Z', 10, 900, 33000),
    turn('2026-10-06T00:00:07.000Z', 10, 800, 34000),
  ]
  expect(reportText(events, 's-1', 0, null)).toBe(
    [
      'CTRSCM report, session s-1: 6 turn events, 1 shook passes',
      'totals, main loop: 6 turns, 600 output tokens, 34400 cache creation tokens, 225000 cache read tokens',
      'pass 1 at 00:00:04, saved ~15000 estimated: prompt per turn 34810 after vs 52010 before, cache creation 30000 in the first turn after vs 900 before (3 turns before, 3 after); counts are per turn and turns differ in length',
      'list-price cost this session: unknown',
    ].join('\n'),
  )
})
test('reportText bounds passes, uses n/a for missing windows, filters sessions and subagents', () => {
  const events: ReportEvent[] = [
    shake('2026-10-06T00:00:01.000Z', 'fallback', 1),
    turn('2026-10-06T00:00:01.000Z', 10, 100, 100),
    turn('2026-10-06T00:00:02.000Z', 10, 200, 200),
    shake('2026-10-06T00:00:02.000Z', 'shook', 2),
    turn('2026-10-06T00:00:03.000Z', 10, 300, 300),
    {
      ...turn('2026-10-06T00:00:04.000Z', 10, 400, 400),
      agentId: 'subagent-1',
    },
    {
      ...turn('2026-10-06T00:00:05.000Z', 10, 500, 500),
      sessionId: 's-2',
    },
  ]
  const text = reportText(events, 's-1', 2, null)
  expect(text).toContain('CTRSCM report, session s-1: 4 turn events, 1 shook passes')
  expect(text).toContain('pass 1 at 00:00:02, saved ~2 estimated: prompt per turn 610 after vs 410 before, cache creation 300 in the first turn after vs 200 before (1 turns before, 1 after)')
  expect(text).toContain('skipped 2 unreadable files')
  expect(text).toContain('list-price cost this session: unknown')
  expect(reportText([shake('2026-10-06T00:00:00.000Z')], 's-1', 0, null)).toContain(
    'prompt per turn n/a after vs n/a before, cache creation n/a in the first turn after vs n/a before (0 turns before, 0 after)',
  )
})
test('reportText reports a rounded live cost difference when two readings exist', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 100, 100, 0.2),
    turn('2026-10-06T00:00:02.000Z', 10, 100, 100, 0.5),
  ]
  expect(reportText(events, 's-1', 0, 0.75)).toContain('list-price cost this session: ~$0.55')
})

test('reportText uses neighboring shook passes to bound each pass window', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:00.000Z', 1, 10, 100),
    shake('2026-10-06T00:00:01.000Z', 'shook', 1),
    turn('2026-10-06T00:00:02.000Z', 2, 20, 200),
    shake('2026-10-06T00:00:03.000Z', 'shook', 2),
    turn('2026-10-06T00:00:04.000Z', 3, 30, 300),
  ]
  const text = reportText(events, 's-1', 0, null)
  expect(text).toContain('CTRSCM report, session s-1: 3 turn events, 2 shook passes')
  expect(text).toContain('pass 1 at 00:00:01, saved ~1 estimated: prompt per turn 222 after vs 111 before, cache creation 20 in the first turn after vs 10 before (1 turns before, 1 after)')
  expect(text).toContain('pass 2 at 00:00:03, saved ~2 estimated: prompt per turn 333 after vs 222 before, cache creation 30 in the first turn after vs 20 before (1 turns before, 1 after)')
})
