/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { SessionControlMessage } from './runtime/messages';

interface PendingPointerMove {
  x: number;
  y: number;
  movementX: number;
  movementY: number;
  buttons: number;
}

interface CanvasProjection {
  backingWidth: number;
  backingHeight: number;
  contentLeft: number;
  contentTop: number;
  contentWidth: number;
  contentHeight: number;
}

export interface BrowserSpiceInputAdapterOptions {
  canvas: HTMLCanvasElement;
  postControl: (message: SessionControlMessage, transfer?: ArrayBuffer[]) => void;
  sendFiles: (files: File[]) => void;
}

export class BrowserSpiceInputAdapter {
  private readonly cleanupCallbacks: Array<() => void> = [];
  private pointerMoveFlushTimer: number | null = null;
  private queuedPointerMove: PendingPointerMove | null = null;
  private keyboardActive = false;
  private readonly pressedKeys = new Set<string>();
  private attached = false;
  private displayWidth: number | null = null;
  private displayHeight: number | null = null;

  constructor(private readonly options: BrowserSpiceInputAdapterOptions) {}

  setDisplaySize(width: number, height: number) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.displayWidth = safeWidth;
    this.displayHeight = safeHeight;
  }

  attach() {
    if (this.attached) {
      return;
    }
    this.attached = true;
    const canvas = this.options.canvas;
    canvas.tabIndex = 0;
    canvas.style.touchAction = 'none';

    const cleanupWindow = <K extends keyof WindowEventMap>(
      type: K,
      listener: (event: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      window.addEventListener(type, listener, options);
      this.cleanupCallbacks.push(() => window.removeEventListener(type, listener, options));
    };
    const cleanupCanvas = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, listener, options);
      this.cleanupCallbacks.push(() => canvas.removeEventListener(type, listener, options));
    };

    cleanupCanvas('contextmenu', (event) => event.preventDefault());
    cleanupCanvas('pointerdown', (event) => {
      const pointerEvent = event as PointerEvent;
      canvas.focus();
      this.keyboardActive = true;
      this.queuePointerMove(pointerEvent);
      this.flushQueuedPointerMove();
      canvas.setPointerCapture?.(pointerEvent.pointerId);
      this.postPointerButton({
        button: pointerEvent.button,
        pressed: true,
        buttons: pointerEvent.buttons,
      });
    });
    cleanupCanvas('pointerup', (event) => {
      const pointerEvent = event as PointerEvent;
      this.queuePointerMove(pointerEvent);
      this.flushQueuedPointerMove();
      canvas.releasePointerCapture?.(pointerEvent.pointerId);
      this.postPointerButton({
        button: pointerEvent.button,
        pressed: false,
        buttons: pointerEvent.buttons,
      });
    });
    cleanupCanvas('pointerleave', () => {
      this.flushQueuedPointerMove();
      this.options.postControl({ type: 'mouse_leave' });
    });
    const pointerMoveEventName =
      'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    cleanupCanvas(pointerMoveEventName as keyof HTMLElementEventMap, (event) => {
      this.queuePointerMove(event as PointerEvent);
    }, { passive: true });
    cleanupCanvas('wheel', (event) => {
      const wheelEvent = event as WheelEvent;
      if (wheelEvent.deltaY === 0) {
        return;
      }
      wheelEvent.preventDefault();
      canvas.focus();
      this.keyboardActive = true;
      this.flushQueuedPointerMove();
      this.options.postControl({
        type: 'mouse_wheel',
        payload: { direction: wheelEvent.deltaY < 0 ? 'up' : 'down', buttons: 0 },
      });
    }, { passive: false });
    cleanupCanvas('dragover', (event) => {
      const dragEvent = event as DragEvent;
      if ((dragEvent.dataTransfer?.files.length ?? 0) > 0) {
        dragEvent.preventDefault();
      }
    }, { passive: false });
    cleanupCanvas('drop', (event) => {
      const dragEvent = event as DragEvent;
      const files = Array.from(dragEvent.dataTransfer?.files ?? []);
      if (files.length === 0) {
        return;
      }
      dragEvent.preventDefault();
      canvas.focus();
      this.keyboardActive = true;
      this.options.sendFiles(files);
    }, { passive: false });
    cleanupCanvas('focus', () => {
      this.keyboardActive = true;
    });
    cleanupWindow('keydown', (event) => {
      if (!this.keyboardActive) {
        return;
      }
      const keyboardEvent = event as KeyboardEvent;
      keyboardEvent.preventDefault();
      this.pressedKeys.add(keyboardEvent.code);
      this.options.postControl({
        type: 'key',
        payload: {
          code: keyboardEvent.code,
          key: keyboardEvent.key,
          down: true,
          repeat: keyboardEvent.repeat,
          modifiers: keyboardLockModifiers(keyboardEvent),
        },
      });
    }, { capture: true });
    cleanupWindow('keyup', (event) => {
      if (!this.keyboardActive) {
        return;
      }
      const keyboardEvent = event as KeyboardEvent;
      keyboardEvent.preventDefault();
      this.pressedKeys.delete(keyboardEvent.code);
      this.options.postControl({
        type: 'key',
        payload: {
          code: keyboardEvent.code,
          key: keyboardEvent.key,
          down: false,
          repeat: keyboardEvent.repeat,
          modifiers: keyboardLockModifiers(keyboardEvent),
        },
      });
    }, { capture: true });
    cleanupWindow('blur', () => {
      for (const code of this.pressedKeys) {
        this.options.postControl({
          type: 'key',
          payload: { code, key: code, down: false, repeat: false },
        });
      }
      this.pressedKeys.clear();
      this.keyboardActive = false;
    });
  }

  dispose() {
    if (this.pointerMoveFlushTimer !== null) {
      window.clearTimeout(this.pointerMoveFlushTimer);
      this.pointerMoveFlushTimer = null;
    }
    for (const cleanup of this.cleanupCallbacks.splice(0)) {
      cleanup();
    }
    this.queuedPointerMove = null;
    this.pressedKeys.clear();
    this.keyboardActive = false;
    this.attached = false;
  }

  rightClick() {
    this.postPointerButton({ button: 2, pressed: true, buttons: 2 });
    this.postPointerButton({ button: 2, pressed: false, buttons: 0 });
  }

  pressEscape() {
    this.options.postControl({
      type: 'key',
      payload: { code: 'Escape', key: 'Escape', down: true, repeat: false },
    });
    this.options.postControl({
      type: 'key',
      payload: { code: 'Escape', key: 'Escape', down: false, repeat: false },
    });
  }

  private queuePointerMove(pointerEvent: PointerEvent) {
    const coords = this.projectPointer(pointerEvent);
    const next: PendingPointerMove = {
      ...coords,
      buttons: pointerEvent.buttons,
    };
    this.queuedPointerMove = this.queuedPointerMove
      ? {
          x: next.x,
          y: next.y,
          movementX: this.queuedPointerMove.movementX + next.movementX,
          movementY: this.queuedPointerMove.movementY + next.movementY,
          buttons: next.buttons,
        }
      : next;
    if (this.pointerMoveFlushTimer !== null) {
      return;
    }
    this.pointerMoveFlushTimer = window.setTimeout(() => {
      this.pointerMoveFlushTimer = null;
      this.flushQueuedPointerMove();
    }, 0);
  }

  private flushQueuedPointerMove() {
    if (this.pointerMoveFlushTimer !== null) {
      window.clearTimeout(this.pointerMoveFlushTimer);
      this.pointerMoveFlushTimer = null;
    }
    const payload = this.queuedPointerMove;
    this.queuedPointerMove = null;
    if (payload) {
      this.options.postControl({ type: 'mouse_move', payload });
    }
  }

  private postPointerButton(payload: { button: number; pressed: boolean; buttons: number }) {
    this.options.postControl({ type: 'mouse_button', payload });
  }

  private projectPointer(pointerEvent: PointerEvent) {
    const projection = this.canvasProjection();
    const scaleX =
      projection.contentWidth > 0
        ? projection.backingWidth / projection.contentWidth
        : 1;
    const scaleY =
      projection.contentHeight > 0
        ? projection.backingHeight / projection.contentHeight
        : 1;
    return {
      x: clampCanvasCoordinate(
        Math.round((pointerEvent.clientX - projection.contentLeft) * scaleX),
        projection.backingWidth,
      ),
      y: clampCanvasCoordinate(
        Math.round((pointerEvent.clientY - projection.contentTop) * scaleY),
        projection.backingHeight,
      ),
      movementX: Math.round(pointerEvent.movementX * scaleX),
      movementY: Math.round(pointerEvent.movementY * scaleY),
    };
  }

  private canvasProjection(): CanvasProjection {
    const canvas = this.options.canvas;
    const rect = canvas.getBoundingClientRect();
    const backingWidth = Math.max(
      1,
      (this.displayWidth ?? canvas.width) || Math.round(rect.width) || 1,
    );
    const backingHeight = Math.max(
      1,
      (this.displayHeight ?? canvas.height) || Math.round(rect.height) || 1,
    );
    if (rect.width <= 0 || rect.height <= 0) {
      return {
        backingWidth,
        backingHeight,
        contentLeft: rect.left,
        contentTop: rect.top,
        contentWidth: backingWidth,
        contentHeight: backingHeight,
      };
    }

    const objectFit = getComputedStyle(canvas).objectFit;
    if (objectFit === 'fill') {
      return {
        backingWidth,
        backingHeight,
        contentLeft: rect.left,
        contentTop: rect.top,
        contentWidth: rect.width,
        contentHeight: rect.height,
      };
    }

    const scale =
      objectFit === 'cover'
        ? Math.max(rect.width / backingWidth, rect.height / backingHeight)
        : Math.min(rect.width / backingWidth, rect.height / backingHeight);
    const contentWidth = backingWidth * scale;
    const contentHeight = backingHeight * scale;
    return {
      backingWidth,
      backingHeight,
      contentLeft: rect.left + (rect.width - contentWidth) / 2,
      contentTop: rect.top + (rect.height - contentHeight) / 2,
      contentWidth,
      contentHeight,
    };
  }
}

function clampCanvasCoordinate(value: number, size: number) {
  return Math.max(0, Math.min(Math.max(0, size - 1), value));
}

function keyboardLockModifiers(event: KeyboardEvent) {
  let modifiers = 0;
  try {
    if (event.getModifierState('ScrollLock')) modifiers |= 1 << 0;
    if (event.getModifierState('NumLock')) modifiers |= 1 << 1;
    if (event.getModifierState('CapsLock')) modifiers |= 1 << 2;
  } catch {
    return 0;
  }
  return modifiers;
}
