/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::{Deserialize, Serialize};

const SPICE_IMAGE_TYPE_BITMAP: u8 = 0;
const SPICE_IMAGE_TYPE_QUIC: u8 = 1;
const SPICE_IMAGE_TYPE_LZ_PLT: u8 = 100;
const SPICE_IMAGE_TYPE_LZ_RGB: u8 = 101;
const SPICE_IMAGE_TYPE_GLZ_RGB: u8 = 102;
const SPICE_IMAGE_TYPE_FROM_CACHE: u8 = 103;
const SPICE_IMAGE_TYPE_SURFACE: u8 = 104;
const SPICE_IMAGE_TYPE_JPEG: u8 = 105;
const SPICE_IMAGE_TYPE_FROM_CACHE_LOSSLESS: u8 = 106;
const SPICE_IMAGE_TYPE_ZLIB_GLZ_RGB: u8 = 107;
const SPICE_IMAGE_TYPE_JPEG_ALPHA: u8 = 108;
const SPICE_IMAGE_TYPE_LZ4: u8 = 109;

pub const SPICE_IMAGE_FLAGS_CACHE_ME: u8 = 1 << 0;
pub const SPICE_IMAGE_FLAGS_CACHE_REPLACE_ME: u8 = 1 << 2;
pub const SPICE_BITMAP_FLAGS_PAL_CACHE_ME: u8 = 1 << 0;
const SPICE_BITMAP_FLAGS_PAL_FROM_CACHE: u8 = 1 << 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrawCopyEnvelope {
    pub src_bitmap: Option<ImageEnvelope>,
    pub src_area: DrawRect,
    pub rop_descriptor: u16,
    pub scale_mode: u8,
    pub mask: MaskEnvelope,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrawFillEnvelope {
    pub brush: BrushEnvelope,
    pub rop_descriptor: u16,
    pub mask: MaskEnvelope,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BrushEnvelope {
    None,
    Solid { color: u32 },
    Pattern,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawImageEnvelope {
    pub descriptor: ImageDescriptorEnvelope,
    pub payload: ImagePayloadEnvelope,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImageEnvelope {
    pub descriptor: ImageDescriptorEnvelope,
    pub payload: ImagePayloadEnvelope,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDescriptorEnvelope {
    #[serde(serialize_with = "serialize_u64_string")]
    pub id: u64,
    pub image_type: u8,
    pub flags: u8,
    pub cache_me: bool,
    pub cache_replace_me: bool,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImagePayloadEnvelope {
    Bitmap {
        format: u8,
        flags: u8,
        width: u32,
        height: u32,
        stride: u32,
        palette_cache_me: bool,
        #[serde(serialize_with = "serialize_option_u64_string")]
        palette_id: Option<u64>,
        data_offset: u32,
        data_length: u32,
        data: Vec<u8>,
    },
    Binary {
        codec: &'static str,
        data_offset: u32,
        data_length: u32,
        data: Vec<u8>,
    },
    LzPlt {
        flags: u8,
        palette_cache_me: bool,
        #[serde(serialize_with = "serialize_option_u64_string")]
        palette_id: Option<u64>,
        data_offset: u32,
        data_length: u32,
        data: Vec<u8>,
    },
    ZlibGlz {
        glz_data_size: u32,
        data_offset: u32,
        data_length: u32,
        data: Vec<u8>,
    },
    JpegAlpha {
        flags: u8,
        jpeg_offset: u32,
        jpeg_length: u32,
        alpha_offset: u32,
        alpha_length: u32,
        data: Vec<u8>,
    },
    Surface {
        surface_id: u32,
    },
    CacheRef,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaskEnvelope {
    pub flags: u8,
    pub pos: DrawPoint,
    pub bitmap: Option<ImageEnvelope>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawRect {
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawPoint {
    pub x: i32,
    pub y: i32,
}

pub fn parse_draw_copy_envelope(input: &[u8]) -> Result<DrawCopyEnvelope, String> {
    let mut reader = Reader::new(input);
    let _surface_id = reader.u32()?;
    let _bbox = reader.rect()?;
    reader.clip()?;
    let src_bitmap_offset = reader.u32()?;
    let src_bitmap = read_optional_image(input, src_bitmap_offset)?;
    let src_area = reader.rect()?;
    let rop_descriptor = reader.u16()?;
    let scale_mode = reader.u8()?;
    let mask = read_mask(input, &mut reader)?;
    Ok(DrawCopyEnvelope {
        src_bitmap,
        src_area,
        rop_descriptor,
        scale_mode,
        mask,
    })
}

pub fn parse_draw_fill_envelope(input: &[u8]) -> Result<DrawFillEnvelope, String> {
    let mut reader = Reader::new(input);
    let _surface_id = reader.u32()?;
    let _bbox = reader.rect()?;
    reader.clip()?;
    let brush = read_brush(&mut reader)?;
    let rop_descriptor = reader.u16()?;
    let mask = read_mask(input, &mut reader)?;
    Ok(DrawFillEnvelope {
        brush,
        rop_descriptor,
        mask,
    })
}

pub fn parse_draw_mask_only_envelope(input: &[u8]) -> Result<MaskEnvelope, String> {
    let mut reader = Reader::new(input);
    let _surface_id = reader.u32()?;
    let _bbox = reader.rect()?;
    reader.clip()?;
    read_mask(input, &mut reader)
}

pub fn serializable_image(image: ImageEnvelope) -> DrawImageEnvelope {
    DrawImageEnvelope {
        descriptor: image.descriptor,
        payload: image.payload,
    }
}

fn read_optional_image(input: &[u8], offset: u32) -> Result<Option<ImageEnvelope>, String> {
    if offset == 0 {
        return Ok(None);
    }
    read_image_at(input, offset as usize).map(Some)
}

fn read_brush(reader: &mut Reader<'_>) -> Result<BrushEnvelope, String> {
    const SPICE_BRUSH_TYPE_NONE: u32 = 0;
    const SPICE_BRUSH_TYPE_SOLID: u32 = 1;
    const SPICE_BRUSH_TYPE_PATTERN: u32 = 2;

    match reader.u32()? {
        SPICE_BRUSH_TYPE_NONE => Ok(BrushEnvelope::None),
        SPICE_BRUSH_TYPE_SOLID => Ok(BrushEnvelope::Solid {
            color: reader.u32()?,
        }),
        SPICE_BRUSH_TYPE_PATTERN => {
            let _pattern_offset = reader.u32()?;
            let _x = reader.i32()?;
            let _y = reader.i32()?;
            Ok(BrushEnvelope::Pattern)
        }
        _ => Ok(BrushEnvelope::Unsupported),
    }
}

fn read_image_at(input: &[u8], offset: usize) -> Result<ImageEnvelope, String> {
    let mut reader = Reader::at(input, offset)?;
    let descriptor = ImageDescriptorEnvelope {
        id: reader.u64()?,
        image_type: reader.u8()?,
        flags: reader.u8()?,
        cache_me: false,
        cache_replace_me: false,
        width: reader.u32()?,
        height: reader.u32()?,
    };
    let descriptor = ImageDescriptorEnvelope {
        cache_me: (descriptor.flags & SPICE_IMAGE_FLAGS_CACHE_ME) != 0,
        cache_replace_me: (descriptor.flags & SPICE_IMAGE_FLAGS_CACHE_REPLACE_ME) != 0,
        ..descriptor
    };
    let payload = match descriptor.image_type {
        SPICE_IMAGE_TYPE_BITMAP => read_bitmap_payload(input, &mut reader)?,
        SPICE_IMAGE_TYPE_QUIC => read_binary_payload("quic", &mut reader)?,
        SPICE_IMAGE_TYPE_LZ_RGB => read_binary_payload("lzRgb", &mut reader)?,
        SPICE_IMAGE_TYPE_GLZ_RGB => read_binary_payload("glzRgb", &mut reader)?,
        SPICE_IMAGE_TYPE_JPEG => read_binary_payload("jpeg", &mut reader)?,
        SPICE_IMAGE_TYPE_LZ4 => read_binary_payload("lz4", &mut reader)?,
        SPICE_IMAGE_TYPE_LZ_PLT => read_lz_plt_payload(input, &mut reader)?,
        SPICE_IMAGE_TYPE_ZLIB_GLZ_RGB => read_zlib_glz_payload(&mut reader)?,
        SPICE_IMAGE_TYPE_JPEG_ALPHA => read_jpeg_alpha_payload(&mut reader)?,
        SPICE_IMAGE_TYPE_SURFACE => ImagePayloadEnvelope::Surface {
            surface_id: reader.u32()?,
        },
        SPICE_IMAGE_TYPE_FROM_CACHE | SPICE_IMAGE_TYPE_FROM_CACHE_LOSSLESS => {
            ImagePayloadEnvelope::CacheRef
        }
        _ => ImagePayloadEnvelope::Unsupported,
    };
    Ok(ImageEnvelope {
        descriptor,
        payload,
    })
}

fn read_bitmap_payload(
    input: &[u8],
    reader: &mut Reader<'_>,
) -> Result<ImagePayloadEnvelope, String> {
    let format = reader.u8()?;
    let flags = reader.u8()?;
    let width = reader.u32()?;
    let height = reader.u32()?;
    let stride = reader.u32()?;
    let mut data_end = input.len();
    let palette_id = if (flags & SPICE_BITMAP_FLAGS_PAL_FROM_CACHE) != 0 {
        Some(reader.u64()?)
    } else {
        let palette_offset = reader.u32()?;
        if palette_offset != 0 {
            validate_offset(input, palette_offset as usize)?;
            if (palette_offset as usize) > reader.position {
                data_end = palette_offset as usize;
            }
        }
        None
    };
    let data_offset = reader.position as u32;
    let data = input[reader.position..data_end].to_vec();
    let data_length = data.len() as u32;
    Ok(ImagePayloadEnvelope::Bitmap {
        format,
        flags,
        width,
        height,
        stride,
        palette_cache_me: (flags & SPICE_BITMAP_FLAGS_PAL_CACHE_ME) != 0,
        palette_id,
        data_offset,
        data_length,
        data,
    })
}

fn read_binary_payload(
    codec: &'static str,
    reader: &mut Reader<'_>,
) -> Result<ImagePayloadEnvelope, String> {
    let data_length = reader.u32()?;
    let data_offset = reader.position as u32;
    let data = reader.vec(data_length as usize)?;
    Ok(ImagePayloadEnvelope::Binary {
        codec,
        data_offset,
        data_length,
        data,
    })
}

fn read_lz_plt_payload(
    input: &[u8],
    reader: &mut Reader<'_>,
) -> Result<ImagePayloadEnvelope, String> {
    let flags = reader.u8()?;
    let data_length = reader.u32()?;
    let palette_id = if (flags & SPICE_BITMAP_FLAGS_PAL_FROM_CACHE) != 0 {
        Some(reader.u64()?)
    } else {
        let palette_offset = reader.u32()?;
        if palette_offset != 0 {
            validate_offset(input, palette_offset as usize)?;
        }
        None
    };
    let data_offset = reader.position as u32;
    let data = reader.vec(data_length as usize)?;
    Ok(ImagePayloadEnvelope::LzPlt {
        flags,
        palette_cache_me: (flags & SPICE_BITMAP_FLAGS_PAL_CACHE_ME) != 0,
        palette_id,
        data_offset,
        data_length,
        data,
    })
}

fn read_zlib_glz_payload(reader: &mut Reader<'_>) -> Result<ImagePayloadEnvelope, String> {
    let glz_data_size = reader.u32()?;
    let data_length = reader.u32()?;
    let data_offset = reader.position as u32;
    let data = reader.vec(data_length as usize)?;
    Ok(ImagePayloadEnvelope::ZlibGlz {
        glz_data_size,
        data_offset,
        data_length,
        data,
    })
}

fn read_jpeg_alpha_payload(reader: &mut Reader<'_>) -> Result<ImagePayloadEnvelope, String> {
    let flags = reader.u8()?;
    let jpeg_length = reader.u32()?;
    let data_length = reader.u32()?;
    let jpeg_offset = reader.position as u32;
    reader.skip(jpeg_length as usize)?;
    let alpha_offset = reader.position as u32;
    let alpha_length = data_length.saturating_sub(jpeg_length);
    reader.skip(alpha_length as usize)?;
    let payload_start = jpeg_offset as usize;
    let payload_end = payload_start
        .checked_add(data_length as usize)
        .ok_or_else(|| "SPICE jpeg-alpha payload length overflowed.".to_string())?;
    let data = reader
        .input
        .get(payload_start..payload_end)
        .ok_or_else(|| "SPICE jpeg-alpha payload is truncated.".to_string())?
        .to_vec();
    Ok(ImagePayloadEnvelope::JpegAlpha {
        flags,
        jpeg_offset,
        jpeg_length,
        alpha_offset,
        alpha_length,
        data,
    })
}

fn read_mask(input: &[u8], reader: &mut Reader<'_>) -> Result<MaskEnvelope, String> {
    let flags = reader.u8()?;
    let pos = reader.point()?;
    let bitmap_offset = reader.u32()?;
    let bitmap = read_optional_image(input, bitmap_offset)?;
    Ok(MaskEnvelope { flags, pos, bitmap })
}

fn validate_offset(input: &[u8], offset: usize) -> Result<(), String> {
    if offset < input.len() {
        Ok(())
    } else {
        Err("SPICE pointer offset is outside message body.".to_string())
    }
}

struct Reader<'a> {
    input: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    fn new(input: &'a [u8]) -> Reader<'a> {
        Reader { input, position: 0 }
    }

    fn at(input: &'a [u8], position: usize) -> Result<Reader<'a>, String> {
        validate_offset(input, position)?;
        Ok(Reader { input, position })
    }

    fn skip(&mut self, length: usize) -> Result<(), String> {
        self.take(length).map(|_| ())
    }

    fn vec(&mut self, length: usize) -> Result<Vec<u8>, String> {
        Ok(self.take(length)?.to_vec())
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| "SPICE draw body length overflowed.".to_string())?;
        if end > self.input.len() {
            return Err("SPICE draw body is truncated.".to_string());
        }
        let start = self.position;
        self.position = end;
        Ok(&self.input[start..end])
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn u32(&mut self) -> Result<u32, String> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn i32(&mut self) -> Result<i32, String> {
        let bytes = self.take(4)?;
        Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn u64(&mut self) -> Result<u64, String> {
        let bytes = self.take(8)?;
        Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }

    fn point(&mut self) -> Result<DrawPoint, String> {
        Ok(DrawPoint {
            x: self.i32()?,
            y: self.i32()?,
        })
    }

    fn rect(&mut self) -> Result<DrawRect, String> {
        Ok(DrawRect {
            top: self.i32()?,
            left: self.i32()?,
            bottom: self.i32()?,
            right: self.i32()?,
        })
    }

    fn clip(&mut self) -> Result<(), String> {
        let clip_type = self.u8()?;
        if clip_type == 1 {
            let count = self.u32()? as usize;
            for _ in 0..count {
                self.rect()?;
            }
        }
        Ok(())
    }
}

fn serialize_u64_string<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&value.to_string())
}

fn serialize_option_u64_string<S>(value: &Option<u64>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value {
        Some(value) => serializer.serialize_some(&value.to_string()),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_u8(out: &mut Vec<u8>, value: u8) {
        out.push(value);
    }

    fn push_u16(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u64(out: &mut Vec<u8>, value: u64) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_i32(out: &mut Vec<u8>, value: i32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_rect(out: &mut Vec<u8>, top: i32, left: i32, bottom: i32, right: i32) {
        push_i32(out, top);
        push_i32(out, left);
        push_i32(out, bottom);
        push_i32(out, right);
    }

    fn push_image_descriptor(out: &mut Vec<u8>, image_type: u8) {
        push_u64(out, 123);
        push_u8(out, image_type);
        push_u8(out, 0);
        push_u32(out, 16);
        push_u32(out, 16);
    }

    #[test]
    fn parses_draw_copy_jpeg_envelope_with_pointer_offset() {
        let mut body = Vec::new();
        push_u32(&mut body, 0);
        push_rect(&mut body, 0, 0, 16, 16);
        push_u8(&mut body, 0);
        let image_offset_position = body.len();
        push_u32(&mut body, 0);
        push_rect(&mut body, 0, 0, 16, 16);
        push_u16(&mut body, 0xcc);
        push_u8(&mut body, 0);
        push_u8(&mut body, 0);
        push_i32(&mut body, 0);
        push_i32(&mut body, 0);
        push_u32(&mut body, 0);

        let image_offset = body.len() as u32;
        body[image_offset_position..image_offset_position + 4]
            .copy_from_slice(&image_offset.to_le_bytes());
        push_u64(&mut body, 123);
        push_u8(&mut body, SPICE_IMAGE_TYPE_JPEG);
        push_u8(&mut body, 0);
        push_u32(&mut body, 16);
        push_u32(&mut body, 16);
        push_u32(&mut body, 3);
        body.extend_from_slice(&[1, 2, 3]);

        let parsed = parse_draw_copy_envelope(&body).unwrap();
        assert_eq!(parsed.rop_descriptor, 0xcc);
        assert_eq!(parsed.src_area.right, 16);
        let image = parsed.src_bitmap.unwrap();
        assert_eq!(image.descriptor.id, 123);
        assert_eq!(image.descriptor.image_type, SPICE_IMAGE_TYPE_JPEG);
        assert_eq!(
            image.payload,
            ImagePayloadEnvelope::Binary {
                codec: "jpeg",
                data_offset: image_offset + 22,
                data_length: 3,
                data: vec![1, 2, 3],
            }
        );
    }

    #[test]
    fn compressed_payload_variants_retain_bytes_for_native_decode() {
        let mut lz_plt = Vec::new();
        push_image_descriptor(&mut lz_plt, SPICE_IMAGE_TYPE_LZ_PLT);
        push_u8(&mut lz_plt, 0);
        push_u32(&mut lz_plt, 3);
        push_u32(&mut lz_plt, 0);
        lz_plt.extend_from_slice(&[1, 2, 3]);
        assert_eq!(
            read_image_at(&lz_plt, 0).unwrap().payload,
            ImagePayloadEnvelope::LzPlt {
                flags: 0,
                palette_cache_me: false,
                palette_id: None,
                data_offset: 27,
                data_length: 3,
                data: vec![1, 2, 3],
            }
        );

        let mut zlib_glz = Vec::new();
        push_image_descriptor(&mut zlib_glz, SPICE_IMAGE_TYPE_ZLIB_GLZ_RGB);
        push_u32(&mut zlib_glz, 2);
        push_u32(&mut zlib_glz, 4);
        zlib_glz.extend_from_slice(&[4, 5, 6, 7]);
        assert_eq!(
            read_image_at(&zlib_glz, 0).unwrap().payload,
            ImagePayloadEnvelope::ZlibGlz {
                glz_data_size: 2,
                data_offset: 26,
                data_length: 4,
                data: vec![4, 5, 6, 7],
            }
        );

        let mut jpeg_alpha = Vec::new();
        push_image_descriptor(&mut jpeg_alpha, SPICE_IMAGE_TYPE_JPEG_ALPHA);
        push_u8(&mut jpeg_alpha, 0);
        push_u32(&mut jpeg_alpha, 3);
        push_u32(&mut jpeg_alpha, 5);
        jpeg_alpha.extend_from_slice(&[8, 9, 10, 11, 12]);
        assert_eq!(
            read_image_at(&jpeg_alpha, 0).unwrap().payload,
            ImagePayloadEnvelope::JpegAlpha {
                flags: 0,
                jpeg_offset: 27,
                jpeg_length: 3,
                alpha_offset: 30,
                alpha_length: 2,
                data: vec![8, 9, 10, 11, 12],
            }
        );
    }
}
