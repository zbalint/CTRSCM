import { expect, test } from 'claude-code/testing'
import type { FsEntry } from 'claude-code'
import type { TurnUsageEvent, UsageEvent } from '../hooks/usage'
import { readUsageEvents } from '../hooks/usageLog'

test('readUsageEvents keeps session JSON events in listed order and counts unreadable files', async () => {
  const shake: UsageEvent = {
    version: 1,
    at: '2026-10-06T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome: 'shook',
    reason: null,
    results: 1,
    chars: 80000,
    estimatedSavings: 19960,
    artifactIds: ['a-1'],
    contextTokens: null,
    contextPercent: null,
    adviseTokens: null,
  }
  const turn: TurnUsageEvent = {
    version: 1,
    at: '2026-10-06T00:00:01.000Z',
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
  const other: UsageEvent = { ...shake, sessionId: 's-2' }
  const files: Record<string, string> = {
    '/root/artifacts/usage/01.json': JSON.stringify(shake),
    '/root/artifacts/usage/02.json': JSON.stringify(other),
    '/root/artifacts/usage/03.json': JSON.stringify(turn),
    '/root/artifacts/usage/04.json': '{bad json',
  }
  const entries: FsEntry[] = [
    { name: '01.json', kind: 'file', size: 1, isLink: false },
    { name: '02.json', kind: 'file', size: 1, isLink: false },
    { name: '03.json', kind: 'file', size: 1, isLink: false },
    { name: '04.json', kind: 'file', size: 1, isLink: false },
    { name: 'notes.txt', kind: 'file', size: 1, isLink: false },
  ]
  const result = await readUsageEvents(
    {
      list: async () => entries,
      read: async (path) => {
        const text = files[path]
        if (text === undefined) throw new Error('missing')
        return text
      },
    },
    '/root/artifacts',
    's-1',
  )
  expect(result).toEqual({ events: [shake, turn], skipped: 1 })
})

test('readUsageEvents ignores unknown event kinds without counting them as skipped', async () => {
  const files: FsEntry[] = [{ name: 'unknown.json', kind: 'file', size: 1, isLink: false }]
  const result = await readUsageEvents(
    {
      list: async () => files,
      read: async () => JSON.stringify({ version: 1, sessionId: 's-1', event: 'future' }),
    },
    '/root/artifacts',
    's-1',
  )
  expect(result).toEqual({ events: [], skipped: 0 })
})
