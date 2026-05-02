/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

mod cache_invalidation;
mod convert;
mod draw_dispatch;
mod gpu_batch;
mod state;

#[cfg(test)]
mod tests;

pub use state::SpiceDisplayState;

const SPICE_SURFACE_FLAGS_PRIMARY: u32 = 1 << 0;
