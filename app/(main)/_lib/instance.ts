import { Instance as IInstance } from 'ararat-ui-web/types/instance';

export default class Instance implements IInstance {
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  async openConsoleSocket(
    type: 'vga' | 'console' = 'console',
    options?: { width?: number; height?: number },
  ) {
    const response = await fetch(
      `/1.0/instances/${encodeURIComponent(this.name)}/console`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: type,
          'wait-for-websocket': true,
          force: true,
          width: options?.width,
          height: options?.height,
        }),
      },
    );
    if (!response.ok) {
      let errorMessage = `Failed to open console socket: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage += ` - ${JSON.stringify(errorData)}`;
      } catch (e) {
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
      `/1.0/instances/${encodeURIComponent(this.name)}/console`,
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch console output: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return await response.text();
  }

  async openExecSocket(
    command: string[],
    options?: { width?: number; height?: number },
  ) {
    const response = await fetch(
      `/1.0/instances/${encodeURIComponent(this.name)}/exec`,
      {
        method: 'POST',
        body: JSON.stringify({
          command: command,
          interactive: true,
          'wait-for-websocket': true,
          width: options?.width,
          height: options?.height,
        }),
      },
    );
    if (!response.ok) {
      let errorMessage = `Failed to open exec socket: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage += ` - ${JSON.stringify(errorData)}`;
      } catch (e) {
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
}
