import { expect, mock, test } from 'claude-code/testing'
import type { SessionMeasureInput, SessionMessage } from 'claude-code'
import { isArtifactId } from '../hooks/artifacts'
import { PLACEHOLDER_PREFIX, RECOVER_TOOL } from '../hooks/shake'
import { AGGRESSIVE_MARK, PROACTIVE_MARK } from '../hooks/trigger'
import { commandRunInput } from './fixtures/commandRunInput'
import { usageEventPath } from '../hooks/usage'
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
      text: `[CTRSCM shaken tool result: Bash ls, ~20000 estimated tokens (80000 chars) externalized; recover with mcp__ctrscm__recover id="${artifactId}"]`,
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
    'CTRSCM: usage log write failed: no implementation for fs.write',
  ])
})

test('marked proactive transcript writes a literal shake usage event', async ($, on) => {
  const writes: Array<{ path: string; text: string }> = []
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
})

test('precompute and instructed manual compaction use their mandated paths', async ($, on) => {
  let beneath = 0
  const writes: string[] = []
  mock.env(on, { HOME: '/home/example' })
  mock.clock(on, { now: Date.parse('2026-10-05T00:00:00.000Z') })
  on('session.id', () => ({ value: 's-1' }))
  on('fs.write', ($, e) => {
    writes.push(e.path)
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
  expect(logs).toEqual([])
})

test('rejected HOME lookup leaves no usage event or log', async ($, on) => {
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
  expect(logs).toEqual(['CTRSCM: artifact root lookup failed: no implementation for env.get'])
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


