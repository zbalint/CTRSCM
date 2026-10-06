import type { CommandRunInput } from 'claude-code'

export function commandRunInput(command: string, args = ''): CommandRunInput {
  return {
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  }
}
