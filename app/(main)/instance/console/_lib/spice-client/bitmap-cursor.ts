/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { SpiceBitmapFormat } from './runtime/constants';

interface BitmapCursorPayload {
  format: number;
  width: number;
  height: number;
  stride: number;
  data: Uint8Array;
}

function clampRows(bitmap: BitmapCursorPayload) {
  if (bitmap.stride <= 0) {
    return 0;
  }

  return Math.min(bitmap.height, Math.floor(bitmap.data.byteLength / bitmap.stride));
}

function sourceRowIndex(bitmap: BitmapCursorPayload, row: number, rows: number) {
  const topDown = true;
  return (topDown ? row : rows - 1 - row) * bitmap.stride;
}

export function decodeCursorBitmap(bitmap: BitmapCursorPayload) {
  const rows = clampRows(bitmap);
  if (rows === 0 || bitmap.width <= 0) {
    return null;
  }

  const pixels = new Uint8ClampedArray(bitmap.width * rows * 4);

  switch (bitmap.format) {
    case SpiceBitmapFormat.BIT_16: {
      for (let row = 0; row < rows; row += 1) {
        const srcRow = sourceRowIndex(bitmap, row, rows);
        for (let column = 0; column < bitmap.width; column += 1) {
          const srcOffset = srcRow + column * 2;
          const destOffset = (row * bitmap.width + column) * 4;
          if (srcOffset + 1 >= bitmap.data.byteLength) {
            break;
          }

          const packed =
            (bitmap.data[srcOffset] ?? 0) |
            ((bitmap.data[srcOffset + 1] ?? 0) << 8);
          const red5 = (packed >> 10) & 0x1f;
          const green5 = (packed >> 5) & 0x1f;
          const blue5 = packed & 0x1f;
          pixels[destOffset] = (red5 << 3) | (red5 >> 2);
          pixels[destOffset + 1] = (green5 << 3) | (green5 >> 2);
          pixels[destOffset + 2] = (blue5 << 3) | (blue5 >> 2);
          pixels[destOffset + 3] = 0xff;
        }
      }
      return pixels;
    }

    case SpiceBitmapFormat.BIT_24:
    case SpiceBitmapFormat.BIT_32: {
      const bytesPerPixel = bitmap.format === SpiceBitmapFormat.BIT_24 ? 3 : 4;
      for (let row = 0; row < rows; row += 1) {
        const srcRow = sourceRowIndex(bitmap, row, rows);
        for (let column = 0; column < bitmap.width; column += 1) {
          const srcOffset = srcRow + column * bytesPerPixel;
          const destOffset = (row * bitmap.width + column) * 4;
          if (srcOffset + bytesPerPixel - 1 >= bitmap.data.byteLength) {
            break;
          }

          pixels[destOffset] = bitmap.data[srcOffset + 2] ?? 0;
          pixels[destOffset + 1] = bitmap.data[srcOffset + 1] ?? 0;
          pixels[destOffset + 2] = bitmap.data[srcOffset] ?? 0;
          pixels[destOffset + 3] =
            bytesPerPixel === 4 ? (bitmap.data[srcOffset + 3] ?? 0xff) : 0xff;
        }
      }
      return pixels;
    }

    default:
      return null;
  }
}
