/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use shakenfist_spice_compression::quic_decode as decode_spice_quic;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn quic_decode(input: &[u8], width: u32, height: u32) -> Vec<u8> {
    decode_spice_quic(input, width, height).unwrap_or_default()
}
