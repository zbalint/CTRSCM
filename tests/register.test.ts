import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { isArtifactId } from '../hooks/artifacts'
import { PLACEHOLDER_PREFIX, RECOVER_TOOL } from '../hooks/shake'

const large = 'x'.repeat(80000)
const messages: SessionMessage[] = [
  { role: 'user', text: 'start', toolUses: [], toolResults: [], handle: 'm0' },
  {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' }, text: large, result: large }],
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
    toolUses: [{ tool_use_id: 'tu2', tool: 'Read', input: { file_path: '/work/a.ts' }, text: large, result: large }],
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

const twoSelectedMessages: SessionMessage[] = [
  ...messages,
  { role: 'assistant', text: large, toolUses: [] },
]
test('session start registers recovery, auto compaction writes artifacts, and recovery reads them', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const files = new Map<string, string>()
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`missing ${e.path}`)
    return { value: text }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  expect(await $.session.start({ cwd: '/work', surface: null, isInteractive: false })).toEqual({ cwd: '/work' })
  const compacted = await $.session.compact({ trigger: 'auto', messages } as never)
  expect(compacted).toHaveProperty('messages')
  if (!('messages' in compacted) || compacted.messages === undefined) {
    throw new Error('expected a rewritten transcript')
  }
  const compactedMessages = compacted.messages
  expect(compactedMessages).toHaveLength(messages.length)
  expect(compactedMessages[0]).toEqual(messages[0])
  expect(compactedMessages[1]).toEqual(messages[1])
  expect(compactedMessages[3]).toEqual(messages[3])
  expect(compactedMessages[2]).toEqual({
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{
      tool_use_id: 'tu1',
      text: expect.stringContaining(PLACEHOLDER_PREFIX),
      isError: false,
    }],
  })
  const chunkPath = writes[0]?.path
  const manifestPath = writes[1]?.path
  if (chunkPath === undefined || manifestPath === undefined) throw new Error('missing artifact writes')
  const artifactId = manifestPath.split('/').at(-2)
  if (artifactId === undefined || !isArtifactId(artifactId)) throw new Error('invalid artifact id')
  expect(chunkPath).toBe(`/home/example/.ctrscm/artifacts/${artifactId}/chunk-0000.txt`)
  expect(manifestPath).toBe(`/home/example/.ctrscm/artifacts/${artifactId}/manifest.json`)
  expect(writes).toHaveLength(2)
  expect(logs).toEqual(['CTRSCM: shook 1 tool results (~19960 estimated tokens)'])

  const recovered = await $.tool.call({
    tool: RECOVER_TOOL,
    tool_use_id: 'recover-call',
    id: artifactId,
    offset: 0,
    maxChars: 4,
  } as never)
  expect(recovered).toEqual({
    result: `CTRSCM artifact ${artifactId}\ntool: Bash\nrange: 0..3 of 80000 chars\nmore: true\n\nxxxx`,
  })
})

test('precompute and instructed manual compaction use their mandated paths', async ($, on) => {
  let beneath = 0
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  expect(await $.session.compact({ trigger: 'precompute', messages } as never)).toEqual({
    skip: 'ctrscm: nothing to precompute',
  })
  const manual = await $.session.compact({
    trigger: 'manual',
    instructions: 'keep the plan',
    messages,
  } as never)
  expect(manual).toEqual({ messages })
  expect(beneath).toBe(1)
})

test('failed recovery registration and artifact root use the builtin fallback', async ($, on) => {
  let beneath = 0
  const logs: string[] = []
  on('tool.register', () => {
    throw new Error('registration unavailable')
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  expect(await $.session.start({ cwd: '/work', surface: null, isInteractive: false })).toEqual({ cwd: '/work' })
  expect(await $.session.compact({ trigger: 'auto', messages } as never)).toEqual({ messages })
  expect(beneath).toBe(1)
  expect(logs).toEqual(['CTRSCM: recovery registration failed: no implementation for tool.register'])
})


test('successful registration without HOME falls back without rewriting', async ($, on) => {
  let beneath = 0
  mock.env(on, {})
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.session.compact({ trigger: 'auto', messages } as never)).toEqual({ messages })
  expect(beneath).toBe(1)
})

test('a later artifact write failure falls back after leaving only orphaned chunks', async ($, on) => {
  const writes: string[] = []
  const logs: string[] = []
  let manifestWrites = 0
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('fs.write', ($, e) => {
    writes.push(e.path)
    if (e.path.endsWith('/manifest.json')) {
      manifestWrites += 1
      if (manifestWrites === 2) throw new Error('manifest failed')
    }
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.session.compact({ trigger: 'auto', messages: twoSelectedMessages } as never)).toEqual({
    messages: twoSelectedMessages,
  })
  expect(writes).toHaveLength(4)
  expect(writes[0]).toContain('/chunk-0000.txt')
  expect(writes[1]).toContain('/manifest.json')
  expect(writes[2]).toContain('/chunk-0000.txt')
  expect(writes[3]).toContain('/manifest.json')
  expect(logs[0]).toContain('CTRSCM: artifact write failed after 1 artifacts')
})


