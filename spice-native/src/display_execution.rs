/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::Serialize;

use crate::display_draw::{
    BrushEnvelope, DrawCopyEnvelope, DrawFillEnvelope, ImagePayloadEnvelope, MaskEnvelope,
};
use crate::wire::{self, DisplayBase};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum VisualExecutionPlan {
    DrawCopy {
        decode: VisualDecodePlan,
        compose: DrawCopyComposePlan,
        byte_cost: u32,
        lane: &'static str,
        priority: u8,
    },
    FillRect {
        color: u32,
        byte_cost: u32,
        lane: &'static str,
        priority: u8,
    },
    Unsupported {
        reason: &'static str,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum VisualDecodePlan {
    BrowserImage { codec: &'static str },
    WasmBitmap,
    WasmLzRgb,
    WasmBinaryImage { codec: &'static str },
    GpuSurfaceCopy { surface_id: u32 },
    ProtocolCacheRef,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawCopyComposePlan {
    pub rop_descriptor: u16,
    pub scale_mode: u8,
    pub mask_present: bool,
    pub mask_flags: Option<u8>,
}

pub fn plan_visual_execution(
    message_type: u16,
    base: &DisplayBase,
    draw_copy: Option<&DrawCopyEnvelope>,
    draw_fill: Option<&DrawFillEnvelope>,
    draw_mask: Option<&MaskEnvelope>,
) -> VisualExecutionPlan {
    if message_type == wire::SPICE_MSG_DISPLAY_DRAW_FILL {
        let Some(fill) = draw_fill else {
            return VisualExecutionPlan::Unsupported {
                reason: "draw-fill-missing-envelope",
            };
        };
        return plan_fill(base, fill);
    }
    if message_type == wire::SPICE_MSG_DISPLAY_DRAW_BLACKNESS {
        return plan_masked_constant_fill(base, draw_mask, 0x000000);
    }
    if message_type == wire::SPICE_MSG_DISPLAY_DRAW_WHITENESS {
        return plan_masked_constant_fill(base, draw_mask, 0xffffff);
    }
    if message_type != wire::SPICE_MSG_DISPLAY_DRAW_COPY {
        return VisualExecutionPlan::Unsupported {
            reason: "draw-op-not-planned",
        };
    }
    let Some(draw) = draw_copy else {
        return VisualExecutionPlan::Unsupported {
            reason: "draw-copy-missing-envelope",
        };
    };
    let Some(image) = draw.src_bitmap.as_ref() else {
        return VisualExecutionPlan::Unsupported {
            reason: "draw-copy-missing-source",
        };
    };
    let Some((decode, byte_cost)) = plan_decode(&image.payload) else {
        return VisualExecutionPlan::Unsupported {
            reason: "draw-copy-unsupported-source",
        };
    };
    let lane = lane_for_decode(&decode);
    let priority = priority_for_decode(&decode);
    VisualExecutionPlan::DrawCopy {
        decode,
        byte_cost,
        lane,
        priority,
        compose: DrawCopyComposePlan {
            rop_descriptor: draw.rop_descriptor,
            scale_mode: draw.scale_mode,
            mask_present: draw.mask.bitmap.is_some(),
            mask_flags: draw.mask.bitmap.as_ref().map(|_| draw.mask.flags),
        },
    }
}

fn plan_fill(base: &DisplayBase, fill: &DrawFillEnvelope) -> VisualExecutionPlan {
    if fill.mask.bitmap.is_some() {
        return VisualExecutionPlan::Unsupported {
            reason: "draw-fill-mask-not-planned",
        };
    }
    let color = match fill.rop_descriptor {
        rop if (rop & 8) != 0 => match fill.brush {
            BrushEnvelope::Solid { color } => color,
            BrushEnvelope::None => {
                return VisualExecutionPlan::Unsupported {
                    reason: "draw-fill-empty-brush",
                };
            }
            BrushEnvelope::Pattern => {
                return VisualExecutionPlan::Unsupported {
                    reason: "draw-fill-pattern-brush-not-planned",
                };
            }
            BrushEnvelope::Unsupported => {
                return VisualExecutionPlan::Unsupported {
                    reason: "draw-fill-unsupported-brush",
                };
            }
        },
        rop if (rop & 128) != 0 => 0x000000,
        rop if (rop & 256) != 0 => 0xffffff,
        _ => {
            return VisualExecutionPlan::Unsupported {
                reason: "draw-fill-rop-not-planned",
            };
        }
    };
    fill_rect_plan(base, color)
}

fn plan_masked_constant_fill(
    base: &DisplayBase,
    mask: Option<&MaskEnvelope>,
    color: u32,
) -> VisualExecutionPlan {
    if mask.and_then(|mask| mask.bitmap.as_ref()).is_some() {
        return VisualExecutionPlan::Unsupported {
            reason: "draw-constant-fill-mask-not-planned",
        };
    }
    fill_rect_plan(base, color)
}

fn fill_rect_plan(base: &DisplayBase, color: u32) -> VisualExecutionPlan {
    VisualExecutionPlan::FillRect {
        color,
        byte_cost: rect_byte_cost(base),
        lane: "gpu-fill",
        priority: 0,
    }
}

fn rect_byte_cost(base: &DisplayBase) -> u32 {
    let width = (base.box_.right - base.box_.left).max(0) as u32;
    let height = (base.box_.bottom - base.box_.top).max(0) as u32;
    width.saturating_mul(height).saturating_mul(4)
}

fn lane_for_decode(decode: &VisualDecodePlan) -> &'static str {
    match decode {
        VisualDecodePlan::BrowserImage { .. } => "browser-image",
        VisualDecodePlan::WasmBitmap => "wasm-bitmap",
        VisualDecodePlan::WasmLzRgb => "wasm-lz-rgb",
        VisualDecodePlan::WasmBinaryImage { codec } => match *codec {
            "quic" => "wasm-quic",
            "lz4" => "wasm-lz4",
            _ => "wasm-binary-image",
        },
        VisualDecodePlan::GpuSurfaceCopy { .. } => "gpu-surface-copy",
        VisualDecodePlan::ProtocolCacheRef => "protocol-cache-ref",
    }
}

fn priority_for_decode(decode: &VisualDecodePlan) -> u8 {
    match decode {
        VisualDecodePlan::GpuSurfaceCopy { .. } | VisualDecodePlan::ProtocolCacheRef => 0,
        VisualDecodePlan::WasmBitmap => 1,
        VisualDecodePlan::BrowserImage { .. }
        | VisualDecodePlan::WasmLzRgb
        | VisualDecodePlan::WasmBinaryImage { .. } => 2,
    }
}

fn plan_decode(payload: &ImagePayloadEnvelope) -> Option<(VisualDecodePlan, u32)> {
    match payload {
        ImagePayloadEnvelope::Bitmap { data_length, .. } => {
            Some((VisualDecodePlan::WasmBitmap, *data_length))
        }
        ImagePayloadEnvelope::Binary {
            codec, data_length, ..
        } => match *codec {
            "jpeg" => Some((VisualDecodePlan::BrowserImage { codec }, *data_length)),
            "lzRgb" => Some((VisualDecodePlan::WasmLzRgb, *data_length)),
            "quic" | "lz4" => Some((VisualDecodePlan::WasmBinaryImage { codec }, *data_length)),
            _ => None,
        },
        ImagePayloadEnvelope::Surface { surface_id } => Some((
            VisualDecodePlan::GpuSurfaceCopy {
                surface_id: *surface_id,
            },
            0,
        )),
        ImagePayloadEnvelope::CacheRef => Some((VisualDecodePlan::ProtocolCacheRef, 0)),
        ImagePayloadEnvelope::LzPlt { .. }
        | ImagePayloadEnvelope::ZlibGlz { .. }
        | ImagePayloadEnvelope::JpegAlpha { .. }
        | ImagePayloadEnvelope::Unsupported => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display_draw::{
        BrushEnvelope, DrawFillEnvelope, DrawPoint, DrawRect, ImageDescriptorEnvelope,
        ImageEnvelope, ImagePayloadEnvelope, MaskEnvelope,
    };
    use crate::wire::{Clip, Rect};

    #[test]
    fn draw_copy_bitmap_plans_wasm_bitmap_and_compose_semantics() {
        let draw = draw_copy(ImagePayloadEnvelope::Bitmap {
            format: 8,
            flags: 4,
            width: 32,
            height: 640,
            stride: 128,
            palette_cache_me: false,
            palette_id: None,
            data_offset: 0,
            data_length: 4096,
            data: Vec::new(),
        });

        assert_eq!(
            plan_visual_execution(
                wire::SPICE_MSG_DISPLAY_DRAW_COPY,
                &base(),
                Some(&draw),
                None,
                None,
            ),
            VisualExecutionPlan::DrawCopy {
                decode: VisualDecodePlan::WasmBitmap,
                byte_cost: 4096,
                lane: "wasm-bitmap",
                priority: 1,
                compose: DrawCopyComposePlan {
                    rop_descriptor: 8,
                    scale_mode: 0,
                    mask_present: false,
                    mask_flags: None,
                },
            }
        );
    }

    #[test]
    fn draw_copy_jpeg_uses_browser_decode_syscall_plan() {
        let draw = draw_copy(ImagePayloadEnvelope::Binary {
            codec: "jpeg",
            data_offset: 0,
            data_length: 1024,
            data: Vec::new(),
        });

        assert_eq!(
            plan_visual_execution(
                wire::SPICE_MSG_DISPLAY_DRAW_COPY,
                &base(),
                Some(&draw),
                None,
                None,
            ),
            VisualExecutionPlan::DrawCopy {
                decode: VisualDecodePlan::BrowserImage { codec: "jpeg" },
                byte_cost: 1024,
                lane: "browser-image",
                priority: 2,
                compose: DrawCopyComposePlan {
                    rop_descriptor: 8,
                    scale_mode: 0,
                    mask_present: false,
                    mask_flags: None,
                },
            }
        );
    }

    #[test]
    fn non_copy_draws_are_not_planned_as_copy_fast_paths() {
        let draw = draw_copy(ImagePayloadEnvelope::Binary {
            codec: "jpeg",
            data_offset: 0,
            data_length: 1024,
            data: Vec::new(),
        });

        assert_eq!(
            plan_visual_execution(
                wire::SPICE_MSG_DISPLAY_DRAW_BLEND,
                &base(),
                Some(&draw),
                None,
                None,
            ),
            VisualExecutionPlan::Unsupported {
                reason: "draw-op-not-planned",
            }
        );
    }

    #[test]
    fn solid_fill_plans_gpu_fill_rect() {
        let fill = DrawFillEnvelope {
            brush: BrushEnvelope::Solid { color: 0x112233 },
            rop_descriptor: 8,
            mask: MaskEnvelope {
                flags: 0,
                pos: DrawPoint { x: 0, y: 0 },
                bitmap: None,
            },
        };

        assert_eq!(
            plan_visual_execution(
                wire::SPICE_MSG_DISPLAY_DRAW_FILL,
                &base(),
                None,
                Some(&fill),
                None,
            ),
            VisualExecutionPlan::FillRect {
                color: 0x112233,
                byte_cost: 16 * 20 * 4,
                lane: "gpu-fill",
                priority: 0,
            }
        );
    }

    fn draw_copy(payload: ImagePayloadEnvelope) -> DrawCopyEnvelope {
        DrawCopyEnvelope {
            src_bitmap: Some(ImageEnvelope {
                descriptor: ImageDescriptorEnvelope {
                    id: 0,
                    image_type: 0,
                    flags: 0,
                    cache_me: false,
                    cache_replace_me: false,
                    width: 32,
                    height: 640,
                },
                payload,
            }),
            src_area: DrawRect {
                top: 0,
                left: 0,
                bottom: 640,
                right: 32,
            },
            rop_descriptor: 8,
            scale_mode: 0,
            mask: MaskEnvelope {
                flags: 0,
                pos: DrawPoint { x: 0, y: 0 },
                bitmap: None,
            },
        }
    }

    fn base() -> DisplayBase {
        DisplayBase {
            surface_id: 0,
            box_: Rect {
                top: 4,
                left: 8,
                bottom: 24,
                right: 24,
            },
            clip: Clip {
                clip_type: 0,
                rects: Vec::new(),
            },
        }
    }
}
