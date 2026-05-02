import { buildApiPath } from '@/app/_lib/url';

export default class Instance {
  name: string;
  project: string | null;

  constructor(name: string, project?: string | null) {
    this.name = name;
    this.project = project ?? null;
  }

  private buildPath(path: string) {
    return buildApiPath(path, { project: this.project });
  }

  private buildConsoleWebSocketUrl(operation: string, secret: string) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}${operation}/websocket?secret=${secret}`;
  }

  async createConsoleConnection(
    type: 'vga' | 'console' = 'console',
    options?: { width?: number; height?: number; force?: boolean },
  ) {
    const body: Record<string, boolean | number | string> = {
      type,
      'wait-for-websocket': true,
    };

    if (options?.force) {
      body.force = true;
    }

    if (type === 'console') {
      if (options?.width) {
        body.width = options.width;
      }

      if (options?.height) {
        body.height = options.height;
      }
    }

    const response = await fetch(
      this.buildPath(`/1.0/instances/${encodeURIComponent(this.name)}/console`),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      let errorMessage = `Failed to open console socket: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage += ` - ${JSON.stringify(errorData)}`;
      } catch {
        // Ignore JSON parse errors, use default message
      }
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      operation: string;
      metadata?: {
        metadata?: {
          fds?: Record<string, string>;
        };
      };
    };

    const fds = data.metadata?.metadata?.fds ?? {};
    const websockets = Object.fromEntries(
      Object.entries(fds).map(([key, secret]) => [
        key,
        this.buildConsoleWebSocketUrl(data.operation, secret),
      ]),
    );

    return {
      operation: data.operation,
      websockets,
    };
  }

  async openConsoleSocket(
    type: 'vga' | 'console' = 'console',
    options?: { width?: number; height?: number; force?: boolean },
  ) {
    const connection = await this.createConsoleConnection(type, options);
    const dataUrl = connection.websockets['0'];
    const controlUrl = connection.websockets.control;

    if (!dataUrl || !controlUrl) {
      throw new Error('Console connection did not return the expected websocket endpoints.');
    }

    return {
      data: new WebSocket(dataUrl),
      control: new WebSocket(controlUrl),
    };
  }

  async openExecSocket(command: string[]) {
    const response = await fetch(
      this.buildPath(`/1.0/instances/${encodeURIComponent(this.name)}/exec`),
      {
        method: 'POST',
        body: JSON.stringify({
          command,
          interactive: true,
          'wait-for-websocket': true,
        }),
      },
    );
    if (!response.ok) {
      let errorMessage = `Failed to open exec socket: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage += ` - ${JSON.stringify(errorData)}`;
      } catch {
        // Ignore JSON parse errors, use default message
      }
      throw new Error(errorMessage);
    }
    const data = await response.json();
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return {
      data: new WebSocket(
        `${protocol}://${window.location.host}${data.operation}/websocket?secret=${data.metadata.metadata.fds['0']}`,
      ),
      control: new WebSocket(
        `${protocol}://${window.location.host}${data.operation}/websocket?secret=${data.metadata.metadata.fds['control']}`,
      ),
    };
  }

  async getConsoleOutput() {
    const response = await fetch(
      this.buildPath(`/1.0/instances/${encodeURIComponent(this.name)}/console`),
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch console output: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return await response.text();
  }
}
