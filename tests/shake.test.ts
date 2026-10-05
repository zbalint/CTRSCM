import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import {
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_TOKEN_ESTIMATE,
  RECOVER_TOOL,
  estimateTokens,
  hasImage,
  placeholderOf,
  rebuild,
  selectResults,
} from '../hooks/shake'

const settings = {
  protectTokens: 16000,
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

test('estimateTokens and placeholderOf use the contract literals', () => {
  expect(estimateTokens('12345')).toBe(2)
  expect(PLACEHOLDER_PREFIX).toBe('[CTRSCM shaken tool result:')
  expect(PLACEHOLDER_TOKEN_ESTIMATE).toBe(40)
  expect(
    placeholderOf('artifact-id', 80000, 20000),
  ).toBe(
    '[CTRSCM shaken tool result: ~20000 estimated tokens (80000 chars) externalized; recover with mcp__ctrscm__recover id="artifact-id"]',
  )
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
    selected: [{ toolUseId: 'tu1', toolName: 'Bash', text: large, tokens: 20000 }],
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
  expect(selectResults(messages, settings)).toEqual({ selected: [{ toolUseId: 'unknown', toolName: 'Unknown', text: large, tokens: 20000 }], savings: 19960 })
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
