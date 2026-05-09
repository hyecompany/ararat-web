import { getBrowserIncusClient } from '@/app/_incus/client';

export default class Instance {
  name: string;
  project: string | null;

  constructor(name: string, project?: string | null) {
    this.name = name;
    this.project = project ?? null;
  }

  private ref() {
    return {
      name: this.name,
      project: this.project,
    };
  }

  createConsoleConnection(
    type: 'vga' | 'console' = 'console',
    options?: { width?: number; height?: number; force?: boolean },
  ) {
    return getBrowserIncusClient().instances.createConsoleConnection({
      instance: this.ref(),
      type,
      width: options?.width,
      height: options?.height,
      force: options?.force,
    });
  }

  openConsoleSocket(
    type: 'vga' | 'console' = 'console',
    options?: { width?: number; height?: number; force?: boolean },
  ) {
    return getBrowserIncusClient().instances.openConsoleSocket({
      instance: this.ref(),
      type,
      width: options?.width,
      height: options?.height,
      force: options?.force,
    });
  }

  openExecSocket(command: string[]) {
    return getBrowserIncusClient().instances.openExecSocket({
      instance: this.ref(),
      command,
    });
  }

  getConsoleOutput() {
    return getBrowserIncusClient().instances.getConsoleOutput({
      instance: this.ref(),
    });
  }
}
