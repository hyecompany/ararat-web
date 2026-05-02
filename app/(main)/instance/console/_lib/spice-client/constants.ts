/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export const SPICE_MAGIC = 0x51444552; // "REDQ"
export const SPICE_VERSION_MAJOR = 2;
export const SPICE_VERSION_MINOR = 2;

export enum SpiceChannelType {
  MAIN = 1,
  DISPLAY = 2,
  INPUTS = 3,
  CURSOR = 4,
  PLAYBACK = 5,
  RECORD = 6,
  TUNNEL = 7,
  SMARTCARD = 8,
  USBREDIR = 9,
  PORT = 10,
  WEBDAV = 11,
}

export enum SpiceLinkAuthMechanism {
  SPICE = 1,
  SASL = 2,
}

export enum SpiceDisplayMessage {
  MODE = 1,
  MARK = 2,
  RESET = 3,
  COPY_BITS = 4,
  INVAL_LIST = 5,
  INVAL_ALL_PIXMAPS = 6,
  INVAL_PALETTE = 7,
  INVAL_ALL_PALETTES = 8,
  STREAM_CREATE = 122,
  STREAM_DATA = 123,
  STREAM_CLIP = 124,
  STREAM_DESTROY = 125,
  DRAW_FILL = 302,
  DRAW_OPAQUE = 303,
  DRAW_COPY = 304,
  DRAW_BLEND = 305,
  DRAW_BLACKNESS = 306,
  DRAW_WHITENESS = 307,
  DRAW_INVERS = 308,
  DRAW_ROP3 = 309,
  DRAW_STROKE = 310,
  DRAW_TEXT = 311,
  DRAW_TRANSPARENT = 312,
  DRAW_ALPHA_BLEND = 313,
  SURFACE_CREATE = 314,
  SURFACE_DESTROY = 315,
}

export enum SpiceInputsMessage {
  KEY_DOWN = 101,
  KEY_UP = 102,
  KEY_MODIFIERS = 103,
  MOUSE_MOTION = 111,
  MOUSE_POSITION = 112,
  MOUSE_PRESS = 113,
  MOUSE_RELEASE = 114,
}

export enum SpicePlaybackMessage {
  DATA = 101,
  MODE = 102,
  START = 103,
  STOP = 104,
}

export enum SpiceImageType {
  BITMAP = 0,
  QUIC = 1,
  LZ_PLT = 100,
  LZ_RGB = 101,
  GLZ_RGB = 102,
  FROM_CACHE = 103,
  SURFACE = 104,
  JPEG = 105,
  FROM_CACHE_LOSSLESS = 106,
  ZLIB_GLZ_RGB = 107,
  JPEG_ALPHA = 108,
  LZ4 = 109,
  PNG = 110,
}
