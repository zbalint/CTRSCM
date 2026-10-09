import { expect, mock, test, type Engine, type Plugin } from 'claude-code/testing'
import type { ClassicEventOf, On, SessionMeasureInput, SessionMessage, SessionUsage, TurnCompleteInput } from 'claude-code'
import { isArtifactId } from '../hooks/artifacts'
import { PLACEHOLDER_PREFIX, RECOVER_TOOL } from '../hooks/shake'
import { AGGRESSIVE_MARK, PROACTIVE_MARK } from '../hooks/trigger'
import { commandRunInput } from './fixtures/commandRunInput'
import { usageEventPath } from '../hooks/usage'
import { classicSessionStart } from './fixtures/classicSessionStart'
import { promptEdit } from './fixtures/promptEdit'
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
const protectTurnMessages: SessionMessage[] = [
  { role: 'user', text: 'first', toolUses: [], toolResults: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'old-turn', tool: 'Read', input: { file_path: '/work/old.txt' } }],
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 'old-turn', text: large, isError: false }],
  },
  { role: 'user', text: 'latest', toolUses: [], toolResults: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'latest-turn', tool: 'Read', input: { file_path: '/work/latest.txt' } }],
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: 'latest-turn', text: large, isError: false }],
  },
  { role: 'assistant', text: large, toolUses: [] },
]

const twoSelectedMessages: SessionMessage[] = [
  ...messages,
  { role: 'assistant', text: large, toolUses: [] },
]
const proactiveMessages: SessionMessage[] = [
  ...messages,
  { role: 'assistant', text: 'x'.repeat(40000), toolUses: [] },
]
test('session start registers recovery, auto compaction writes artifacts, and recovery reads them', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const files = new Map<string, string>()
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
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
  const manifestPath = writes[1]?.path
  if (manifestPath === undefined) throw new Error('missing artifact manifest write')
  const artifactId = manifestPath.split('/').at(-2)
  if (artifactId === undefined || !isArtifactId(artifactId)) throw new Error('invalid artifact id')
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
      text: `[CTRSCM shaken tool result: Bash ls, ~20000 estimated tokens (80000 chars) externalized; before quoting details, recover the full text with mcp__ctrscm__recover id="${artifactId}"]`,
      isError: false,
    }],
  })
  const chunkPath = writes[0]?.path
  expect(chunkPath).toBe(`/home/example/.ctrscm/artifacts/${artifactId}/chunk-0000.txt`)
  expect(manifestPath).toBe(`/home/example/.ctrscm/artifacts/${artifactId}/manifest.json`)
  expect(writes).toHaveLength(3)
  const usageWrite = writes[2]
  if (usageWrite === undefined) throw new Error('missing usage event write')
  const usageFile = usageWrite.path.split('/').at(-1)
  if (usageFile === undefined) throw new Error('missing usage event filename')
  const uuid = usageFile.slice('2026-10-05T00-00-00-000Z-'.length, -'.json'.length)
  expect(usageWrite.path).toBe(
    usageEventPath('/home/example/.ctrscm/artifacts', '2026-10-05T00:00:00.000Z', uuid),
  )
  expect(JSON.parse(usageWrite.text)).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'auto',
    outcome: 'shook',
    reason: null,
    results: 1,
    chars: 80000,
    estimatedSavings: 19960,
    artifactIds: [artifactId],
    contextTokens: null,
    contextPercent: null,
    adviseTokens: null,
  })
  expect(logs).toEqual([
    'CTRSCM: shook 1 tool results (~19960 estimated tokens)',
    'CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved',
  ])

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

test('session start applies the config file before registrations and only once', async ($, on) => {
  const configPath = '/home/example/.ctrscm/config.json'
  const logs: string[] = []
  let statCalls = 0
  let readCalls = 0
  mock.env(on, { HOME: '/home/example' })
  on('fs.stat', ($, e) => {
    statCalls += 1
    expect(e.path).toBe(configPath)
    return { value: { kind: 'file', size: 32, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    readCalls += 1
    expect(e.path).toBe(configPath)
    return { value: JSON.stringify({ triggerTokens: 150000 }) }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const status = await $.command.run(commandRunInput('ctrscm'))
  expect(status.text).toContain('auto: on (trigger 50% or 150000 tokens')
  expect(status.text).toContain('options: 0 passed, 1 from file, 14 default')
  expect(status.text).toContain(`config file: ${configPath}`)
  expect(statCalls).toBe(1)
  expect(readCalls).toBe(1)
  expect(logs).toEqual([])
})

test('a usage event write failure does not change a successful compaction', async ($, on) => {
  const writes: string[] = []
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    writes.push(e.path)
    if (e.path.includes('/usage/')) throw new Error('usage disk full')
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const result = await $.session.compact({
    trigger: 'plugin',
    instructions: PROACTIVE_MARK,
    messages,
  } as never)
  if (!('messages' in result) || result.messages === undefined) {
    throw new Error('expected a rewritten transcript')
  }
  expect(result.messages[2]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(writes).toHaveLength(3)
  expect(writes[2]).toContain('/usage/')
  expect(logs).toEqual([
    'CTRSCM: shook 1 tool results (~19960 estimated tokens)',
    'CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved',
    'CTRSCM: usage log write failed: no implementation for fs.write',
  ])
})

test('marked proactive transcript writes a literal shake usage event', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const result = await $.session.compact({
    trigger: 'plugin',
    instructions: PROACTIVE_MARK,
    messages: proactiveMessages,
  } as never)
  if (!('messages' in result) || result.messages === undefined) {
    throw new Error('expected a rewritten transcript')
  }
  const manifestPath = writes[1]?.path
  if (manifestPath === undefined) throw new Error('missing artifact manifest')
  const artifactId = manifestPath.split('/').at(-2)
  if (artifactId === undefined) throw new Error('missing artifact id')
  const usageWrite = writes[2]
  if (usageWrite === undefined) throw new Error('missing usage event')
  const usageFile = usageWrite.path.split('/').at(-1)
  if (usageFile === undefined) throw new Error('missing usage event filename')
  const uuid = usageFile.slice('2026-10-05T00-00-00-000Z-'.length, -'.json'.length)
  expect(usageWrite.path).toBe(
    usageEventPath('/home/example/.ctrscm/artifacts', '2026-10-05T00:00:00.000Z', uuid),
  )
  expect(JSON.parse(usageWrite.text)).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome: 'shook',
    reason: null,
    results: 1,
    chars: 80000,
    estimatedSavings: 19960,
    artifactIds: [artifactId],
    contextTokens: null,
    contextPercent: null,
    adviseTokens: null,
  })
  expect(logs).toEqual([
    'CTRSCM: shook 1 tool results (~19960 estimated tokens)',
    'CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved',
  ])
})

test('precompute and instructed manual compaction use their mandated paths', async ($, on) => {
  let beneath = 0
  const writes: string[] = []
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
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
  expect(writes).toEqual([])
  expect(logs).toEqual([])
})

test('failed recovery registration and artifact root use the builtin fallback', async ($, on) => {
  let beneath = 0
  const logs: string[] = []
  on('tool.register', () => {
    throw new Error('registration unavailable')
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
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
  expect(logs).toEqual([
    'CTRSCM: config file skipped: HOME unavailable',
    'CTRSCM: recovery registration failed: no implementation for tool.register',
    'CTRSCM: artifact root lookup failed: no implementation for env.get',
  ])
})


test('successful registration without HOME falls back without rewriting', async ($, on) => {
  let beneath = 0
  const writes: string[] = []
  const logs: string[] = []
  mock.env(on, {})
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.session.compact({ trigger: 'auto', messages } as never)).toEqual({ messages })
  expect(beneath).toBe(1)
  expect(
    await $.session.compact({
      trigger: 'plugin',
      instructions: PROACTIVE_MARK,
      messages,
    } as never),
  ).toEqual({ skip: 'ctrscm: artifact root unavailable' })
  expect(beneath).toBe(1)
  expect(writes).toEqual([])
  expect(logs).toEqual(['CTRSCM: config file skipped: HOME unavailable'])
})

test('rejected HOME lookup logs the config skip and leaves no usage event', async ($, on) => {
  const writes: string[] = []
  const logs: string[] = []
  on('env.get', () => {
    throw new Error('HOME rejected')
  })
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.session.compact({ trigger: 'auto', messages } as never)).toEqual({ messages })
  expect(writes).toEqual([])
  expect(logs).toEqual([
    'CTRSCM: config file skipped: HOME unavailable',
    'CTRSCM: artifact root lookup failed: no implementation for env.get',
  ])
})

test('rejected HOME during advice logs lookup failure without an event', async ($, on) => {
  const writes: string[] = []
  const logs: string[] = []
  const toasts: string[] = []
  let rejectHome = false
  on('env.get', () => {
    if (rejectHome) throw new Error('HOME rejected')
    return { value: '/home/example' }
  })
  on('session.id', () => ({ value: 's-1' }))
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const measure = (tokens: number, percent: number) =>
    $.session.measure({
      context: { window: 200000, tokens, percent },
      rateLimits: [],
      changed: ['context'],
    })
  await measure(150000, 75)
  await measure(149999, 75)
  writes.length = 0
  logs.length = 0
  rejectHome = true
  await measure(150000, 75)
  expect(toasts).toEqual([
    'CTRSCM: context is 150000 tokens (advice threshold 150000); consider /compact or a new session',
  ])
  expect(logs).toEqual([
    'CTRSCM: context is 150000 tokens (advice threshold 150000); consider /compact or a new session',
    'CTRSCM: artifact root lookup failed: no implementation for env.get',
  ])
  expect(writes).toEqual([])
})

test('a later artifact write failure falls back after leaving only orphaned chunks', async ($, on) => {
  const writes: string[] = []
  const logs: string[] = []
  let manifestWrites = 0
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
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
  expect(writes).toHaveLength(5)
  expect(writes[0]).toContain('/chunk-0000.txt')
  expect(writes[1]).toContain('/manifest.json')
  expect(writes[2]).toContain('/chunk-0000.txt')
  expect(writes[3]).toContain('/manifest.json')
  expect(writes[4]).toContain('/usage/')
  expect(logs[0]).toContain('CTRSCM: artifact write failed after 1 artifacts')
})

test('session measure registers commands, triggers proactive Shake, and reports status', async ($, on) => {
  const logs: string[] = []
  const commands: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/example' })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(commands).toEqual(['shake', 'ctrscm'])
  expect(
    await $.session.measure({
      context: { window: 200000, tokens: 150000, percent: 75 },
      rateLimits: [],
      changed: ['context'],
    }),
  ).toEqual({ changed: ['context'] })
  expect(logs).toEqual(['CTRSCM: requesting proactive shake (context 75%)'])
  const status = await $.command.run(commandRunInput('ctrscm'))
  expect(status.text).toContain('last: proactive skipped: no transcript')
  expect(status.text).toContain('options: 0 passed, 0 from file, 15 default')
  expect(status.text).toContain('config file: none')
})

test('ctrscm status reports the engine context and compaction threshold', async ($, on) => {
  const requests: Array<{ breakdown?: string }> = []
  const logs: string[] = []
  const usage: SessionUsage = {
    context: {
      window: 200000,
      tokens: 50000,
      percent: 25,
      breakdown: {
        categories: [],
        totalTokens: 50000,
        maxTokens: 100000,
        rawMaxTokens: 100000,
        autocompactSource: 'model-default',
        percentage: 50,
        gridRows: [],
        model: 'claude-test',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        autoCompactThreshold: 100000,
        isAutoCompactEnabled: true,
        apiUsage: null,
      },
    },
    rateLimits: [],
  }
  mock.env(on, { HOME: '/home/example' })
  on('session.usage', ($, e) => {
    requests.push(e)
    return { value: usage }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const status = await $.command.run(commandRunInput('ctrscm'))

  expect(requests).toEqual([{ breakdown: 'summary' }])
  expect(status.text).toContain('context: 50000 tokens (25% of 200000)')
  expect(status.text).toContain('engine compaction: auto at 100000 tokens')
  expect(status.text).toContain(
    'note: trigger tokens (120000) are at or above the engine threshold (100000); the engine may compact first',
  )
  expect(logs).toEqual([])
})

test('ctrscm status reports unavailable engine usage without logging', async ($, on) => {
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  on('session.usage', () => {
    throw new Error('usage unavailable')
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const status = await $.command.run(commandRunInput('ctrscm'))

  expect(status.text).toContain('context: unavailable (no implementation for session.usage)')
  expect(status.text).toContain('engine compaction: unavailable')
  expect(logs).toEqual([])
})


const idleHost: Plugin = {
  name: 'idle-host',
  tier: 'prepend',
  register(on) {
    on('session.compact', ($, e, next) => {
      if (e.instructions !== 'ctrscm:idle') return next(e)
      $.ui.log('test idle host compact ctrscm:idle')
      const text = 'x'.repeat(40000)
      return next({
        trigger: e.trigger,
        instructions: e.instructions,
        messages: [
          {
            role: 'assistant',
            text: '',
            toolUses: [{ tool_use_id: 'idle-tool', tool: 'Read', input: { file_path: '/work/a.ts' }, text, result: text }],
          },
          {
            role: 'user',
            text: '',
            toolUses: [],
            toolResults: [{ tool_use_id: 'idle-tool', text, isError: false, result: text }],
          },
          {
            role: 'assistant',
            text: 'done',
            toolUses: [],
          },
        ],
      })
    })
  },
}

function idleHarness(on: On, overrides: Record<string, string> = {}) {
  const writes: Array<{ path: string; text: string }> = []
  const logs: string[] = []
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  mock.env(on, { HOME: '/home/example' })
  on('session.id', () => ({ value: 's-idle-matrix' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 128, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({
    value: JSON.stringify({
      idleShakeMinutes: '60',
      minSavings: '1000000',
      protectTokens: '0',
      minResultTokens: '1',
      protectedTools: 'none',
      ...overrides,
    }),
  }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      context: { window: 200000, tokens: 40000, percent: 20 },
      rateLimits: [],
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'answer kept' }))
  on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('classic.SessionStart', () => ({ additionalContext: ['classic bottom result'] }))
  return { clock, writes, logs }
}

async function measureIdleContext($: Engine, tokens = 40000) {
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await $.session.measure({
    context: { window: 200000, tokens, percent: tokens / 2000 },
    rateLimits: [],
    changed: ['context'],
  })
}

async function seedIdleTurn($: Engine, reason: Exclude<TurnCompleteInput['reason'], 'refusal'> = 'answer', agentId?: string) {
  await measureIdleContext($)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: 't-idle-matrix',
    reason,
    agentId,
  })
}

function idleEdit($: Engine) {
  return promptEdit($, {
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: 'a',
  })
}

function idleEvents(writes: Array<{ path: string; text: string }>) {
  return writes
    .filter(({ path }) => path.includes('/usage/'))
    .map(({ text }) => JSON.parse(text))
    .filter((event) => event.event === 'shake' && event.label === 'idle')
}

async function expectNoIdleEdit($: Engine, h: { writes: Array<{ path: string; text: string }> }) {
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(0)
}

const idleRejectHost: Plugin = {
  name: 'idle-reject-host',
  tier: 'prepend',
  register(on) {
    on('session.compact', ($, e, next) => {
      if (e.instructions === 'ctrscm:idle') {
        return next.to({
          trigger: e.trigger,
          instructions: e.instructions,
          messages: [{ role: 'user', text: 'probe', toolUses: [] }],
        }, 'core')
      }
      return next(e)
    })
  },
}

test('idle prompt edit requests a marked Shake after a cold-cache gap', {
  plugins: [idleHost],
}, async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  const clock = mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-idle-success' }))
  on('fs.stat', () => ({
    value: { kind: 'file', size: 128, mtimeMs: 0, isLink: false },
  }))
  on('fs.read', () => ({
    value: JSON.stringify({
      idleShakeMinutes: '60',
      minSavings: '1000000',
      protectTokens: '0',
      minResultTokens: '1',
      protectedTools: 'none',
    }),
  }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      context: { window: 200000, tokens: 40000, percent: 20 },
      rateLimits: [],
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: 'answer kept' }))
  on('prompt.edit', ($, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('session.compact', ($, e) => ({ messages: e.messages }))

  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await $.session.measure({
    context: { window: 200000, tokens: 40000, percent: 20 },
    rateLimits: [],
    changed: ['context'],
  })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-idle-success',
    reason: 'answer',
  })
  await clock.advance(60 * 60_000)
  const editResult = await promptEdit($, {
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: 'a',
  })
  expect(editResult).toEqual({ text: 'a', cursor: 1 })
  const idleUsage = writes
    .map(({ path, text }) => (path.includes('/usage/') ? JSON.parse(text) : undefined))
    .find((event) => event?.event === 'shake' && event.label === 'idle')
  expect(idleUsage).toEqual(expect.objectContaining({ label: 'idle', outcome: 'shook' }))
  expect(writes.some(({ path }) => path.includes('/chunk-0000.txt'))).toBe(true)
  expect(writes.some(({ path }) => path.includes('/manifest.json'))).toBe(true)
  expect(logs).toContain('CTRSCM: idle shake requested (idle 60 min)')
  expect(logs).toContain('test idle host compact ctrscm:idle')
  expect((await $.command.run(commandRunInput('ctrscm'))).text).toContain('this session: 1 passes')
})

test('idle resume before session start uses the later config file settings', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-start-order',
    transcript_path: '/tmp/idle-start-order.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(h.logs.filter((text) => text === 'test idle host compact ctrscm:idle')).toEqual([
    'test idle host compact ctrscm:idle',
  ])
  expect(idleEvents(h.writes)).toEqual([
    expect.objectContaining({ label: 'idle', outcome: 'shook' }),
  ])
})

test('idle resume resets a previous turn stamp before reseeding', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await seedIdleTurn($)
  await h.clock.advance(5 * 60_000)
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-reset-resume',
    transcript_path: '/tmp/idle-reset-resume.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('idle resume clears stale state when the cache is still warm', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await seedIdleTurn($)
  await h.clock.advance(70 * 60_000)
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-warm-resume',
    transcript_path: '/tmp/idle-warm-resume.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: false,
  })
  await expectNoIdleEdit($, h)
})

test('clear resets completed-turn idle state', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await seedIdleTurn($)
  await h.clock.advance(70 * 60_000)
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'clear',
    session_id: 's-idle-clear',
    transcript_path: '/tmp/idle-clear.jsonl',
    cwd: '/work',
  })
  await expectNoIdleEdit($, h)
})

test('startup preserves completed-turn idle state', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await seedIdleTurn($)
  await h.clock.advance(70 * 60_000)
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'startup',
    session_id: 's-idle-startup-state',
    transcript_path: '/tmp/idle-startup-state.jsonl',
    cwd: '/work',
  })
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('fast composer edits claim one idle request', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await seedIdleTurn($)
  await h.clock.advance(60 * 60_000)
  await Promise.all([idleEdit($), idleEdit($)])
  expect(h.logs.filter((text) => text === 'CTRSCM: idle shake requested (idle 60 min)')).toHaveLength(1)
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('idle prompt edit seeds from a resumed classic session', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const result = await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-resume',
    transcript_path: '/tmp/idle-resume.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  expect(result).toEqual({ additionalContext: ['classic bottom result'] })
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toEqual([
    expect.objectContaining({ label: 'idle', outcome: 'shook' }),
  ])
  expect(h.logs).toContain('test idle host compact ctrscm:idle')
})

test('idle prompt edit seeds from a forked classic session', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const result = await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'fork',
    session_id: 's-idle-fork',
    transcript_path: '/tmp/idle-fork.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  expect(result).toEqual({ additionalContext: ['classic bottom result'] })
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toEqual([
    expect.objectContaining({ label: 'idle', outcome: 'shook' }),
  ])
  expect(h.logs).toContain('test idle host compact ctrscm:idle')
})

test('idle prompt edit waits for the configured gap from a resumed session', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-gap',
    transcript_path: '/tmp/idle-gap.jsonl',
    cwd: '/work',
    seconds_since_last_response: 3000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(0)
  await h.clock.advance(16 * 60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('idle resume seeding ignores ineligible classic session starts', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const inputs: Array<ClassicEventOf['classic.SessionStart']> = [
    {
      hook_event_name: 'SessionStart',
      source: 'startup',
      session_id: 's-idle-startup',
      transcript_path: '/tmp/idle-startup.jsonl',
      cwd: '/work',
      seconds_since_last_response: 4000,
      context_tokens: 40000,
      prompt_cache_likely_expired: true,
    },
    {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: 's-idle-cache-warm',
      transcript_path: '/tmp/idle-cache-warm.jsonl',
      cwd: '/work',
      seconds_since_last_response: 4000,
      context_tokens: 40000,
      prompt_cache_likely_expired: false,
    },
    {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: 's-idle-cache-unknown',
      transcript_path: '/tmp/idle-cache-unknown.jsonl',
      cwd: '/work',
      seconds_since_last_response: 4000,
      context_tokens: 40000,
    },
    {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: 's-idle-no-gap',
      transcript_path: '/tmp/idle-no-gap.jsonl',
      cwd: '/work',
      context_tokens: 40000,
      prompt_cache_likely_expired: true,
    },
    {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: 's-idle-small-context',
      transcript_path: '/tmp/idle-small-context.jsonl',
      cwd: '/work',
      seconds_since_last_response: 4000,
      context_tokens: 29999,
      prompt_cache_likely_expired: true,
    },
  ]
  for (const input of inputs) await classicSessionStart($, input)
  await h.clock.advance(70 * 60_000)
  await expectNoIdleEdit($, h)
})

test('idle resume makes no idle request when idle Shake is off', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '0' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-off',
    transcript_path: '/tmp/idle-off.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  await h.clock.advance(70 * 60_000)
  await expectNoIdleEdit($, h)
})

test('idle resume makes no idle request when auto Shake is off', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { autoShake: 'off' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-auto-off',
    transcript_path: '/tmp/idle-auto-off.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  await h.clock.advance(70 * 60_000)
  await expectNoIdleEdit($, h)
})

test('idle resume seeding logs and survives a clock failure', {
  plugins: [idleHost],
}, async ($, on) => {
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  on('fs.stat', () => ({ value: { kind: 'file', size: 128, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: JSON.stringify({ idleShakeMinutes: '65' }) }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('clock.now', () => {
    throw new Error('resume clock failed')
  })
  on('classic.SessionStart', () => ({ additionalContext: ['classic bottom result'] }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await expect(
    classicSessionStart($, {
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: 's-idle-clock-failure',
      transcript_path: '/tmp/idle-clock-failure.jsonl',
      cwd: '/work',
      seconds_since_last_response: 4000,
      context_tokens: 40000,
      prompt_cache_likely_expired: true,
    }),
  ).resolves.toEqual({ additionalContext: ['classic bottom result'] })
  expect(logs.some((text) => text.startsWith('CTRSCM: idle clock failed: '))).toBe(true)
})

test('idle resume seed is replaced by a completed answer turn', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-answer',
    transcript_path: '/tmp/idle-answer.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-idle-answer',
    reason: 'answer',
  })
  await expectNoIdleEdit($, h)
})

test('idle resume context yields to a smaller measured context', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await classicSessionStart($, {
    hook_event_name: 'SessionStart',
    source: 'resume',
    session_id: 's-idle-measure',
    transcript_path: '/tmp/idle-measure.jsonl',
    cwd: '/work',
    seconds_since_last_response: 4000,
    context_tokens: 40000,
    prompt_cache_likely_expired: true,
  })
  await $.session.measure({
    context: { window: 200000, tokens: 10000, percent: 5 },
    rateLimits: [],
    changed: ['context'],
  })
  await expectNoIdleEdit($, h)
})

test('idle prompt edit waits for the gap and only attempts once per turn', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await seedIdleTurn($)
  await h.clock.advance(59 * 60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(0)

  await h.clock.advance(60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(1)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(1)

  await $.turn.start({ text: 'next', turnId: 't-idle-next' })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-idle-next',
    reason: 'answer',
  })
  await h.clock.advance(60 * 60_000)
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(2)
})

test('idle prompt edit stays disabled at the default', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '0' })
  await seedIdleTurn($)
  await h.clock.advance(60 * 60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(0)
  expect(h.logs).not.toContain('CTRSCM: idle shake requested (idle 60 min)')
})

test('idle prompt edit records a rejected compaction and preserves the edit', {
  plugins: [idleRejectHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await seedIdleTurn($)
  await h.clock.advance(60 * 60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(h.logs.some((text) => text.startsWith('CTRSCM: idle shake rejected:'))).toBe(true)
  expect(idleEvents(h.writes)).toEqual([
    expect.objectContaining({ label: 'idle', outcome: 'failed', reason: 'compaction failed' }),
  ])
  expect((await $.command.run(commandRunInput('ctrscm'))).text).toContain('last: idle skipped: compaction failed')

  await $.session.measure({
    context: { window: 200000, tokens: 40000, percent: 20 },
    rateLimits: [],
    changed: ['context'],
  })
  expect(h.logs).not.toContain('CTRSCM: requesting proactive shake (context 20%)')
})

test('idle prompt edit respects the autoShake gate', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { autoShake: 'off' })
  await seedIdleTurn($)
  await h.clock.advance(60 * 60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(0)
})

test('idle prompt edit respects a queued shake', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await seedIdleTurn($)
  await $.command.run(commandRunInput('shake'))
  await h.clock.advance(60 * 60_000)
  expect(await idleEdit($)).toEqual({ text: 'a', cursor: 1 })
  expect(idleEvents(h.writes)).toHaveLength(0)
})

test('idle prompt edit respects the context floor', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await measureIdleContext($, 29999)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-small-context',
    reason: 'answer',
  })
  await h.clock.advance(60 * 60_000)
  await expectNoIdleEdit($, h)
})

test('idle prompt edit requires a completed turn', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await measureIdleContext($)
  await h.clock.advance(60 * 60_000)
  await expectNoIdleEdit($, h)
})

test('idle prompt edit ignores a running turn', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await measureIdleContext($)
  await $.turn.start({ text: 'running', turnId: 't-running' })
  await h.clock.advance(60 * 60_000)
  await expectNoIdleEdit($, h)
})

test('idle prompt edit tracks a running subagent by turn id', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await seedIdleTurn($)
  await $.turn.start({ text: 'subagent', turnId: 't-subagent-running' })
  await h.clock.advance(60 * 60_000)
  await expectNoIdleEdit($, h)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-subagent-running',
    reason: 'answer',
    agentId: 'agent-1',
  })
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('main completion clears leftover running turn ids', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await measureIdleContext($)
  await $.turn.start({ text: 'leftover subagent', turnId: 't-leftover-subagent' })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-main-self-heal',
    reason: 'answer',
  })
  await h.clock.advance(60 * 60_000)
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('idle prompt edit ignores a subagent turn completion', {
  plugins: [idleHost],
}, async ($, on) => {
  const subagent = idleHarness(on)
  await measureIdleContext($)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-subagent',
    reason: 'answer',
    agentId: 'agent-1',
  })
  await subagent.clock.advance(60 * 60_000)
  await expectNoIdleEdit($, subagent)
})

test('idle prompt edit timestamps an interrupted main turn', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on)
  await measureIdleContext($)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: true,
    turnId: 't-aborted',
    reason: 'aborted',
  })
  await h.clock.advance(60 * 60_000)
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(1)
})

test('idle prompt edit timestamps an errored main turn', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { idleShakeMinutes: '65' })
  await seedIdleTurn($)
  await h.clock.advance(70 * 60_000)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-error',
    reason: 'error',
  })
  await expectNoIdleEdit($, h)
})

test('idle pass cooldown suppresses proactive requests', {
  plugins: [idleHost],
}, async ($, on) => {
  const h = idleHarness(on, { triggerTokens: '50000', triggerPercent: '99' })
  await seedIdleTurn($)
  await h.clock.advance(60 * 60_000)
  await idleEdit($)
  expect(idleEvents(h.writes)).toHaveLength(1)
  await $.session.measure({
    context: { window: 200000, tokens: 60000, percent: 30 },
    rateLimits: [],
    changed: ['context'],
  })
  expect(h.logs).not.toContain('CTRSCM: requesting proactive shake (context 30%)')
})


test('advice sequence follows request and advice cooldowns with literal events', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const logs: string[] = []
  const toasts: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

  const measure = (tokens: number, percent: number, changed: SessionMeasureInput['changed'] = ['context']) =>
    $.session.measure({
      context: { window: 200000, tokens, percent },
      rateLimits: [],
      changed,
    })
  await measure(150000, 75)
  await measure(149999, 75)
  await measure(150000, 75)
  await measure(160000, 80)
  await measure(160000, 80)
  await measure(160000, 80, ['rateLimits'])

  expect(logs).toEqual([
    'CTRSCM: requesting proactive shake (context 75%)',
    'CTRSCM: context is 150000 tokens (advice threshold 150000); consider /compact or a new session',
    'CTRSCM: requesting proactive shake (context 80%)',
  ])
  expect(toasts).toEqual([
    'CTRSCM: context is 150000 tokens (advice threshold 150000); consider /compact or a new session',
  ])
  expect(writes).toHaveLength(3)
  expect(JSON.parse(writes[0]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome: 'skipped',
    reason: 'no transcript',
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: 150000,
    contextPercent: 75,
    adviseTokens: null,
  })
  expect(JSON.parse(writes[1]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'advice',
    label: null,
    outcome: null,
    reason: null,
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: 150000,
    contextPercent: 75,
    adviseTokens: 150000,
  })
  expect(JSON.parse(writes[2]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome: 'skipped',
    reason: 'no transcript',
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: 160000,
    contextPercent: 80,
    adviseTokens: null,
  })
})

test('session measure ignores unrelated changes and honors the proactive cooldown', async ($, on) => {
  const logs: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/example' })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

  await $.session.measure({
    context: { window: 200000, percent: 75 },
    rateLimits: [],
    changed: ['rateLimits'],
  })
  expect(logs).toEqual([])
  const measurement: SessionMeasureInput = {
    context: { window: 200000, percent: 75 },
    rateLimits: [],
    changed: ['context'],
  }
  await $.session.measure(measurement)
  await $.session.measure(measurement)
  await $.session.measure(measurement)
  expect(logs).toEqual(['CTRSCM: requesting proactive shake (context 75%)'])
  await $.session.measure(measurement)
  expect(logs).toEqual(['CTRSCM: requesting proactive shake (context 75%)'])
  await $.session.measure(measurement)
  expect(logs).toEqual([
    'CTRSCM: requesting proactive shake (context 75%)',
    'CTRSCM: requesting proactive shake (context 75%)',
  ])
})

test('shake command queues an aggressive pass for the next changed-context measure', async ($, on) => {
  const logs: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/example' })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

  expect(await $.command.run(commandRunInput('shake'))).toEqual({
    text: 'CTRSCM: aggressive shake queued; it runs when the next turn completes',
  })
  await $.session.measure({
    context: { window: 200000, percent: 1 },
    rateLimits: [],
    changed: ['context'],
  })
  expect(logs).toEqual(['CTRSCM: requesting aggressive shake'])
  const status = await $.command.run(commandRunInput('ctrscm'))
  expect(status.text).toContain('pending: none')
  expect(status.text).toContain('last: aggressive skipped: no transcript')
})

const protectTurnHost: Plugin = {
  name: 'protect-turn-host',
  tier: 'prepend',
  register(on) {
    on('session.compact', ($, e, next) => {
      if (e.instructions !== 'ctrscm:proactive' && e.instructions !== 'ctrscm:aggressive') return next(e)
      const text = 'x'.repeat(80000)
      const fallbackMessages: SessionMessage[] = [
        { role: 'user', text: 'first', toolUses: [], toolResults: [] },
        {
          role: 'assistant',
          text: '',
          toolUses: [{ tool_use_id: 'old-turn', tool: 'Read', input: { file_path: '/work/old.txt' } }],
        },
        {
          role: 'user',
          text: '',
          toolUses: [],
          toolResults: [{ tool_use_id: 'old-turn', text, isError: false }],
        },
        { role: 'user', text: 'latest', toolUses: [], toolResults: [] },
        {
          role: 'assistant',
          text: '',
          toolUses: [{ tool_use_id: 'latest-turn', tool: 'Read', input: { file_path: '/work/latest.txt' } }],
        },
        {
          role: 'user',
          text: '',
          toolUses: [],
          toolResults: [{ tool_use_id: 'latest-turn', text, isError: false }],
        },
        { role: 'assistant', text, toolUses: [] },
      ]
      return next({ ...e, messages: e.messages ?? fallbackMessages })
    })
  },
}

test('ordinary Shake protects the latest typed turn while queued shake overrides it', {
  plugins: [protectTurnHost],
}, async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('fs.stat', () => ({ value: { kind: 'file', size: 128, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({
    value: JSON.stringify({
      protectTokens: '0',
      protectTurns: '1',
      aggressiveProtectTokens: '0',
      minResultTokens: '1',
      protectedTools: 'none',
    }),
  }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

  const ordinary = await $.session.compact({
    trigger: 'plugin',
    instructions: PROACTIVE_MARK,
    messages: protectTurnMessages,
  } as never)
  if (!('messages' in ordinary) || ordinary.messages === undefined) {
    throw new Error('expected ordinary rewritten transcript')
  }
  expect(ordinary.messages[2]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(ordinary.messages[5]).toEqual(protectTurnMessages[5])
  expect(logs).toContain('CTRSCM: shook 1 tool results (~19960 estimated tokens)')

  expect(await $.command.run(commandRunInput('shake'))).toEqual({
    text: 'CTRSCM: aggressive shake queued; it runs when the next turn completes',
  })
  await $.session.measure({
    context: { window: 200000, tokens: 1, percent: 1 },
    rateLimits: [],
    changed: ['context'],
  })
  expect(logs).toContain('CTRSCM: shook 2 tool results (~39920 estimated tokens)')
  expect(writes.some(({ path, text }) => path.endsWith('/manifest.json') && text.includes('"toolUseId":"latest-turn"'))).toBe(true)
})

test('marked calls bypass manual fallback and explain an absent transcript', async ($, on) => {
  let beneath = 0
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  expect(
    await $.session.compact({
      trigger: 'manual',
      instructions: PROACTIVE_MARK,
    } as never),
  ).toEqual({ skip: 'ctrscm: no transcript' })
  expect(beneath).toBe(0)
})
test('manual marked requests stay above the built-in compactor', async ($, on) => {
  let beneath = 0
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

  const marked = await $.session.compact({
    trigger: 'manual',
    instructions: AGGRESSIVE_MARK,
    messages: proactiveMessages,
  } as never)
  if (!('messages' in marked) || marked.messages === undefined) {
    throw new Error('expected a marked rewritten transcript')
  }
  expect(marked.messages[2]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(marked.messages[4]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(beneath).toBe(0)

  expect(
    await $.session.compact({
      trigger: 'manual',
      instructions: 'summarize the tests',
      messages: proactiveMessages,
    } as never),
  ).toEqual({ messages: proactiveMessages })
  expect(beneath).toBe(1)
})
test('aggressive and proactive marked passes use their distinct protected tails', async ($, on) => {
  let beneath = 0
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', () => ({ value: undefined }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })

  const aggressive = await $.session.compact({
    trigger: 'plugin',
    instructions: AGGRESSIVE_MARK,
    messages: twoSelectedMessages,
  } as never)
  if (!('messages' in aggressive) || aggressive.messages === undefined) {
    throw new Error('expected an aggressive rewritten transcript')
  }
  expect(aggressive.messages[2]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(aggressive.messages[4]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(logs).toContain('CTRSCM: shook 2 tool results (~39920 estimated tokens)')
  expect(logs).toEqual([
    'CTRSCM: shook 2 tool results (~39920 estimated tokens)',
    'CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved',
  ])
  const proactive = await $.session.compact({
    trigger: 'plugin',
    instructions: PROACTIVE_MARK,
    messages: proactiveMessages,
  } as never)
  if (!('messages' in proactive) || proactive.messages === undefined) {
    throw new Error('expected a proactive rewritten transcript')
  }
  expect(proactive.messages[2]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
  expect(proactive.messages[4]).toEqual(proactiveMessages[4])
  expect(logs).toContain('CTRSCM: shook 1 tool results (~19960 estimated tokens)')
  expect(logs).toEqual([
    'CTRSCM: shook 2 tool results (~39920 estimated tokens)',
    'CTRSCM: a pass just ran; after a few more turns /ctrscm report shows what it saved',
    'CTRSCM: shook 1 tool results (~19960 estimated tokens)',
  ])


  const status = await $.command.run(commandRunInput('ctrscm'))
  expect(status.text).toContain('this session: 2 passes, 3 results shaken, ~59880 estimated tokens saved')
  expect(status.text).toContain('last: proactive shook 1 results (~19960 estimated tokens)')
  expect(beneath).toBe(0)
})

test('an image-bearing marked message stays intact while another result shakes', async ($, on) => {
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const imageMessages: SessionMessage[] = messages.map((message, index) =>
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
  const compacted = await $.session.compact({
    trigger: 'plugin',
    instructions: AGGRESSIVE_MARK,
    messages: [...imageMessages, { role: 'assistant', text: 'x'.repeat(40000), toolUses: [] }],
  } as never)
  if (!('messages' in compacted) || compacted.messages === undefined) {
    throw new Error('expected an image-safe rewritten transcript')
  }
  expect(compacted.messages[2]).toEqual(imageMessages[2])
  expect(compacted.messages[4]).toEqual(expect.objectContaining({
    toolResults: [expect.objectContaining({ text: expect.stringContaining(PLACEHOLDER_PREFIX) })],
  }))
})

test('one command registration failure is logged without disabling recovery', async ($, on) => {
  const logs: string[] = []
  mock.env(on, { HOME: '/home/example' })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => {
    if (e.name === 'shake') throw new Error('command unavailable')
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(logs).toEqual(['CTRSCM: command registration failed: no implementation for command.register'])
  expect(
    await $.session.compact({
      trigger: 'plugin',
      instructions: PROACTIVE_MARK,
      messages: [],
    } as never),
  ).toEqual({ skip: 'ctrscm: nothing worth shaking' })
})

test('marked calls skip without invoking the built-in fallback when nothing is eligible', async ($, on) => {
  let beneath = 0
  mock.env(on, { HOME: '/home/example' })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(
    await $.session.compact({
      trigger: 'plugin',
      instructions: PROACTIVE_MARK,
      messages: [],
    } as never),
  ).toEqual({ skip: 'ctrscm: nothing worth shaking' })
  expect(beneath).toBe(0)
})

test('marked calls skip when eligible savings are below the configured minimum', async ($, on) => {
  const belowMinSavings: SessionMessage[] = [
    {
      role: 'assistant',
      text: '',
      toolUses: [{ tool_use_id: 'small', tool: 'Bash', input: {} }],
    },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: 'small', text: 'x'.repeat(804), isError: false }],
    },
    { role: 'assistant', text: 'x'.repeat(64000), toolUses: [] },
  ]
  let beneath = 0
  const writes: Array<{ path: string; text: string }> = []
  const logs: string[] = []
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/example' })
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    beneath += 1
    return { messages: e.messages }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(
    await $.session.compact({
      trigger: 'plugin',
      instructions: PROACTIVE_MARK,
      messages: belowMinSavings,
    } as never),
  ).toEqual({ skip: 'ctrscm: nothing worth shaking' })
  expect(beneath).toBe(0)
  expect(logs).toEqual([])
  expect(writes).toHaveLength(1)
  expect(JSON.parse(writes[0]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome: 'skipped',
    reason: 'nothing worth shaking',
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: null,
    contextPercent: null,
    adviseTokens: null,
  })

})

test('unmarked fallback writes its event before calling the builtin layer', async ($, on) => {
  const smallMessages: SessionMessage[] = [
    {
      role: 'assistant',
      text: '',
      toolUses: [{ tool_use_id: 'small', tool: 'Bash', input: {} }],
    },
    {
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: 'small', text: 'x'.repeat(804), isError: false }],
    },
    { role: 'assistant', text: 'x'.repeat(64000), toolUses: [] },
  ]
  const writes: Array<{ path: string; text: string }> = []
  let writesWhenBeneathRuns = -1
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', ($, e) => {
    writesWhenBeneathRuns = writes.length
    return { messages: e.messages }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.session.compact({ trigger: 'auto', messages: smallMessages } as never)).toEqual({
    messages: smallMessages,
  })
  expect(writesWhenBeneathRuns).toBe(1)
  expect(JSON.parse(writes[0]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-05T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'auto',
    outcome: 'fallback',
    reason: 'nothing worth shaking',
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: null,
    contextPercent: null,
    adviseTokens: null,
  })
})
test('shake command reports unavailable when recovery registration failed', async ($, on) => {
  on('tool.register', () => {
    throw new Error('registration unavailable')
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.command.run(commandRunInput('shake'))).toEqual({
    text: 'CTRSCM: recovery tool unavailable; shake not queued',
  })
  expect(
    await $.session.compact({
      trigger: 'plugin',
      instructions: PROACTIVE_MARK,
      messages: [],
    } as never),
  ).toEqual({ skip: 'ctrscm: recovery tool not registered' })
})

test('marked artifact write failure returns its skip reason without calling beneath', async ($, on) => {
  const writes: string[] = []
  const logs: string[] = []
  let beneath = 0
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    writes.push(e.path)
    if (e.path.includes('/usage/')) throw new Error('usage disk full')
    if (e.path.endsWith('/chunk-0000.txt')) throw new Error('disk full')
    return { value: undefined }
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
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(
    await $.session.compact({
      trigger: 'plugin',
      instructions: AGGRESSIVE_MARK,
      messages,
    } as never),
  ).toEqual({ skip: 'ctrscm: artifact write failed' })
  expect(logs).toEqual([
    'CTRSCM: artifact write failed after 0 artifacts: no implementation for fs.write',
    'CTRSCM: usage log write failed: no implementation for fs.write',
  ])
  expect(writes).toHaveLength(2)
  expect(writes[1]).toContain('/usage/')
  expect(beneath).toBe(0)
})

const deferredCompaction: Plugin = {
  name: 'compaction-host',
  tier: 'prepend',
  register(on) {
    on('session.compact', async ($, e, next) => {
      const rejection = await $.env.get('COMPACT_REJECT')
      if (e.instructions === 'ctrscm:proactive') {
        await $.env.get('COMPACT_PROACTIVE_MARK')
      } else {
        await $.env.get('COMPACT_AGGRESSIVE_MARK')
      }
      const input = {
        trigger: e.trigger,
        instructions: e.instructions,
        messages: [{ role: 'user' as const, text: 'probe', toolUses: [] }],
      }
      if (rejection === 'reject') return next.to(input, 'core')
      return next(input)
    })
  },
}

function deferredHarness($: Engine, on: On) {
  const logs: string[] = []
  const writes: Array<{ path: string; text: string }> = []
  const toasts: string[] = []
  const requests: string[] = []
  let signalEntered = () => {}
  let releaseGate = () => {}
  let entered = Promise.resolve()
  const gate = {
    enabled: false,
    arm() {
      entered = new Promise<void>((resolve) => {
        signalEntered = resolve
        releaseGate = resolve
      })
      this.enabled = true
    },
    entered: () => entered,
    release() {
      releaseGate()
    },
  }
  const host = { reject: true }
  on('env.get', async ($, e) => {
    if (e.name === 'COMPACT_PROACTIVE_MARK') {
      requests.push(PROACTIVE_MARK)
      return { value: undefined }
    }
    if (e.name === 'COMPACT_AGGRESSIVE_MARK') {
      requests.push(AGGRESSIVE_MARK)
      return { value: undefined }
    }
    if (e.name === 'COMPACT_REJECT') {
      if (gate.enabled) {
        gate.enabled = false
        signalEntered()
        await new Promise<void>((resolve) => {
          releaseGate = resolve
        })
      }
      return { value: host.reject ? 'reject' : undefined }
    }
    return { value: '/work/home' }
  })
  mock.clock(on, { now: Date.parse('2026-10-06T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ctrscm__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: 'answer kept' }))
  const measure = (tokens = 150000, percent = 75) =>
    $.session.measure({ context: { window: 200000, tokens, percent }, rateLimits: [], changed: ['context'] })
  const complete = (reason: Exclude<TurnCompleteInput['reason'], 'refusal'> = 'answer', agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't-1', reason, agentId })
  const status = () => $.command.run(commandRunInput('ctrscm'))
  return { logs, writes, toasts, requests, gate, host, measure, complete, status }
}


test('a refused measure defers proactive compaction without reporting a failed pass', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await expect(
    $.session.compact({ trigger: 'plugin', instructions: PROACTIVE_MARK, messages } as never),
  ).rejects.toThrow('no implementation for session.compact')
  h.requests.length = 0
  await h.measure()
  expect(h.requests).toEqual([PROACTIVE_MARK])
  expect(h.logs).toEqual([
    'CTRSCM: requesting proactive shake (context 75%)',
    'CTRSCM: proactive shake deferred to turn end: no implementation for session.compact',
  ])
  expect(h.writes).toEqual([])
  expect((await h.status()).text).toContain('last: none yet')
  h.host.reject = false
  h.logs.length = 0
  h.requests.length = 0
  await h.complete()
  expect(h.requests).toEqual([PROACTIVE_MARK])
  expect(h.logs).toEqual(['CTRSCM: retrying proactive shake at turn end'])
  expect(h.writes).toHaveLength(2)
  expect(JSON.parse(h.writes[0]?.text ?? '')).toEqual(expect.objectContaining({ event: 'turn' }))
  const turnAt = JSON.parse(h.writes[0]?.text ?? '').at
  const shakeAt = JSON.parse(h.writes[1]?.text ?? '').at
  expect(turnAt <= shakeAt).toBe(true)
  expect(JSON.parse(h.writes[1]?.text ?? '')).toEqual(expect.objectContaining({
    event: 'shake',
    label: 'proactive',
    outcome: 'skipped',
    reason: 'nothing worth shaking',
  }))
  expect((await h.status()).text).toContain('pending: none')
  h.logs.length = 0
  h.requests.length = 0
  await h.measure(100000, 50)
  expect(h.logs).toEqual([])
  expect(h.requests).toEqual([])
})

test('a second rejection at turn end records failure and consumes the deferred request', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await h.measure()
  h.logs.length = 0
  h.requests.length = 0
  h.writes.length = 0
  await h.complete()
  expect(h.requests).toEqual([PROACTIVE_MARK])
  expect(h.logs).toEqual([
    'CTRSCM: retrying proactive shake at turn end',
    'CTRSCM: proactive shake failed: no implementation for session.compact',
  ])
  expect(h.writes).toHaveLength(2)
  expect(JSON.parse(h.writes[1]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-06T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'shake',
    label: 'proactive',
    outcome: 'failed',
    reason: 'compaction failed',
    results: 0,
    chars: 0,
    estimatedSavings: 0,
    artifactIds: [],
    contextTokens: 150000,
    contextPercent: 75,
    adviseTokens: null,
  })
  expect((await h.status()).text).toContain('last: proactive skipped: compaction failed')
  expect((await h.status()).text).toContain('pending: none')
  h.logs.length = 0
  h.requests.length = 0
  await h.measure(100000, 50)
  expect(h.logs).toEqual([])
  expect(h.requests).toEqual([])
})

test('a refused aggressive request is restored until turn-end failure and never retries again', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  expect(await $.command.run(commandRunInput('shake'))).toEqual({
    text: 'CTRSCM: aggressive shake queued; it runs when the next turn completes',
  })
  await h.measure()
  expect(h.requests).toEqual([AGGRESSIVE_MARK])
  expect(h.logs).toEqual([
    'CTRSCM: requesting aggressive shake',
    'CTRSCM: aggressive shake deferred to turn end: no implementation for session.compact',
  ])
  expect((await h.status()).text).toContain('pending: aggressive shake')
  expect(h.writes).toEqual([])
  h.logs.length = 0
  h.requests.length = 0
  await h.complete()
  expect(h.requests).toEqual([AGGRESSIVE_MARK])
  expect(h.logs).toEqual([
    'CTRSCM: retrying aggressive shake at turn end',
    'CTRSCM: aggressive shake failed: no implementation for session.compact',
  ])
  expect(h.writes).toHaveLength(2)
  expect(JSON.parse(h.writes[1]?.text ?? '')).toEqual(expect.objectContaining({
    event: 'shake',
    label: 'aggressive',
    outcome: 'failed',
    reason: 'compaction failed',
  }))
  expect((await h.status()).text).toContain('pending: none')
  h.logs.length = 0
  h.requests.length = 0
  await h.measure(100000, 50)
  expect(h.logs).toEqual([])
  expect(h.requests).toEqual([])
})

test('a queued shake upgrades a deferred proactive request at turn end', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await h.measure()
  h.logs.length = 0
  h.requests.length = 0
  h.host.reject = false
  expect(await $.command.run(commandRunInput('shake'))).toEqual({
    text: 'CTRSCM: aggressive shake queued; it runs when the next turn completes',
  })
  await h.complete()
  expect(h.requests).toEqual([AGGRESSIVE_MARK])
  expect(h.logs).toEqual(['CTRSCM: retrying aggressive shake at turn end'])
  expect(h.writes).toHaveLength(2)
  expect(JSON.parse(h.writes[1]?.text ?? '')).toEqual(expect.objectContaining({
    event: 'shake',
    label: 'aggressive',
    outcome: 'skipped',
    reason: 'nothing worth shaking',
  }))
  expect((await h.status()).text).toContain('pending: none')
})

test('aborted turn leaves the deferred request for the next normal turn end', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await h.measure()
  h.logs.length = 0
  h.requests.length = 0
  await h.complete('aborted')
  expect(h.logs).toEqual([])
  expect(h.requests).toEqual([])
  h.host.reject = false
  await h.complete()
  expect(h.requests).toEqual([PROACTIVE_MARK])
  expect(h.logs).toEqual(['CTRSCM: retrying proactive shake at turn end'])
})

test('subagent turn leaves the deferred request for the main turn end', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await h.measure()
  h.logs.length = 0
  h.requests.length = 0
  await h.complete('answer', 'a-1')
  expect(h.logs).toEqual([])
  expect(h.requests).toEqual([])
  h.host.reject = false
  await h.complete()
  expect(h.requests).toEqual([PROACTIVE_MARK])
  expect(h.logs).toEqual(['CTRSCM: retrying proactive shake at turn end'])
})

test('a pending request suppresses advice on later measurements', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await h.measure()
  h.logs.length = 0
  h.toasts.length = 0
  h.requests.length = 0
  await h.measure(200000, 100)
  expect(h.logs).toEqual([])
  expect(h.toasts).toEqual([])
  expect(h.requests).toEqual([])
})

test('a measurement while requesting does not make a second request or advice', {
  plugins: [deferredCompaction],
}, async ($, on) => {
  const h = deferredHarness($, on)
  h.gate.arm()
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const firstMeasure = h.measure()
  await h.gate.entered()
  await h.measure(160000, 80)
  h.gate.release()
  await firstMeasure
  expect(h.logs).toEqual([
    'CTRSCM: requesting proactive shake (context 75%)',
    'CTRSCM: proactive shake deferred to turn end: no implementation for session.compact',
  ])
  expect(h.toasts).toEqual([])
  expect(h.requests).toEqual([PROACTIVE_MARK])
})



test('turn.complete writes count-only turn usage with entry context and latest measured cost', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-06T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: 'answer kept' }))
  await $.session.measure({
    context: { window: 200000, tokens: 1234, percent: 1 },
    cost: { usd: 0.5 },
    rateLimits: [],
    changed: ['context', 'cost'],
  })
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-1',
    reason: 'answer',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 40,
      model: 'model-a',
    },
  } as never)
  expect(writes).toHaveLength(1)
  expect(JSON.parse(writes[0]?.text ?? '')).toEqual({
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
    contextTokens: 1234,
    contextPercent: 1,
    sessionCostUsd: 0.5,
  })
  writes.length = 0
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't-2',
    reason: 'error',
  } as never)
  expect(JSON.parse(writes[0]?.text ?? '')).toEqual({
    version: 1,
    at: '2026-10-06T00:00:00.000Z',
    sessionId: 's-1',
    agentId: null,
    event: 'turn',
    reason: 'error',
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    contextTokens: 1234,
    contextPercent: 1,
    sessionCostUsd: 0.5,
  })
})

test('ctrscm report reads the current session and leaves the default command unchanged', async ($, on) => {
  const root = '/home/example/.ctrscm/artifacts'
  const writes: Record<string, string> = {
    [`${root}/usage/01.json`]: JSON.stringify({
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
      contextTokens: null,
      contextPercent: null,
      sessionCostUsd: null,
    }),
    [`${root}/usage/02.json`]: JSON.stringify({
      version: 1,
      at: '2026-10-06T00:00:01.000Z',
      sessionId: 's-2',
      agentId: null,
      event: 'turn',
      reason: 'answer',
      model: 'model-a',
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
      contextTokens: null,
      contextPercent: null,
      sessionCostUsd: null,
    }),
  }
  mock.env(on, { HOME: '/home/example' })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.list', () => ({
    value: [
      { name: '01.json', kind: 'file', size: 1, isLink: false },
      { name: '02.json', kind: 'file', size: 1, isLink: false },
    ],
  }))
  on('fs.read', ($, e) => {
    const text = writes[e.path]
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000, tokens: 1000, percent: 1 },
    cost: { usd: 0.5 },
    rateLimits: [],
    changed: ['context', 'cost'],
  })
  const report = await $.command.run(commandRunInput('ctrscm', 'report'))
  expect(report.text).toContain('CTRSCM report, session s-1: 1 turn events, 0 shook passes')
  expect(report.text).toContain('totals, main loop: 1 turns, 20 output tokens, 30 cache creation tokens, 40 cache read tokens')
  expect((await $.command.run(commandRunInput('ctrscm'))).text).toContain('CTRSCM status')
})

test('ctrscm report returns fixed errors for unavailable roots, session ids and usage directories', async ($, on) => {
  let homeAvailable = false
  let rejectSessionId = true
  let rejectList = true
  on('env.get', () => {
    if (!homeAvailable) throw new Error('HOME unavailable')
    return { value: '/home/example' }
  })
  on('session.id', () => {
    if (rejectSessionId) throw new Error('id unavailable')
    return { value: 's-1' }
  })
  on('fs.list', () => {
    if (rejectList) throw new Error('usage directory missing')
    return { value: [] }
  })
  expect((await $.command.run(commandRunInput('ctrscm', 'report'))).text).toBe('CTRSCM report: usage log unavailable')
  homeAvailable = true
  expect((await $.command.run(commandRunInput('ctrscm', 'report'))).text).toBe('CTRSCM report: session id unavailable')
  rejectSessionId = false
  expect((await $.command.run(commandRunInput('ctrscm', 'report'))).text).toBe(
    'CTRSCM report: no usage events yet (no implementation for fs.list)',
  )
})

test('ctrscm report does not read engine usage', async ($, on) => {
  let usageCalls = 0
  mock.env(on, { HOME: '/home/example' })
  on('session.usage', () => {
    usageCalls += 1
    throw new Error('usage should not be called')
  })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.list', () => ({ value: [] }))

  const report = await $.command.run(commandRunInput('ctrscm', 'report'))

  expect(report.text).toContain('CTRSCM report, session s-1')
  expect(usageCalls).toBe(0)
})
