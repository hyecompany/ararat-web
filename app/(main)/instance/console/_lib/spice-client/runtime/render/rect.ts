/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { PresentRect } from './types.js';

export function clampRect(
  rect: PresentRect,
  maxWidth: number,
  maxHeight: number,
): PresentRect | null {
  const left = Math.max(0, Math.min(maxWidth, Math.floor(rect.left)));
  const top = Math.max(0, Math.min(maxHeight, Math.floor(rect.top)));
  const right = Math.max(left, Math.min(maxWidth, Math.ceil(rect.right)));
  const bottom = Math.max(top, Math.min(maxHeight, Math.ceil(rect.bottom)));
  if (right <= left || bottom <= top) {
    return null;
  }
  return { left, top, right, bottom };
}

export function uvRect(rect: PresentRect, width: number, height: number): PresentRect {
  return {
    left: rect.left / width,
    top: rect.top / height,
    right: rect.right / width,
    bottom: rect.bottom / height,
  };
}
