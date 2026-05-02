/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  GpuCommandEncoder,
  GpuDevice,
  GpuTexture,
} from './gpu-platform.js';
import { webGpuBufferUsage } from './gpu-platform.js';
import type { PresentRect } from './types.js';

export class GpuTextureRectPass {
  private sampler: unknown = null;
  private pipeline: unknown = null;
  private uniformBuffers: unknown[] = [];
  private uniformCursor = 0;
  private bindGroupsCreated = 0;

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
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.uniformBuffers = Array.from({ length: 8 }, () =>
      this.device.createBuffer({
        size: 16,
        usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST,
      }),
    );
    const shader = this.device.createShaderModule({ code: texturedQuadShader() });
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
    return Boolean(this.pipeline && this.sampler && this.uniformBuffers.length > 0);
  }

  render(
    texture: GpuTexture,
    targetView: unknown,
    dest: PresentRect,
    uv: PresentRect,
    encoder: GpuCommandEncoder,
  ) {
    if (!this.ready()) {
      return false;
    }
    const uniformBuffer = this.nextUniformBuffer();
    if (!uniformBuffer) {
      return false;
    }
    this.device.queue.writeBuffer?.(
      uniformBuffer,
      0,
      new Float32Array([uv.left, uv.top, uv.right, uv.bottom]),
    );
    const layout = (this.pipeline as { getBindGroupLayout?: (index: number) => unknown })
      .getBindGroupLayout?.(0);
    if (!layout) {
      return false;
    }
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });
    this.bindGroupsCreated += 1;
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

  snapshot() {
    return {
      bindGroupsCreated: this.bindGroupsCreated,
    };
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

function texturedQuadShader() {
  return `
struct Params {
  uvRect: vec4<f32>,
};

@group(0) @binding(0) var imageTex: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
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
  var baseUv = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0)
  );
  let uvMin = params.uvRect.xy;
  let uvMax = params.uvRect.zw;
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.uv = mix(uvMin, uvMax, baseUv[vertexIndex]);
  return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4<f32> {
  return textureSample(imageTex, imageSampler, input.uv);
}
`;
}
