/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { GpuCommandEncoder, GpuDevice } from './gpu-platform.js';
import { webGpuBufferUsage } from './gpu-platform.js';
import type { PresentRect } from './types.js';

export class GpuSolidFillPass {
  private pipeline: unknown = null;
  private uniformBuffers: unknown[] = [];
  private uniformCursor = 0;

  constructor(
    private readonly device: GpuDevice,
    private readonly format: string,
  ) {}

  initialize() {
    if (this.pipeline) {
      return true;
    }
    const bufferUsage = webGpuBufferUsage();
    if (!bufferUsage) {
      return false;
    }
    this.uniformBuffers = Array.from({ length: 8 }, () =>
      this.device.createBuffer({
        size: 16,
        usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
      }),
    );
    const shader = this.device.createShaderModule({ code: solidFillShader() });
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vsMain',
      },
      fragment: {
        module: shader,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    return true;
  }

  ready() {
    return Boolean(this.pipeline && this.uniformBuffers.length > 0);
  }

  render(targetView: unknown, dest: PresentRect, rgba: [number, number, number, number], encoder: GpuCommandEncoder) {
    if (!this.ready()) {
      return false;
    }
    const uniformBuffer = this.nextUniformBuffer();
    if (!uniformBuffer) {
      return false;
    }
    this.device.queue.writeBuffer?.(uniformBuffer, 0, new Float32Array(rgba));
    const layout = (this.pipeline as { getBindGroupLayout?: (index: number) => unknown })
      .getBindGroupLayout?.(0);
    if (!layout) {
      return false;
    }
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline?.(this.pipeline);
    pass.setBindGroup?.(0, bindGroup);
    const width = dest.right - dest.left;
    const height = dest.bottom - dest.top;
    pass.setViewport?.(dest.left, dest.top, width, height, 0, 1);
    pass.setScissorRect?.(dest.left, dest.top, width, height);
    pass.draw?.(6);
    pass.end();
    return true;
  }

  private nextUniformBuffer() {
    if (this.uniformBuffers.length === 0) {
      return null;
    }
    const buffer = this.uniformBuffers[this.uniformCursor % this.uniformBuffers.length];
    this.uniformCursor = (this.uniformCursor + 1) % this.uniformBuffers.length;
    return buffer;
  }
}

function solidFillShader() {
  return `
struct Params {
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return out;
}

@fragment
fn fsMain() -> @location(0) vec4<f32> {
  return params.color;
}
`;
}
