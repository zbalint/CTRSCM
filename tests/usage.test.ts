import { expect, test } from 'claude-code/testing'
import { usageEventPath, type TurnUsageEvent } from '../hooks/usage'

test('usageEventPath strips the artifact root slash and stamps the event filename', () => {
  expect(
    usageEventPath(
      '/home/example/.ctrscm/artifacts/',
      '2026-10-05T00:00:00.000Z',
      'u-1',
    ),
  ).toBe(
    '/home/example/.ctrscm/artifacts/usage/2026-10-05T00-00-00-000Z-u-1.json',
  )
})

test('turn usage events use the shared timestamped event path', () => {
  const event: TurnUsageEvent = {
    version: 1,
    at: '2026-10-06T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'turn',
    reason: 'answer',
    model: 'model-a',
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 30,
    cacheReadTokens: 40,
    contextTokens: 80,
    contextPercent: 1,
    sessionCostUsd: 0.5,
  }
  expect(usageEventPath('/work/artifacts', event.at, 'u-2')).toBe(
    '/work/artifacts/usage/2026-10-06T00-00-00-000Z-u-2.json',
  )
})
