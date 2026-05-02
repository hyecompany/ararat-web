/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export interface BrowserGpu {
  requestAdapter(options?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<GpuAdapter | null>;
  getPreferredCanvasFormat(): string;
}

export interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>;
}

export interface GpuDevice {
  queue: {
    submit(commandBuffers: unknown[]): void;
    onSubmittedWorkDone?(): Promise<void>;
    writeTexture?(
      destination: { texture: unknown; origin?: { x: number; y: number } },
      data: BufferSource,
      dataLayout: { offset?: number; bytesPerRow: number; rowsPerImage?: number },
      copySize: [number, number] | { width: number; height: number },
    ): void;
    copyExternalImageToTexture?(
      source: { source: unknown },
      destination: { texture: unknown; origin?: { x: number; y: number } },
      copySize: [number, number] | { width: number; height: number },
    ): void;
    writeBuffer?(buffer: unknown, bufferOffset: number, data: BufferSource): void;
  };
  createCommandEncoder(): GpuCommandEncoder;
  createTexture(descriptor: unknown): GpuTexture;
  createShaderModule(descriptor: { code: string }): unknown;
  createRenderPipeline(descriptor: unknown): unknown;
  createSampler(descriptor: unknown): unknown;
  createBuffer(descriptor: unknown): unknown;
  createBindGroup(descriptor: unknown): unknown;
  destroy(): void;
}

export interface GpuRenderPass {
  setPipeline?: (pipeline: unknown) => void;
  setBindGroup?: (index: number, bindGroup: unknown) => void;
  setViewport?: (
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ) => void;
  setScissorRect?: (x: number, y: number, width: number, height: number) => void;
  draw?: (vertexCount: number) => void;
  end(): void;
}

export interface GpuCommandEncoder {
  beginRenderPass(descriptor: unknown): GpuRenderPass;
  copyTextureToTexture?(
    source: { texture: unknown; origin?: { x: number; y: number } },
    destination: { texture: unknown; origin?: { x: number; y: number } },
    copySize: [number, number] | { width: number; height: number },
  ): void;
  finish(): unknown;
}

export interface GpuCanvasContext {
  configure(configuration: {
    device: GpuDevice;
    format: string;
    alphaMode: 'opaque';
    usage?: number;
  }): void;
  getCurrentTexture(): { createView(): unknown };
}

export interface GpuTexture {
  createView(): unknown;
  destroy(): void;
}

export function browserGpu(): BrowserGpu | null {
  return (navigator as unknown as { gpu?: BrowserGpu }).gpu ?? null;
}

export function webGpuCanvasUsage() {
  const usage = (
    globalThis as {
      GPUTextureUsage?: { RENDER_ATTACHMENT: number; COPY_DST: number };
    }
  ).GPUTextureUsage;
  return usage ? usage.RENDER_ATTACHMENT | usage.COPY_DST : undefined;
}

export function webGpuTextureUsage() {
  return (
    globalThis as {
      GPUTextureUsage?: {
        RENDER_ATTACHMENT: number;
        TEXTURE_BINDING: number;
        COPY_SRC: number;
        COPY_DST: number;
      };
    }
  ).GPUTextureUsage;
}

export function webGpuBufferUsage() {
  return (
    globalThis as {
      GPUBufferUsage?: {
        UNIFORM: number;
        COPY_DST: number;
      };
    }
  ).GPUBufferUsage;
}
