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
    ),
  ).toBe(
    'CTRSCM status\n' +
      'auto: on (trigger 50% or 120000 tokens, 0 = off; cooldown 3 turns)\n' +
      'advice: at 150000 tokens, 0 = off\n' +
      'shake: protect 16000, aggressive protect 4000, min savings 4000, min result 1000 (estimated tokens)\n' +
      'protected tools: Skill\n' +
      'artifacts: /home/example/.ctrscm/artifacts\n' +
      'usage log: on (/home/example/.ctrscm/artifacts/usage)\n' +
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
    ),
  ).toBe(
    'CTRSCM status\n' +
      'auto: off (trigger 50% or 120000 tokens, 0 = off; cooldown 3 turns)\n' +
      'advice: at 150000 tokens, 0 = off\n' +
      'shake: protect 16000, aggressive protect 4000, min savings 4000, min result 1000 (estimated tokens)\n' +
      'protected tools: none\n' +
      'artifacts: unavailable (no HOME)\n' +
      'usage log: on (unavailable (no HOME))\n' +
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
    ),
  ).toContain('advice: at 0 tokens, 0 = off\n')
  expect(statusText(
    { ...DEFAULT_CONFIG, adviseTokens: 0, usageLog: false },
    '/home/example/.ctrscm/artifacts/',
    { passes: 0, results: 0, savings: 0, last: 'none yet' },
    false,
  )).toContain('usage log: off (/home/example/.ctrscm/artifacts/usage)')
})
