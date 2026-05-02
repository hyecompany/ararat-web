/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

mod bitmap;
mod glz;
mod lz;
mod lz4;
mod lz_alpha;
mod lz_palette;
mod quic;
mod util;

#[cfg(test)]
mod tests;

pub use bitmap::{bitmap_decode, bitmap_plt_decode};
pub use glz::{glz_rgb_decode, zlib_glz_rgb_decode};
pub use lz::{lz_rgb_decode, lz_rgb_image_decode};
pub use lz4::lz4_decode;
pub use lz_alpha::{apply_lz_alpha_mask_rgba, lz_alpha_mask_decode};
pub use lz_palette::lz_plt_decode;
pub use quic::quic_decode;

pub enum LzImageType {
    Invalid = 0,
    Plt1Le = 1,
    Plt1Be = 2,
    Plt4Le = 3,
    Plt4Be = 4,
    Plt8 = 5,
    Rgb16 = 6,
    Rgb24 = 7,
    Rgb32 = 8,
    Rgba = 9,
    Xxxa = 10,
    A8 = 11,
}
