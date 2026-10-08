import { expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG } from '../hooks/config'
import { statusText } from '../hooks/status'

test('statusText renders the complete active status block', () => {
  expect(
    statusText(
      DEFAULT_CONFIG,
      '/home/example/.ctrscm/artifacts',
      { passes: 2, results: 3, savings: 12000, last: 'proactive shook 2 results (~8000 estimated tokens)' },
      true,
      { passed: 0, fromFile: 0, path: undefined },
      { kind: 'ok', window: 200000, tokens: 50000, percent: 25, autoCompact: { isEnabled: true, threshold: 100000 } },
    ),
  ).toBe(
    'CTRSCM status\n' +
      'auto: on (trigger 50% or 120000 tokens, 0 = off; cooldown 3 turns)\n' +
      'advice: at 150000 tokens, 0 = off\n' +
      'idle shake: after 0 min idle, 0 = off\n' +
      'context: 50000 tokens (25% of 200000)\n' +
      'engine compaction: auto at 100000 tokens\n' +
      'note: trigger tokens (120000) are at or above the engine threshold (100000); the engine may compact first\n' +
      'shake: protect 16000, aggressive protect 4000, min savings 4000, min result 1000 (estimated tokens)\n' +
      'protected tools: Skill\n' +
      'artifacts: /home/example/.ctrscm/artifacts\n' +
      'usage log: on (/home/example/.ctrscm/artifacts/usage)\n' +
      'options: 0 passed, 0 from file, 14 default\n' +
      'config file: none\n' +
      'this session: 2 passes, 3 results shaken, ~12000 estimated tokens saved\n' +
      'last: proactive shook 2 results (~8000 estimated tokens)\n' +
      'pending: aggressive shake',
  )
})

test('statusText renders unavailable and disabled settings', () => {
  expect(
    statusText(
      { ...DEFAULT_CONFIG, autoShake: false, protectedTools: [] },
      undefined,
      { passes: 0, results: 0, savings: 0, last: 'none yet' },
      false,
      { passed: 0, fromFile: 0, path: undefined },
      { kind: 'unavailable', reason: 'usage unavailable' },
    ),
  ).toBe(
    'CTRSCM status\n' +
      'auto: off (trigger 50% or 120000 tokens, 0 = off; cooldown 3 turns)\n' +
      'advice: at 150000 tokens, 0 = off\n' +
      'idle shake: after 0 min idle, 0 = off\n' +
      'context: unavailable (usage unavailable)\n' +
      'engine compaction: unavailable\n' +
      'shake: protect 16000, aggressive protect 4000, min savings 4000, min result 1000 (estimated tokens)\n' +
      'protected tools: none\n' +
      'artifacts: unavailable (no HOME)\n' +
      'usage log: on (unavailable (no HOME))\n' +
      'options: 0 passed, 0 from file, 14 default\n' +
      'config file: none\n' +
      'this session: 0 passes, 0 results shaken, ~0 estimated tokens saved\n' +
      'last: none yet\n' +
      'pending: none',
  )
})

test('statusText renders disabled advice and usage logging', () => {
  expect(
    statusText(
      { ...DEFAULT_CONFIG, adviseTokens: 0, usageLog: false },
      '/home/example/.ctrscm/artifacts/',
      { passes: 0, results: 0, savings: 0, last: 'none yet' },
      false,
      { passed: 0, fromFile: 0, path: '/home/example/.ctrscm/config.json' },
      { kind: 'unavailable', reason: 'usage unavailable' },
    ),
  ).toContain('advice: at 0 tokens, 0 = off\n')
  expect(statusText(
    { ...DEFAULT_CONFIG, adviseTokens: 0, usageLog: false },
    '/home/example/.ctrscm/artifacts/',
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: '/home/example/.ctrscm/config.json' },
    { kind: 'unavailable', reason: 'usage unavailable' },
  )).toContain('usage log: off (/home/example/.ctrscm/artifacts/usage)')
})

test('statusText shows measured context against the model window', () => {
  expect(statusText(
    DEFAULT_CONFIG,
    '/work/artifacts',
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, tokens: 50000, percent: 25 },
  )).toContain('context: 50000 tokens (25% of 200000)\n')
})

test('statusText renders context without a percent', () => {
  expect(statusText(
    DEFAULT_CONFIG,
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, tokens: 50000 },
  )).toContain('context: 50000 tokens (window 200000)\n')
})

test('statusText renders context before the first measurement', () => {
  expect(statusText(
    DEFAULT_CONFIG,
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000 },
  )).toContain('context: not measured yet (window 200000)\n')
})

test('statusText renders disabled engine compaction', () => {
  expect(statusText(
    DEFAULT_CONFIG,
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, autoCompact: { isEnabled: false, threshold: 100000 } },
  )).toContain('engine compaction: auto off\n')
})

test('statusText renders unknown engine compaction without a breakdown', () => {
  expect(statusText(
    DEFAULT_CONFIG,
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000 },
  )).toContain('engine compaction: unknown\n')
})

test('statusText renders unknown engine compaction without a threshold', () => {
  expect(statusText(
    DEFAULT_CONFIG,
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, autoCompact: { isEnabled: true } },
  )).toContain('engine compaction: unknown\n')
})

test('statusText shows the engine-threshold note at equality', () => {
  expect(statusText(
    { ...DEFAULT_CONFIG, triggerTokens: 100000 },
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, autoCompact: { isEnabled: true, threshold: 100000 } },
  )).toContain(
    'note: trigger tokens (100000) are at or above the engine threshold (100000); the engine may compact first',
  )
})

test('statusText hides the engine-threshold note when it is not applicable', () => {
  expect(statusText(
    { ...DEFAULT_CONFIG, triggerTokens: 99999 },
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, autoCompact: { isEnabled: true, threshold: 100000 } },
  )).not.toContain('note:')
  expect(statusText(
    { ...DEFAULT_CONFIG, triggerTokens: 0 },
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, autoCompact: { isEnabled: true, threshold: 100000 } },
  )).not.toContain('note:')
  expect(statusText(
    DEFAULT_CONFIG,
    undefined,
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
    { passed: 0, fromFile: 0, path: undefined },
    { kind: 'ok', window: 200000, autoCompact: { isEnabled: true } },
  )).not.toContain('note:')
})
