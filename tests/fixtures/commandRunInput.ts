import type { CommandRunInput } from 'claude-code'

export function commandRunInput(command: string): CommandRunInput {
  return {
    command,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  }
}
