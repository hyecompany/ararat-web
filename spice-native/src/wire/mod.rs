/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

//! Small SPICE wire-body parsers.
//!
//! These helpers follow the little-endian layouts in `spice.proto` and the
//! message/channel constants generated in `enums.h`. They intentionally parse
//! message bodies, not the mini-header or link framing.

pub mod constants;
pub mod error;
mod parsers;
mod reader;
pub mod structs;

pub use constants::*;
pub use error::*;
pub use parsers::*;
pub use structs::*;

#[cfg(test)]
mod tests;
