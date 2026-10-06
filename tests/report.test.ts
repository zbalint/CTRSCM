import { expect, test } from 'claude-code/testing'
import type { ReportEvent } from '../hooks/report'
import { reportText } from '../hooks/report'

function turn(
  at: string,
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  sessionCostUsd: number | null = null,
  contextTokens: number | null = null,
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
    contextTokens,
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
      "pass 1 at 00:00:04, saved ~15000 estimated: prompt tokens summed over each turn's responses 34810 after vs 52010 before, cache creation 30000 in the first turn after vs 900 before (3 turns before, 3 after); counts are per turn and turns differ in length",
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
  expect(text).toContain("pass 1 at 00:00:02, saved ~2 estimated: prompt tokens summed over each turn's responses 610 after vs 410 before, cache creation 300 in the first turn after vs 200 before (1 turns before, 1 after)")
  expect(text).toContain('skipped 2 unreadable files')
  expect(text).toContain('list-price cost this session: unknown')
  expect(reportText([shake('2026-10-06T00:00:00.000Z')], 's-1', 0, null)).toContain(
    "prompt tokens summed over each turn's responses n/a after vs n/a before, cache creation n/a in the first turn after vs n/a before (0 turns before, 0 after)",
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
  expect(text).toContain("pass 1 at 00:00:01, saved ~1 estimated: prompt tokens summed over each turn's responses 222 after vs 111 before, cache creation 20 in the first turn after vs 10 before (1 turns before, 1 after)")
  expect(text).toContain("pass 2 at 00:00:03, saved ~2 estimated: prompt tokens summed over each turn's responses 333 after vs 222 before, cache creation 30 in the first turn after vs 20 before (1 turns before, 1 after)")
})

test('reportText measures context saving and cache pay-back independently of response sums', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 2000, 450000, null, 150000),
    turn('2026-10-06T00:00:02.000Z', 10, 3000, 600000, null, 160000),
    turn('2026-10-06T00:00:03.000Z', 10, 4000, 510000, null, 170000),
    shake('2026-10-06T00:00:04.000Z'),
    turn('2026-10-06T00:00:05.000Z', 10, 90000, 330000, null, 110000),
    turn('2026-10-06T00:00:06.000Z', 10, 2000, 115000, null, 115000),
    turn('2026-10-06T00:00:07.000Z', 10, 2000, 360000, null, 120000),
  ]
  expect(reportText(events, 's-1', 0, null).split('\n')[3]).toBe(
    '  measured: context ~45000 tokens lower (median 160000 before, 115000 after); first turn after wrote ~87000 more cache tokens than usual; pays back in ~37 later turns at assumed list-price ratios (cache write 2x, cache read 0.1x)',
  )
})

test('reportText reports when measured context does not drop', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 1000, 1000, null, 150000),
    turn('2026-10-06T00:00:02.000Z', 10, 1000, 1000, null, 160000),
    turn('2026-10-06T00:00:03.000Z', 10, 1000, 1000, null, 170000),
    shake('2026-10-06T00:00:04.000Z'),
    turn('2026-10-06T00:00:05.000Z', 10, 1000, 1000, null, 160000),
    turn('2026-10-06T00:00:06.000Z', 10, 1000, 1000, null, 165000),
    turn('2026-10-06T00:00:07.000Z', 10, 1000, 1000, null, 170000),
  ]
  expect(reportText(events, 's-1', 0, null)).toContain(
    'measured: no drop in context (median 160000 before, 165000 after)',
  )
})

test('reportText omits the pay-back when the first turn has no extra cache write', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 2000, 1000, null, 150000),
    turn('2026-10-06T00:00:02.000Z', 10, 3000, 1000, null, 160000),
    turn('2026-10-06T00:00:03.000Z', 10, 4000, 1000, null, 170000),
    shake('2026-10-06T00:00:04.000Z'),
    turn('2026-10-06T00:00:05.000Z', 10, 3000, 1000, null, 110000),
    turn('2026-10-06T00:00:06.000Z', 10, 2000, 1000, null, 115000),
    turn('2026-10-06T00:00:07.000Z', 10, 2000, 1000, null, 120000),
  ]
  expect(reportText(events, 's-1', 0, null)).toContain(
    'measured: context ~45000 tokens lower (median 160000 before, 115000 after); no extra cache write in the first turn after',
  )
})

test('reportText omits measured context with fewer than two after samples', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 1000, 1000, null, 150000),
    shake('2026-10-06T00:00:02.000Z'),
    turn('2026-10-06T00:00:03.000Z', 10, 90000, 1000, null, 100000),
    turn('2026-10-06T00:00:04.000Z', 10, 1000, 1000),
  ]
  expect(reportText(events, 's-1', 0, null)).not.toContain('measured:')
})

test('reportText gives each pass its own measured context window', () => {
  const events: ReportEvent[] = [
    turn('2026-10-06T00:00:01.000Z', 10, 1000, 1000, null, 150000),
    shake('2026-10-06T00:00:02.000Z'),
    turn('2026-10-06T00:00:03.000Z', 10, 90000, 1000, null, 100000),
    turn('2026-10-06T00:00:04.000Z', 10, 1000, 1000, null, 105000),
    shake('2026-10-06T00:00:05.000Z'),
    turn('2026-10-06T00:00:06.000Z', 10, 80000, 1000, null, 70000),
    turn('2026-10-06T00:00:07.000Z', 10, 1000, 1000, null, 75000),
  ]
  const text = reportText(events, 's-1', 0, null)
  expect(text).toContain('measured: context ~50000 tokens lower (median 150000 before, 100000 after)')
  expect(text).toContain('measured: context ~30000 tokens lower (median 100000 before, 70000 after)')
})
