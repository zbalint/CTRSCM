import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import {
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_TOKEN_ESTIMATE,
  RECOVER_TOOL,
  estimateTokens,
  hasImage,
  placeholderOf,
  labelOf,
  protectedFrom,
  rebuild,
  selectResults,
} from '../hooks/shake'

const settings = {
  protectTokens: 16000,
  protectTurns: 0,
  minSavings: 4000,
  minResultTokens: 200,
  protectedTools: ['Skill'],
} as const

const large = 'x'.repeat(80000)

const workedExample: SessionMessage[] = [
  { role: 'user', text: 'start', toolUses: [], toolResults: [], handle: 'm0' },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      {
        tool_use_id: 'tu1',
        tool: 'Bash',
        input: { command: 'ls' },
        text: large,
        result: large,
      },
    ],
    handle: 'm1',
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 'tu1', text: large, isError: false, result: large }],
    handle: 'm2',
  },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      {
        tool_use_id: 'tu2',
        tool: 'Read',
        input: { file_path: '/work/a.ts' },
        text: large,
        result: large,
      },
    ],
    handle: 'm3',
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 'tu2', text: large, isError: false, result: large }],
    handle: 'm4',
  },
  { role: 'assistant', text: 'done', toolUses: [], handle: 'm5' },
]

test('protectedFrom counts typed prompts from the end and protects all when history is short', () => {
  const turns: SessionMessage[] = [
    { role: 'user', text: 'a', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a-tool', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a-tool', text: 'result a', isError: false }] },
    { role: 'assistant', text: 'done a', toolUses: [] },
    { role: 'user', text: 'b', toolUses: [], toolResults: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b-tool', tool: 'Read', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b-tool', text: 'result b', isError: false }] },
    { role: 'assistant', text: 'done b', toolUses: [] },
  ]
  expect(protectedFrom(turns, 0)).toBe(8)
  expect(protectedFrom(turns, 1)).toBe(4)
  expect(protectedFrom(turns, 2)).toBe(0)
  expect(protectedFrom(turns, 3)).toBe(0)
})

test('protectTurns protects recent results while keeping earlier results eligible', () => {
  const turnMessages: SessionMessage[] = [
    { role: 'user', text: 'a', toolUses: [], toolResults: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'old', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'old', text: large, isError: false }] },
    { role: 'user', text: 'b', toolUses: [], toolResults: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'recent', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'recent', text: large, isError: false }] },
    { role: 'assistant', text: 'done', toolUses: [] },
  ]
  expect(
    selectResults(turnMessages, { ...settings, protectTokens: 0, protectTurns: 0, minSavings: 0 }),
  ).toEqual({
    selected: [
      { toolUseId: 'old', toolName: 'Bash', label: 'Bash', text: large, tokens: 20000 },
      { toolUseId: 'recent', toolName: 'Bash', label: 'Bash', text: large, tokens: 20000 },
    ],
    savings: 39920,
  })
  expect(
    selectResults(turnMessages, { ...settings, protectTokens: 0, protectTurns: 1, minSavings: 0 }),
  ).toEqual({
    selected: [{ toolUseId: 'old', toolName: 'Bash', label: 'Bash', text: large, tokens: 20000 }],
    savings: 19960,
  })
  expect(
    selectResults(turnMessages, { ...settings, protectTokens: 0, protectTurns: 1, minSavings: 20000 }),
  ).toEqual({ selected: [], savings: 19960 })
  expect(
    selectResults(turnMessages, { ...settings, protectTokens: 30000, protectTurns: 1, minSavings: 0 }),
  ).toEqual({ selected: [], savings: 0 })
})


test('protectedFrom ignores user results, whitespace-only messages, and assistant messages', () => {
  const messagesWithNoTypedPrompt: SessionMessage[] = [
    { role: 'user', text: 'not a prompt', toolUses: [], toolResults: [{ tool_use_id: 'result', text: 'x', isError: false }] },
    { role: 'user', text: '   ', toolUses: [], toolResults: [] },
    { role: 'assistant', text: 'assistant text', toolUses: [] },
  ]
  expect(protectedFrom(messagesWithNoTypedPrompt, 1)).toBe(0)
  const mixedMessages: SessionMessage[] = [
    { role: 'user', text: 'older', toolUses: [], toolResults: [] },
    { role: 'user', text: 'not a prompt', toolUses: [], toolResults: [{ tool_use_id: 'result', text: 'x', isError: false }] },
    { role: 'user', text: '   ', toolUses: [], toolResults: [] },
    { role: 'assistant', text: 'assistant text', toolUses: [] },
    { role: 'user', text: 'latest', toolUses: [], toolResults: [] },
  ]
  expect(protectedFrom(mixedMessages, 1)).toBe(4)
  expect(protectedFrom(mixedMessages, 2)).toBe(0)
})
test('estimateTokens and placeholderOf use the contract literals', () => {
  expect(estimateTokens('12345')).toBe(2)
  expect(PLACEHOLDER_PREFIX).toBe('[CTRSCM shaken tool result:')
  expect(PLACEHOLDER_TOKEN_ESTIMATE).toBe(40)
  expect(
    placeholderOf('artifact-id', 80000, 20000),
  ).toBe(
    '[CTRSCM shaken tool result: ~20000 estimated tokens (80000 chars) externalized; before quoting details, recover the full text with mcp__ctrscm__recover id="artifact-id"]',
  )
  expect(
    placeholderOf('artifact-id', 80000, 20000, 'Bash ls'),
  ).toBe(
    '[CTRSCM shaken tool result: Bash ls, ~20000 estimated tokens (80000 chars) externalized; before quoting details, recover the full text with mcp__ctrscm__recover id="artifact-id"]',
  )
})
test('labelOf uses the first cleaned input hint without throwing', () => {
  expect(labelOf('Read', { file_path: '/work/a.ts', offset: 1 })).toBe('Read /work/a.ts')
  expect(labelOf('Bash', { command: 'git log\n  --oneline  -5' })).toBe('Bash git log --oneline -5')
  expect(labelOf('mcp__x__find', { n: 3 })).toBe('mcp__x__find')
  expect(labelOf('Bash', { command: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).toBe('Bash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  expect(labelOf('Bash', { command: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).toBe('Bash aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...')
  expect(labelOf('Grep', { command: '   ', pattern: 'TODO' })).toBe('Grep TODO')
  expect(labelOf('Grep', { file_path: '/work/a.ts', command: 'ls' })).toBe('Grep /work/a.ts')
  expect(labelOf('Grep', { command: 'say "done"]' })).toBe("Grep say 'done')")
  expect(labelOf('Bash\u202e', { command: 'git\u001b log\u202e --oneline' })).toBe('Bash git log --oneline')
  expect(labelOf('Read', { input: '/work/a.ts' })).toBe('Read')
  expect(labelOf(undefined, { command: 'ls' })).toBeUndefined()
})

test('hasImage detects image blocks and conservative base64 records', () => {
  expect(hasImage({ type: 'image' })).toBe(true)
  expect(hasImage([{ nested: [{ type: 'image' }] }])).toBe(true)
  expect(hasImage({ source: { base64: undefined } })).toBe(true)
  expect(hasImage('image')).toBe(false)
  expect(hasImage({ type: 'text', source: { data: 'AAAA' } })).toBe(false)
})

test('an image-bearing user result protects its whole message', () => {
  const imageMessages: SessionMessage[] = workedExample.map((message, index) =>
    index === 2
      ? {
          ...message,
          toolResults: [
            ...(message.toolResults ?? []),
            {
              tool_use_id: 'tu3',
              text: '',
              isError: false,
              result: { type: 'image', source: { data: 'AAAA' } },
            },
          ],
        }
      : message,
  )
  expect(selectResults(imageMessages, settings)).toEqual({ selected: [], savings: 0 })
})


test('worked example selects the old Bash result and computes literal savings', () => {
  expect(selectResults(workedExample, settings)).toEqual({
    selected: [{ toolUseId: 'tu1', toolName: 'Bash', label: 'Bash ls', text: large, tokens: 20000 }],
    savings: 19960,
  })
})
test('minResultTokens includes the exact boundary and rejects one estimated token below it', () => {
  const boundaryMessages: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'exact', tool: 'Bash', input: {} }] },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: 'exact', text: 'x'.repeat(800), isError: false }],
    },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'below', tool: 'Bash', input: {} }] },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: 'below', text: 'x'.repeat(796), isError: false }],
    },
  ]
  expect(
    selectResults(boundaryMessages, {
      ...settings,
      protectTokens: 0,
      minSavings: 0,
    }),
  ).toEqual({
    selected: [{ toolUseId: 'exact', toolName: 'Bash', label: 'Bash', text: 'x'.repeat(800), tokens: 200 }],
    savings: 160,
  })
})
test('selection labels every eligible call and leaves absent calls unlabeled', () => {
  expect(selectResults(workedExample, { ...settings, protectTokens: 0 })).toEqual({
    selected: [
      { toolUseId: 'tu1', toolName: 'Bash', label: 'Bash ls', text: large, tokens: 20000 },
      { toolUseId: 'tu2', toolName: 'Read', label: 'Read /work/a.ts', text: large, tokens: 20000 },
    ],
    savings: 39920,
  })
  const missingCall: SessionMessage[] = [
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: 'missing', text: large, isError: false }],
    },
    { role: 'assistant', text: 'x'.repeat(64000), toolUses: [] },
  ]
  expect(selectResults(missingCall, { ...settings, protectTokens: 0 })).toEqual({
    selected: [{ toolUseId: 'missing', toolName: undefined, label: undefined, text: large, tokens: 20000 }],
    savings: 19960,
  })
})

test('a short tail protects every result when it is below the threshold', () => {
  const messages = workedExample.filter((_, index) => index !== 3 && index !== 4)
  expect(selectResults(messages, settings)).toEqual({ selected: [], savings: 0 })
})

test('answered-call views do not inflate tail cost', () => {
  const messages: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'tu1', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'tu1', text: large, isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'tu2', tool: 'Read', input: {}, text: large, result: large }] },
  ]
  expect(selectResults(messages, settings)).toEqual({ selected: [], savings: 0 })
})

test('eligible savings below the configured threshold are discarded', () => {
  expect(selectResults(workedExample, { ...settings, minSavings: 20000 })).toEqual({
    selected: [],
    savings: 19960,
  })
})

test('errors, protected tools, recovery, placeholders and short results are excluded', () => {
  const messages: SessionMessage[] = [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'error', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'error', text: large, isError: true }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'skill', tool: 'Skill', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'skill', text: large, isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'recover', tool: RECOVER_TOOL, input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'recover', text: large, isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'placeholder', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'placeholder', text: `${PLACEHOLDER_PREFIX} already`, isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'short', tool: 'Bash', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'short', text: 'x'.repeat(796), isError: false }] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'unknown', tool: 'Unknown', input: {} }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'unknown', text: large, isError: false }] },
    { role: 'assistant', text: 'x'.repeat(64000), toolUses: [] },
  ]
  expect(selectResults(messages, settings)).toEqual({ selected: [{ toolUseId: 'unknown', toolName: 'Unknown', label: 'Unknown', text: large, tokens: 20000 }], savings: 19960 })
})

test('rebuild only changes user messages containing selected results', () => {
  const replacement = placeholderOf('artifact-id', 80000, 20000)
  const assistant = workedExample[1]
  const untouched = workedExample[0]
  const rebuilt = rebuild(workedExample, new Map([['tu1', replacement]]))
  expect(rebuilt).toHaveLength(workedExample.length)
  expect(rebuilt[0]).toBe(untouched)
  expect(rebuilt[1]).toBe(assistant)
  expect(rebuilt[2]).toEqual({
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 'tu1', text: replacement, isError: false }],
  })
  expect(rebuilt[2]).not.toHaveProperty('handle')
  expect(rebuilt[2]?.toolResults?.[0]).not.toHaveProperty('result')
  expect(rebuilt[4]).toBe(workedExample[4])
})
