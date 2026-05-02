/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { GpuRopCopyPass } from './gpu-rop-copy-pass.js';
import { GpuSolidFillPass } from './gpu-solid-fill-pass.js';
import { GpuTextureRectPass } from './gpu-texture-rect-pass.js';
import {
  browserGpu,
  webGpuCanvasUsage,
  webGpuTextureUsage,
  type GpuCanvasContext,
  type GpuCommandEncoder,
  type GpuDevice,
  type GpuTexture,
} from './gpu-platform.js';
import { clampRect, uvRect } from './rect.js';
import type { DrawCopyComposeOptions, PresentRect } from './types.js';

export interface ConsoleRendererSnapshot {
  backend: 'webgpu' | 'offscreen-2d';
  width: number;
  height: number;
  presentsRequested: number;
  presentsCompleted: number;
  gpuMathOps: number;
  gpuMathArea: number;
}

interface PendingGpuRgbaUpdate {
  bytes: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  dest: PresentRect;
  src: PresentRect;
  compose: DrawCopyComposeOptions | null;
}

export class ConsoleRenderer {
  private width = 0;
  private height = 0;
  private presentsRequested = 0;
  private presentsCompleted = 0;
  private gpuMathOps = 0;
  private gpuMathArea = 0;
  private backend: ConsoleRendererSnapshot['backend'] = 'offscreen-2d';
  private context2d: OffscreenCanvasRenderingContext2D | null = null;
  private gpuDevice: GpuDevice | null = null;
  private gpuContext: GpuCanvasContext | null = null;
  private gpuFormat: string | null = null;
  private gpuSurfaceTexture: GpuTexture | null = null;
  private textureRectPass: GpuTextureRectPass | null = null;
  private ropCopyPass: GpuRopCopyPass | null = null;
  private solidFillPass: GpuSolidFillPass | null = null;
  private gpuCanvasPresentTimer: ReturnType<typeof setTimeout> | null = null;
  private gpuCanvasPresentPending = false;
  private gpuCanvasPresentationSuspended = false;
  private pendingGpuRgbaUpdates: PendingGpuRgbaUpdate[] = [];

  constructor(private readonly canvas: OffscreenCanvas) {}

  async initialize(options: { disableWebGpu?: boolean } = {}) {
    this.width = this.canvas.width || 1024;
    this.height = this.canvas.height || 768;
    if (!options.disableWebGpu && await this.tryInitializeWebGpu()) {
      this.backend = 'webgpu';
      this.presentClear(0, 0, 0, 1);
      return;
    }

    this.context2d = this.canvas.getContext('2d', { alpha: false });
    this.backend = 'offscreen-2d';
    this.presentClear(0, 0, 0, 1);
  }

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (nextWidth === this.width && nextHeight === this.height) {
      return;
    }
    this.width = nextWidth;
    this.height = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    if (this.gpuContext && this.gpuDevice) {
      const gpu = browserGpu();
      if (!gpu) {
        return;
      }
      this.gpuSurfaceTexture?.destroy();
      this.gpuSurfaceTexture = null;
      this.clearPendingGpuSurfaceUpdates();
      this.gpuContext.configure({
        device: this.gpuDevice,
        format: this.gpuFormat ?? gpu.getPreferredCanvasFormat(),
        alphaMode: 'opaque',
        usage: webGpuCanvasUsage(),
      });
    }
    this.presentClear(0, 0, 0, 1);
  }

  resetSurface(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    const sizeChanged = nextWidth !== this.width || nextHeight !== this.height;
    if (sizeChanged) {
      this.resize(nextWidth, nextHeight);
      return;
    }
    if (this.gpuSurfaceTexture) {
      this.gpuSurfaceTexture.destroy();
      this.gpuSurfaceTexture = null;
    }
    this.clearPendingGpuSurfaceUpdates();
    this.presentClear(0, 0, 0, 1);
  }

  setCanvasPresentationSuspended(suspended: boolean) {
    this.gpuCanvasPresentationSuspended = suspended;
    if (!suspended) {
      this.flushGpuSurfaceUpdates();
      this.flushGpuCanvasPresent();
    }
  }

  presentClear(red: number, green: number, blue: number, alpha: number) {
    this.presentsRequested += 1;
    if (this.backend === 'webgpu' && this.gpuDevice && this.gpuContext) {
      this.flushGpuSurfaceUpdates();
      this.clearPendingGpuSurfaceUpdates();
      this.ensureGpuSurfaceTexture();
      const encoder = this.gpuDevice.createCommandEncoder();
      if (this.gpuSurfaceTexture) {
        const surfacePass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: this.gpuSurfaceTexture.createView(),
              clearValue: { r: red, g: green, b: blue, a: alpha },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        surfacePass.end();
      }
      const canvasTexture = this.gpuContext.getCurrentTexture();
      const canvasPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: canvasTexture.createView(),
            clearValue: { r: red, g: green, b: blue, a: alpha },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      canvasPass.end();
      this.gpuDevice.queue.submit([encoder.finish()]);
      this.gpuMathOps += 1;
      this.gpuMathArea += this.width * this.height;
      this.gpuCanvasPresentPending = false;
      if (this.gpuCanvasPresentTimer !== null) {
        clearTimeout(this.gpuCanvasPresentTimer);
        this.gpuCanvasPresentTimer = null;
      }
    } else if (this.context2d) {
      this.context2d.fillStyle = `rgba(${Math.round(red * 255)}, ${Math.round(
        green * 255,
      )}, ${Math.round(blue * 255)}, ${alpha})`;
      this.context2d.fillRect(0, 0, this.width, this.height);
    }
    this.presentsCompleted += 1;
  }

  presentExternalImage(source: unknown, width: number, height: number) {
    return this.presentExternalImageRect(
      source,
      width,
      height,
      { left: 0, top: 0, right: width, bottom: height },
      null,
    );
  }

  copySurfaceRect(destRect: PresentRect, srcPos: { x: number; y: number }) {
    const dest = clampRect(destRect, this.width, this.height);
    if (!dest) {
      return false;
    }
    const width = dest.right - dest.left;
    const height = dest.bottom - dest.top;
    const src = clampRect(
      {
        left: srcPos.x,
        top: srcPos.y,
        right: srcPos.x + width,
        bottom: srcPos.y + height,
      },
      this.width,
      this.height,
    );
    if (!src) {
      return false;
    }

    this.presentsRequested += 1;
    if (
      this.backend === 'webgpu' &&
      this.gpuDevice &&
      this.gpuContext &&
      this.gpuFormat &&
      this.textureRectPass?.ready()
    ) {
      const copied = this.copyGpuSurfaceRect(dest, src);
      if (copied) {
        return true;
      }
    }

    if (this.context2d) {
      this.context2d.drawImage(
        this.canvas,
        src.left,
        src.top,
        src.right - src.left,
        src.bottom - src.top,
        dest.left,
        dest.top,
        width,
        height,
      );
      this.presentsCompleted += 1;
      return true;
    }
    return false;
  }

  fillRect(destRect: PresentRect, color: number) {
    const dest = clampRect(destRect, this.width, this.height);
    if (!dest) {
      return false;
    }
    this.presentsRequested += 1;
    if (
      this.backend === 'webgpu' &&
      this.gpuDevice &&
      this.gpuContext &&
      this.solidFillPass?.ready()
    ) {
      this.ensureGpuSurfaceTexture();
      if (!this.gpuSurfaceTexture) {
        return false;
      }
      const encoder = this.gpuDevice.createCommandEncoder();
      const rendered = this.solidFillPass.render(
        this.gpuSurfaceTexture.createView(),
        dest,
        spiceColorToRgba(color),
        encoder,
      );
      if (!rendered) {
        return false;
      }
      this.gpuDevice.queue.submit([encoder.finish()]);
      this.scheduleGpuCanvasPresent();
      this.gpuMathOps += 1;
      this.gpuMathArea += (dest.right - dest.left) * (dest.bottom - dest.top);
      this.presentsCompleted += 1;
      return true;
    }
    if (this.context2d) {
      const [red, green, blue, alpha] = spiceColorToRgba(color);
      this.context2d.fillStyle = `rgba(${Math.round(red * 255)}, ${Math.round(
        green * 255,
      )}, ${Math.round(blue * 255)}, ${alpha})`;
      this.context2d.fillRect(dest.left, dest.top, dest.right - dest.left, dest.bottom - dest.top);
      this.presentsCompleted += 1;
      return true;
    }
    return false;
  }

  presentRgbaRect(
    bytes: Uint8Array,
    width: number,
    height: number,
    destRect: PresentRect,
    srcRect: PresentRect | null,
    compose: DrawCopyComposeOptions | null = null,
  ) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (bytes.byteLength !== safeWidth * safeHeight * 4) {
      return false;
    }
    const dest = clampRect(destRect, this.width, this.height);
    if (!dest) {
      return false;
    }
    const src = clampRect(srcRect ?? { left: 0, top: 0, right: safeWidth, bottom: safeHeight }, safeWidth, safeHeight);
    if (!src) {
      return false;
    }
    this.presentsRequested += 1;
    if (
      this.backend === 'webgpu' &&
      this.gpuDevice?.queue.writeTexture &&
      this.gpuContext &&
      this.hasGpuComposePath(compose)
    ) {
      const presented = this.presentGpuRgba(bytes, safeWidth, safeHeight, dest, src, compose);
      if (presented) {
        return true;
      }
    }
    if (this.context2d && isSimplePutCompose(compose)) {
      const temp = new OffscreenCanvas(safeWidth, safeHeight);
      const tempContext = temp.getContext('2d', { alpha: false });
      if (!tempContext) {
        return false;
      }
      tempContext.putImageData(
        new ImageData(
          new Uint8ClampedArray(bytes),
          safeWidth,
          safeHeight,
        ),
        0,
        0,
      );
      this.context2d.drawImage(
        temp,
        src.left,
        src.top,
        src.right - src.left,
        src.bottom - src.top,
        dest.left,
        dest.top,
        dest.right - dest.left,
        dest.bottom - dest.top,
      );
      this.presentsCompleted += 1;
      return true;
    }
    return false;
  }

  presentExternalImageRect(
    source: unknown,
    width: number,
    height: number,
    destRect: PresentRect,
    srcRect: PresentRect | null,
    compose: DrawCopyComposeOptions | null = null,
  ) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const dest = clampRect(destRect, this.width, this.height);
    if (!dest) {
      return false;
    }
    const src = clampRect(srcRect ?? { left: 0, top: 0, right: safeWidth, bottom: safeHeight }, safeWidth, safeHeight);
    if (!src) {
      return false;
    }
    this.presentsRequested += 1;
    if (
      this.backend === 'webgpu' &&
      this.gpuDevice?.queue.copyExternalImageToTexture &&
      this.gpuDevice.queue.writeBuffer &&
      this.gpuContext &&
      this.gpuFormat &&
      this.hasGpuComposePath(compose)
    ) {
      const presented = this.presentGpuExternalImage(source, safeWidth, safeHeight, dest, src, compose);
      if (presented) {
        return true;
      }
    }
    if (this.context2d && isCanvasImageSource(source) && isSimplePutCompose(compose)) {
      this.context2d.drawImage(
        source,
        src.left,
        src.top,
        src.right - src.left,
        src.bottom - src.top,
        dest.left,
        dest.top,
        dest.right - dest.left,
        dest.bottom - dest.top,
      );
      this.presentsCompleted += 1;
      return true;
    }
    return false;
  }

  snapshot(): ConsoleRendererSnapshot {
    return {
      backend: this.backend,
      width: this.width,
      height: this.height,
      presentsRequested: this.presentsRequested,
      presentsCompleted: this.presentsCompleted,
      gpuMathOps: this.gpuMathOps,
      gpuMathArea: this.gpuMathArea,
    };
  }

  dispose() {
    if (this.gpuCanvasPresentTimer !== null) {
      clearTimeout(this.gpuCanvasPresentTimer);
      this.gpuCanvasPresentTimer = null;
    }
    this.clearPendingGpuSurfaceUpdates();
    this.gpuCanvasPresentPending = false;
    this.gpuSurfaceTexture?.destroy();
    this.gpuSurfaceTexture = null;
    this.gpuDevice?.destroy();
    this.gpuDevice = null;
    this.gpuContext = null;
    this.textureRectPass = null;
    this.ropCopyPass = null;
    this.solidFillPass = null;
    this.context2d = null;
  }

  private async tryInitializeWebGpu() {
    if (typeof navigator === 'undefined') {
      return false;
    }
    const gpu = browserGpu();
    if (!gpu) {
      return false;
    }
    const adapter = await gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) {
      return false;
    }
    const device = await adapter.requestDevice();
    if (!device.queue.copyExternalImageToTexture || !device.queue.writeBuffer) {
      device.destroy();
      return false;
    }
    const context = this.canvas.getContext('webgpu') as unknown as GpuCanvasContext | null;
    if (!context) {
      device.destroy();
      return false;
    }
    const format = gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'opaque',
      usage: webGpuCanvasUsage(),
    });
    this.gpuDevice = device;
    this.gpuContext = context;
    this.gpuFormat = format;
    this.ensureGpuTextureRectPass();
    this.ensureGpuRopCopyPass();
    this.ensureGpuSolidFillPass();
    return true;
  }

  private ensureGpuSurfaceTexture() {
    if (!this.gpuDevice || !this.gpuFormat || this.gpuSurfaceTexture) {
      return;
    }
    const usage = webGpuTextureUsage();
    if (!usage) {
      return;
    }
    this.gpuSurfaceTexture = this.gpuDevice.createTexture({
      size: [this.width, this.height],
      format: this.gpuFormat,
      usage:
        usage.RENDER_ATTACHMENT |
        usage.TEXTURE_BINDING |
        usage.COPY_DST |
        usage.COPY_SRC,
    });
  }

  private ensureGpuTextureRectPass() {
    if (!this.gpuDevice || !this.gpuFormat || this.textureRectPass) {
      return;
    }
    const pass = new GpuTextureRectPass(this.gpuDevice, this.gpuFormat);
    if (!pass.initialize()) {
      return;
    }
    this.textureRectPass = pass;
  }

  private ensureGpuRopCopyPass() {
    if (!this.gpuDevice || !this.gpuFormat || this.ropCopyPass) {
      return;
    }
    const pass = new GpuRopCopyPass(this.gpuDevice, this.gpuFormat);
    if (!pass.initialize()) {
      return;
    }
    this.ropCopyPass = pass;
  }

  private ensureGpuSolidFillPass() {
    if (!this.gpuDevice || !this.gpuFormat || this.solidFillPass) {
      return;
    }
    const pass = new GpuSolidFillPass(this.gpuDevice, this.gpuFormat);
    if (!pass.initialize()) {
      return;
    }
    this.solidFillPass = pass;
  }

  private presentGpuExternalImage(
    source: unknown,
    sourceWidth: number,
    sourceHeight: number,
    dest: PresentRect,
    src: PresentRect,
    compose: DrawCopyComposeOptions | null,
  ) {
    if (
      !this.gpuDevice ||
      !this.gpuContext ||
      !this.gpuFormat ||
      !this.hasGpuComposePath(compose)
    ) {
      return false;
    }
    this.ensureGpuSurfaceTexture();
    if (!this.gpuSurfaceTexture) {
      return false;
    }
    const usage = webGpuTextureUsage();
    if (!usage) {
      return false;
    }
    const uploadTexture = this.gpuDevice.createTexture({
      size: [sourceWidth, sourceHeight],
      format: this.gpuFormat,
      usage: usage.TEXTURE_BINDING | usage.COPY_DST,
    });
    this.gpuDevice.queue.copyExternalImageToTexture?.(
      { source },
      { texture: uploadTexture },
      [sourceWidth, sourceHeight],
    );

    const encoder = this.gpuDevice.createCommandEncoder();
    const scratchTextures: GpuTexture[] = [];
    const rendered = this.renderComposedTextureRect(
      uploadTexture,
      this.gpuSurfaceTexture.createView(),
      dest,
      uvRect(src, sourceWidth, sourceHeight),
      encoder,
      compose,
      scratchTextures,
    );
    if (!rendered) {
      uploadTexture.destroy();
      for (const texture of scratchTextures) {
        texture.destroy();
      }
      return false;
    }
    this.gpuDevice.queue.submit([encoder.finish()]);
    this.destroyTextureAfterSubmit(uploadTexture);
    for (const texture of scratchTextures) {
      this.destroyTextureAfterSubmit(texture);
    }
    this.scheduleGpuCanvasPresent();
    this.gpuMathOps += 1;
    this.gpuMathArea += (dest.right - dest.left) * (dest.bottom - dest.top);
    this.presentsCompleted += 1;
    return true;
  }

  private presentGpuRgba(
    bytes: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    dest: PresentRect,
    src: PresentRect,
    compose: DrawCopyComposeOptions | null,
  ) {
    if (
      !this.gpuDevice ||
      !this.gpuContext ||
      !this.hasGpuComposePath(compose)
    ) {
      return false;
    }
    this.ensureGpuSurfaceTexture();
    if (!this.gpuSurfaceTexture) {
      return false;
    }
    this.pendingGpuRgbaUpdates.push({
      bytes,
      sourceWidth,
      sourceHeight,
      dest,
      src,
      compose,
    });
    this.flushGpuSurfaceUpdates();
    this.gpuMathOps += 1;
    this.gpuMathArea += (dest.right - dest.left) * (dest.bottom - dest.top);
    this.presentsCompleted += 1;
    return true;
  }

  private copyGpuSurfaceRect(dest: PresentRect, src: PresentRect) {
    if (
      !this.gpuDevice ||
      !this.gpuSurfaceTexture ||
      !this.gpuFormat ||
      !this.gpuDevice.queue.writeBuffer
    ) {
      return false;
    }
    const usage = webGpuTextureUsage();
    if (!usage) {
      return false;
    }
    this.flushGpuSurfaceUpdates();

    const width = src.right - src.left;
    const height = src.bottom - src.top;
    const tempTexture = this.gpuDevice.createTexture({
      size: [width, height],
      format: this.gpuFormat,
      usage: usage.COPY_DST | usage.TEXTURE_BINDING,
    });
    const encoder = this.gpuDevice.createCommandEncoder();
    if (!encoder.copyTextureToTexture) {
      tempTexture.destroy();
      return false;
    }
    encoder.copyTextureToTexture(
      { texture: this.gpuSurfaceTexture, origin: { x: src.left, y: src.top } },
      { texture: tempTexture },
      [width, height],
    );
    this.renderTextureRect(
      tempTexture,
      this.gpuSurfaceTexture.createView(),
      dest,
      { left: 0, top: 0, right: 1, bottom: 1 },
      encoder,
    );
    this.gpuDevice.queue.submit([encoder.finish()]);
    this.destroyTextureAfterSubmit(tempTexture);
    this.scheduleGpuCanvasPresent();
    this.gpuMathOps += 1;
    this.gpuMathArea += width * height;
    this.presentsCompleted += 1;
    return true;
  }

  private flushGpuSurfaceUpdates() {
    if (
      this.pendingGpuRgbaUpdates.length === 0 ||
      !this.gpuDevice ||
      !this.gpuSurfaceTexture
    ) {
      return;
    }
    const usage = webGpuTextureUsage();
    if (!usage) {
      this.clearPendingGpuSurfaceUpdates();
      return;
    }
    const updates = this.pendingGpuRgbaUpdates.splice(0);
    const uploadTextures: GpuTexture[] = [];
    const scratchTextures: GpuTexture[] = [];
    const encoder = this.gpuDevice.createCommandEncoder();
    const surfaceView = this.gpuSurfaceTexture.createView();

    for (const update of updates) {
      const uploadTexture = this.gpuDevice.createTexture({
        size: [update.sourceWidth, update.sourceHeight],
        format: 'rgba8unorm',
        usage: usage.TEXTURE_BINDING | usage.COPY_DST,
      });
      uploadTextures.push(uploadTexture);
      this.gpuDevice.queue.writeTexture?.(
        { texture: uploadTexture },
        update.bytes as unknown as BufferSource,
        { bytesPerRow: update.sourceWidth * 4, rowsPerImage: update.sourceHeight },
        [update.sourceWidth, update.sourceHeight],
      );
      this.renderComposedTextureRect(
        uploadTexture,
        surfaceView,
        update.dest,
        uvRect(update.src, update.sourceWidth, update.sourceHeight),
        encoder,
        update.compose,
        scratchTextures,
      );
    }

    this.gpuDevice.queue.submit([encoder.finish()]);
    for (const texture of uploadTextures) {
      this.destroyTextureAfterSubmit(texture);
    }
    for (const texture of scratchTextures) {
      this.destroyTextureAfterSubmit(texture);
    }
    this.scheduleGpuCanvasPresent();
  }

  private clearPendingGpuSurfaceUpdates() {
    this.pendingGpuRgbaUpdates = [];
  }

  private scheduleGpuCanvasPresent() {
    if (this.gpuCanvasPresentPending) {
      return;
    }
    this.gpuCanvasPresentPending = true;
    if (this.gpuCanvasPresentationSuspended) {
      return;
    }
    this.gpuCanvasPresentTimer = setTimeout(() => {
      this.gpuCanvasPresentTimer = null;
      this.flushGpuCanvasPresent();
    }, 8);
  }

  private flushGpuCanvasPresent() {
    if (
      !this.gpuCanvasPresentPending ||
      !this.gpuDevice ||
      !this.gpuContext ||
      !this.gpuSurfaceTexture
    ) {
      this.gpuCanvasPresentPending = false;
      return;
    }
    this.gpuCanvasPresentPending = false;
    const encoder = this.gpuDevice.createCommandEncoder();
    this.renderTextureRect(
      this.gpuSurfaceTexture,
      this.gpuContext.getCurrentTexture().createView(),
      { left: 0, top: 0, right: this.width, bottom: this.height },
      { left: 0, top: 0, right: 1, bottom: 1 },
      encoder,
    );
    this.gpuDevice.queue.submit([encoder.finish()]);
    this.gpuMathOps += 1;
    this.gpuMathArea += this.width * this.height;
  }

  private destroyTextureAfterSubmit(texture: GpuTexture) {
    const done = this.gpuDevice?.queue.onSubmittedWorkDone?.();
    if (done) {
      void done.finally(() => texture.destroy());
      return;
    }
    setTimeout(() => texture.destroy(), 250);
  }

  private renderTextureRect(
    texture: GpuTexture,
    targetView: unknown,
    dest: PresentRect,
    uv: PresentRect,
    encoder: GpuCommandEncoder,
  ) {
    return this.textureRectPass?.render(texture, targetView, dest, uv, encoder) ?? false;
  }

  private renderComposedTextureRect(
    texture: GpuTexture,
    targetView: unknown,
    dest: PresentRect,
    uv: PresentRect,
    encoder: GpuCommandEncoder,
    compose: DrawCopyComposeOptions | null,
    scratchTextures: GpuTexture[],
  ) {
    if (compose?.maskPresent) {
      return false;
    }
    if (isSimplePutCompose(compose)) {
      return this.renderTextureRect(texture, targetView, dest, uv, encoder);
    }
    if (
      !this.gpuDevice ||
      !this.gpuSurfaceTexture ||
      !this.gpuFormat ||
      !this.ropCopyPass?.ready() ||
      !encoder.copyTextureToTexture
    ) {
      return false;
    }
    const usage = webGpuTextureUsage();
    if (!usage) {
      return false;
    }
    const width = dest.right - dest.left;
    const height = dest.bottom - dest.top;
    const destSnapshot = this.gpuDevice.createTexture({
      size: [width, height],
      format: this.gpuFormat,
      usage: usage.COPY_DST | usage.TEXTURE_BINDING,
    });
    scratchTextures.push(destSnapshot);
    encoder.copyTextureToTexture(
      { texture: this.gpuSurfaceTexture, origin: { x: dest.left, y: dest.top } },
      { texture: destSnapshot },
      [width, height],
    );
    return this.ropCopyPass.render(
      texture,
      destSnapshot,
      targetView,
      dest,
      uv,
      normalizeRopDescriptor(compose),
      encoder,
    );
  }

  private hasGpuComposePath(compose: DrawCopyComposeOptions | null) {
    if (compose?.maskPresent) {
      return false;
    }
    if (isSimplePutCompose(compose)) {
      return this.textureRectPass?.ready() === true;
    }
    return this.ropCopyPass?.ready() === true;
  }
}

function isCanvasImageSource(source: unknown): source is CanvasImageSource {
  return typeof source === 'object' && source !== null;
}

function isSimplePutCompose(compose: DrawCopyComposeOptions | null) {
  return !compose?.maskPresent && normalizeRopDescriptor(compose) === 8;
}

function normalizeRopDescriptor(compose: DrawCopyComposeOptions | null) {
  const rop = compose?.ropDescriptor;
  return typeof rop === 'number' && Number.isFinite(rop)
    ? Math.max(0, Math.floor(rop))
    : 8;
}

function spiceColorToRgba(color: number): [number, number, number, number] {
  const safe = Math.max(0, Math.floor(color)) >>> 0;
  return [
    ((safe >> 16) & 0xff) / 255,
    ((safe >> 8) & 0xff) / 255,
    (safe & 0xff) / 255,
    1,
  ];
}
