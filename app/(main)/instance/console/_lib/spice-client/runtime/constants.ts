/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export const SPICE_MAGIC = 0x51444552;
export const SPICE_VERSION_MAJOR = 2;
export const SPICE_VERSION_MINOR = 2;
export const SPICE_NULL_AUTH_TICKET_BYTES = 128;

export const SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION = 0;
export const SPICE_COMMON_CAP_AUTH_SPICE = 1;
export const SPICE_COMMON_CAP_AUTH_SASL = 2;
export const SPICE_COMMON_CAP_MINI_HEADER = 3;

export const SPICE_DISPLAY_CAP_SIZED_STREAM = 0;
export const SPICE_DISPLAY_CAP_MONITORS_CONFIG = 1;
export const SPICE_DISPLAY_CAP_COMPOSITE = 2;
export const SPICE_DISPLAY_CAP_A8_SURFACE = 3;
export const SPICE_DISPLAY_CAP_STREAM_REPORT = 4;
export const SPICE_DISPLAY_CAP_LZ4_COMPRESSION = 5;
export const SPICE_DISPLAY_CAP_PREF_COMPRESSION = 6;
export const SPICE_DISPLAY_CAP_GL_SCANOUT = 7;
export const SPICE_DISPLAY_CAP_MULTI_CODEC = 8;
export const SPICE_DISPLAY_CAP_CODEC_MJPEG = 9;
export const SPICE_DISPLAY_CAP_CODEC_VP8 = 10;
export const SPICE_DISPLAY_CAP_CODEC_H264 = 11;
export const SPICE_DISPLAY_CAP_PREF_VIDEO_CODEC_TYPE = 12;
export const SPICE_DISPLAY_CAP_CODEC_VP9 = 13;
export const SPICE_DISPLAY_CAP_CODEC_H265 = 14;
export const SPICE_DISPLAY_CAP_GL_SCANOUT2 = 15;

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

export enum SpiceCommonMessage {
  MIGRATE = 1,
  MIGRATE_DATA = 2,
  SET_ACK = 3,
  PING = 4,
  WAIT_FOR_CHANNELS = 5,
  DISCONNECTING = 6,
  NOTIFY = 7,
  LIST = 8,
}

export enum SpiceCommonClientMessage {
  ACK_SYNC = 1,
  ACK = 2,
  PONG = 3,
  MIGRATE_FLUSH_MARK = 4,
  MIGRATE_DATA = 5,
  DISCONNECTING = 6,
}

export enum SpiceMainMessage {
  MIGRATE_BEGIN = 101,
  MIGRATE_CANCEL = 102,
  INIT = 103,
  CHANNELS_LIST = 104,
  MOUSE_MODE = 105,
  MULTI_MEDIA_TIME = 106,
  AGENT_CONNECTED = 107,
  AGENT_DISCONNECTED = 108,
  AGENT_DATA = 109,
  AGENT_TOKEN = 110,
  MIGRATE_SWITCH_HOST = 111,
  MIGRATE_END = 112,
  NAME = 113,
  UUID = 114,
  AGENT_CONNECTED_TOKENS = 115,
  MIGRATE_BEGIN_SEAMLESS = 116,
  MIGRATE_DST_SEAMLESS_ACK = 117,
  MIGRATE_DST_SEAMLESS_NACK = 118,
}

export enum SpiceMainClientMessage {
  CLIENT_INFO = 101,
  MIGRATE_CONNECTED = 102,
  MIGRATE_CONNECT_ERROR = 103,
  ATTACH_CHANNELS = 104,
  MOUSE_MODE_REQUEST = 105,
  AGENT_START = 106,
  AGENT_DATA = 107,
  AGENT_TOKEN = 108,
  MIGRATE_END = 109,
  MIGRATE_DST_DO_SEAMLESS = 110,
  MIGRATE_CONNECTED_SEAMLESS = 111,
  QUALITY_INDICATOR = 112,
}

export enum SpiceDisplayMessage {
  MODE = 101,
  MARK = 102,
  RESET = 103,
  COPY_BITS = 104,
  INVAL_LIST = 105,
  INVAL_ALL_IMAGES = 106,
  INVAL_PALETTE = 107,
  INVAL_ALL_PALETTES = 108,
  STREAM_CREATE = 122,
  STREAM_DATA = 123,
  STREAM_CLIP = 124,
  STREAM_DESTROY = 125,
  STREAM_DESTROY_ALL = 126,
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
  STREAM_DATA_SIZED = 316,
  MONITORS_CONFIG = 317,
  DRAW_COMPOSITE = 318,
  STREAM_ACTIVATE_REPORT = 319,
  GL_SCANOUT_UNIX = 320,
  GL_DRAW = 321,
  QUALITY_INDICATOR = 322,
  GL_SCANOUT2_UNIX = 323,
}

export enum SpiceDisplayClientMessage {
  INIT = 101,
  STREAM_REPORT = 102,
  PREFERRED_COMPRESSION = 103,
  GL_DRAW_DONE = 104,
  PREFERRED_VIDEO_CODEC_TYPE = 105,
}

export enum SpiceCursorMessage {
  INIT = 101,
  RESET = 102,
  SET = 103,
  MOVE = 104,
  HIDE = 105,
  TRAIL = 106,
  INVAL_ONE = 107,
  INVAL_ALL = 108,
}

export enum SpiceInputsMessage {
  KEY_DOWN = 101,
  KEY_UP = 102,
  KEY_MODIFIERS = 103,
  KEY_SCANCODE = 104,
  MOUSE_MOTION = 111,
  MOUSE_POSITION = 112,
  MOUSE_PRESS = 113,
  MOUSE_RELEASE = 114,
}

export const SPICE_INPUTS_SCROLL_LOCK = 1 << 0;
export const SPICE_INPUTS_NUM_LOCK = 1 << 1;
export const SPICE_INPUTS_CAPS_LOCK = 1 << 2;

export enum SpicePlaybackMessage {
  DATA = 101,
  MODE = 102,
  START = 103,
  STOP = 104,
  VOLUME = 105,
  MUTE = 106,
  LATENCY = 107,
}

export enum SpiceRecordMessage {
  START = 101,
  STOP = 102,
  VOLUME = 103,
  MUTE = 104,
}

export enum SpicePortEvent {
  OPENED = 0,
  CLOSED = 1,
  STARTED = 2,
  STOPPED = 3,
}

export enum SpicePortClientMessage {
  EVENT = 201,
}

export enum SpiceSpiceVmcMessage {
  DATA = 101,
  COMPRESSED_DATA = 102,
}

export enum SpiceMouseMode {
  SERVER = 1,
  CLIENT = 2,
}

export enum SpiceBitmapFormat {
  INVALID = 0,
  BIT_1_LE = 1,
  BIT_1_BE = 2,
  BIT_4_LE = 3,
  BIT_4_BE = 4,
  BIT_8 = 5,
  BIT_16 = 6,
  BIT_24 = 7,
  BIT_32 = 8,
  RGBA = 9,
  XXXA = 10,
  A8 = 11,
}

export enum SpiceImageType {
  BITMAP = 0,
  QUIC = 1,
  RESERVED = 2,
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
}

export const SPICE_CURSOR_FLAGS_NONE = 1;
export const SPICE_CURSOR_FLAGS_CACHE_ME = 2;
export const SPICE_CURSOR_FLAGS_FROM_CACHE = 4;

export const SPICE_IMAGE_FLAGS_CACHE_ME = 1 << 0;
export const SPICE_IMAGE_FLAGS_HIGH_BITS_SET = 1 << 1;
export const SPICE_IMAGE_FLAGS_CACHE_REPLACE_ME = 1 << 2;

export const SPICE_BITMAP_FLAGS_PAL_CACHE_ME = 1 << 0;
export const SPICE_BITMAP_FLAGS_PAL_FROM_CACHE = 1 << 1;
export const SPICE_BITMAP_FLAGS_TOP_DOWN = 1 << 2;

export const VD_AGENT_PROTOCOL = 1;
export const VD_AGENT_DEFAULT_SERVER_TOKENS = 10;
export const SPICE_AGENT_DEFAULT_SERVER_TOKENS = 10;

export enum SpiceAgentMessageType {
  MOUSE_STATE = 1,
  MONITORS_CONFIG = 2,
  REPLY = 3,
  DISPLAY_CONFIG = 5,
  ANNOUNCE_CAPABILITIES = 6,
  FILE_XFER_START = 10,
  FILE_XFER_STATUS = 11,
  FILE_XFER_DATA = 12,
  CLIENT_DISCONNECTED = 13,
}

export enum SpiceAgentCapability {
  MOUSE_STATE = 0,
  MONITORS_CONFIG = 1,
  REPLY = 2,
  DISPLAY_CONFIG = 4,
  SPARSE_MONITORS_CONFIG = 7,
  GUEST_LINEEND_LF = 8,
  GUEST_LINEEND_CRLF = 9,
  AUDIO_VOLUME_SYNC = 11,
  MONITORS_CONFIG_POSITION = 12,
  FILE_XFER_DISABLED = 13,
  FILE_XFER_DETAILED_ERRORS = 14,
  GRAPHICS_DEVICE_INFO = 15,
}

export const VD_AGENT_CONFIG_MONITORS_FLAG_USE_POS = 1;
export const VD_AGENT_DISPLAY_CONFIG_FLAG_SET_COLOR_DEPTH = 1;
