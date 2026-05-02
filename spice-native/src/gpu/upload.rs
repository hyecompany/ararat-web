/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuUploadStrategy {
    QueueWriteBufferWith,
    StagingBelt,
    PersistentMappedRing,
    QueueWriteTexture,
    ExternalTexture,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuUploadPlan {
    pub strategy: GpuUploadStrategy,
    pub byte_length: u32,
    pub bytes_per_row: u32,
    pub rows: u32,
}

pub fn upload_plan_for_rgba(width: u32, height: u32) -> GpuUploadPlan {
    let bytes_per_row = width.saturating_mul(4);
    let byte_length = bytes_per_row.saturating_mul(height);
    let strategy = if byte_length >= 16 * 1024 {
        GpuUploadStrategy::QueueWriteBufferWith
    } else {
        GpuUploadStrategy::QueueWriteTexture
    };
    GpuUploadPlan {
        strategy,
        byte_length,
        bytes_per_row,
        rows: height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_plan_uses_staging_view_for_larger_decodes() {
        let plan = upload_plan_for_rgba(256, 64);

        assert_eq!(plan.strategy, GpuUploadStrategy::QueueWriteBufferWith);
        assert_eq!(plan.byte_length, 256 * 64 * 4);
    }
}
