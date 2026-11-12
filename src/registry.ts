export type Command = { describe: string; run: (args: string[]) => Promise<void> };

export const commands: Record<string, Command> = {};

export function register(name: string, cmd: Command): void {
  commands[name] = cmd;
}
