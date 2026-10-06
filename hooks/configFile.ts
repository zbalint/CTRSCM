import { CONFIG_OPTION_NAMES } from './config'

type ConfigFileFs = {
  stat: (path: string) => Promise<{ kind: string }>
  read: (path: string) => Promise<string>
}

type ConfigFileResult = {
  file?: Record<string, unknown>
  logs: string[]
}

function fileValue(name: string, value: unknown): string | number | boolean | readonly string[] | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (name === 'protectedTools' && Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  return undefined
}

export async function readConfigFile(fs: ConfigFileFs, home: string | undefined): Promise<ConfigFileResult> {
  const logs: string[] = []
  if (home === undefined || home === '') {
    logs.push('CTRSCM: config file skipped: HOME unavailable')
    return { logs }
  }
  const path = `${home}/.ctrscm/config.json`
  let stat: { kind: string }
  try {
    stat = await fs.stat(path)
  } catch {
    return { logs }
  }
  if (stat.kind !== 'file') {
    logs.push('CTRSCM: config file ignored: unreadable')
    return { logs }
  }
  let text: string
  try {
    text = await fs.read(path)
  } catch {
    logs.push('CTRSCM: config file ignored: unreadable')
    return { logs }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    logs.push('CTRSCM: config file ignored: not JSON')
    return { logs }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logs.push('CTRSCM: config file ignored: not an object')
    return { logs }
  }
  const file: Record<string, unknown> = {}
  for (const name of Object.keys(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG_OPTION_NAMES, name)) {
      logs.push(`CTRSCM: config file option ${name}: unknown`)
      continue
    }
    const value = fileValue(name, Object.getOwnPropertyDescriptor(parsed, name)?.value)
    if (value === undefined) {
      logs.push(`CTRSCM: config file option ${name}: invalid`)
      continue
    }
    file[name] = value
  }
  return { file, logs }
}
