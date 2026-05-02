/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { SessionCursorState } from './runtime/messages';

type CursorImage = NonNullable<Extract<SessionCursorState, { action: 'set' }>['cursor']>;

export class BrowserSpiceCursorAdapter {
  private readonly dataUrls = new Map<string, string>();
  private readonly overlay = document.createElement('img');
  private readonly cleanupCallbacks: Array<() => void> = [];
  private currentCursor: CursorImage | null = null;
  private usingOverlay = false;
  private pointerInside = false;
  private hasLastPosition = false;
  private lastClientX = 0;
  private lastClientY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.overlay.alt = '';
    this.overlay.draggable = false;
    this.overlay.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:2147483647',
      'pointer-events:none',
      'display:none',
      'max-width:none',
      'max-height:none',
      'image-rendering:auto',
    ].join(';');

    const onPointerEnter = (event: PointerEvent) => {
      this.pointerInside = true;
      this.updatePointerPosition(event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      this.pointerInside = true;
      this.updatePointerPosition(event.clientX, event.clientY);
    };
    const onPointerRawUpdate = (event: Event) => {
      onPointerMove(event as PointerEvent);
    };
    const onPointerLeave = () => {
      this.pointerInside = false;
      this.hideOverlay();
    };
    canvas.addEventListener('pointerenter', onPointerEnter, { passive: true });
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerrawupdate', onPointerRawUpdate, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
    this.cleanupCallbacks.push(() => {
      canvas.removeEventListener('pointerenter', onPointerEnter);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerrawupdate', onPointerRawUpdate);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    });
  }

  apply(payload: SessionCursorState) {
    switch (payload.action) {
      case 'set':
        this.applySet(payload.visible, payload.cursor, payload.position);
        break;
      case 'hide':
        this.applyHidden();
        break;
      case 'reset':
        this.currentCursor = null;
        this.usingOverlay = false;
        this.hideOverlay();
        this.canvas.style.cursor = 'default';
        break;
      case 'invalidate-one':
        this.dataUrls.delete(payload.unique);
        if (this.currentCursor?.unique === payload.unique) {
          this.currentCursor = null;
          this.usingOverlay = false;
          this.hideOverlay();
          this.canvas.style.cursor = 'default';
        }
        break;
      case 'invalidate-all':
        this.dataUrls.clear();
        this.currentCursor = null;
        this.usingOverlay = false;
        this.hideOverlay();
        this.canvas.style.cursor = 'default';
        break;
      case 'move':
        this.applyRemoteMove(payload.position);
        break;
      case 'trail':
        break;
    }
  }

  dispose() {
    this.dataUrls.clear();
    this.usingOverlay = false;
    this.hideOverlay();
    this.overlay.remove();
    for (const cleanup of this.cleanupCallbacks.splice(0)) {
      cleanup();
    }
    this.canvas.style.cursor = 'default';
  }

  private applySet(
    visible: boolean,
    cursor: CursorImage | null,
    position: { x: number; y: number },
  ) {
    this.currentCursor = cursor;
    if (!visible) {
      this.applyHidden();
      return;
    }
    if (!cursor) {
      this.usingOverlay = false;
      this.hideOverlay();
      this.canvas.style.cursor = 'default';
      return;
    }
    const url = this.cursorUrl(cursor);
    if (!url) {
      this.usingOverlay = false;
      this.hideOverlay();
      this.canvas.style.cursor = 'default';
      return;
    }

    if (cursor.width > 128 || cursor.height > 128) {
      this.useOverlayCursor(cursor, url);
      this.applyRemoteMove(position);
      return;
    }

    const cursorRule = `url("${url}") ${cursor.hotSpotX} ${cursor.hotSpotY}, default`;
    this.canvas.style.cursor = cursorRule;
    if (this.browserAcceptedCursorUrl()) {
      this.usingOverlay = false;
      this.hideOverlay();
      return;
    }

    this.useOverlayCursor(cursor, url);
    this.applyRemoteMove(position);
  }

  private applyHidden() {
    this.usingOverlay = false;
    this.hideOverlay();
    this.canvas.style.cursor = this.currentCursor ? 'none' : 'default';
  }

  private browserAcceptedCursorUrl() {
    try {
      return getComputedStyle(this.canvas).cursor.includes('url(');
    } catch {
      return false;
    }
  }

  private useOverlayCursor(cursor: CursorImage, url: string) {
    this.usingOverlay = true;
    this.canvas.style.cursor = 'none';
    this.overlay.src = url;
    this.overlay.style.width = `${cursor.width}px`;
    this.overlay.style.height = `${cursor.height}px`;
    if (!this.overlay.isConnected) {
      document.body.append(this.overlay);
    }
    this.updateOverlayPosition();
  }

  private applyRemoteMove(position: { x: number; y: number }) {
    if (!this.usingOverlay || this.pointerInside) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width > 0 ? rect.width / this.canvas.width : 1;
    const scaleY = this.canvas.height > 0 ? rect.height / this.canvas.height : 1;
    this.lastClientX = rect.left + position.x * scaleX;
    this.lastClientY = rect.top + position.y * scaleY;
    this.hasLastPosition = true;
    this.updateOverlayPosition();
  }

  private updatePointerPosition(clientX: number, clientY: number) {
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    this.hasLastPosition = true;
    this.updateOverlayPosition();
  }

  private updateOverlayPosition() {
    if (!this.usingOverlay || !this.currentCursor) {
      this.hideOverlay();
      return;
    }
    if (!this.hasLastPosition) {
      this.hideOverlay();
      return;
    }
    this.overlay.style.transform = `translate(${this.lastClientX - this.currentCursor.hotSpotX}px, ${this.lastClientY - this.currentCursor.hotSpotY}px)`;
    this.overlay.style.display = 'block';
  }

  private hideOverlay() {
    this.overlay.style.display = 'none';
  }

  private cursorUrl(cursor: CursorImage) {
    const cached = this.dataUrls.get(cursor.unique);
    if (cached) {
      return cached;
    }
    if (
      cursor.width <= 0 ||
      cursor.height <= 0 ||
      cursor.data.byteLength !== cursor.width * cursor.height * 4
    ) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = cursor.width;
    canvas.height = cursor.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.putImageData(
      new ImageData(new Uint8ClampedArray(cursor.data), cursor.width, cursor.height),
      0,
      0,
    );
    const url = canvas.toDataURL('image/png');
    this.dataUrls.set(cursor.unique, url);
    return url;
  }
}
