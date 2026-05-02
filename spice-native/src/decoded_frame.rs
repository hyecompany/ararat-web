/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::display_draw::DrawRect;

#[derive(Debug)]
pub(crate) struct DecodedUpload {
    pub token: u64,
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub dest: DrawRect,
    pub source: DrawRect,
    pub rop_descriptor: u16,
    pub scale_mode: u8,
    pub mask_present: bool,
}

#[derive(Default)]
pub(crate) struct DecodedFrameAssembler {
    active: Option<DecodedFrame>,
    next_epoch: u64,
    byte_cap: usize,
}

struct DecodedFrame {
    min_left: i32,
    max_right: i32,
    last_left: i32,
    top: i32,
    bottom: i32,
    bytes: usize,
    uploads: Vec<DecodedUpload>,
}

impl DecodedFrameAssembler {
    pub fn new(byte_cap: usize) -> Self {
        Self {
            active: None,
            next_epoch: 1,
            byte_cap,
        }
    }

    pub fn reset(&mut self) -> Vec<DecodedUpload> {
        self.next_epoch = 1;
        self.active
            .take()
            .map(|frame| frame.uploads)
            .unwrap_or_default()
    }

    pub fn finish(&mut self) -> Vec<DecodedUpload> {
        self.active
            .take()
            .map(|frame| frame.uploads)
            .unwrap_or_default()
    }

    pub fn push(&mut self, upload: DecodedUpload) -> Vec<DecodedUpload> {
        let starts_frame = self
            .active
            .as_ref()
            .map(|frame| starts_new_frame(frame, upload.dest))
            .unwrap_or(true);
        let mut ready = Vec::new();
        if starts_frame {
            if let Some(frame) = self.active.take() {
                ready = frame.uploads;
            }
            self.next_epoch = self.next_epoch.saturating_add(1);
            self.active = Some(DecodedFrame {
                min_left: upload.dest.left,
                max_right: upload.dest.right,
                last_left: upload.dest.left,
                top: upload.dest.top,
                bottom: upload.dest.bottom,
                bytes: 0,
                uploads: Vec::new(),
            });
        }
        let upload_bytes = upload.rgba.len();
        if let Some(frame) = self.active.as_mut() {
            if frame.bytes.saturating_add(upload_bytes) > self.byte_cap {
                if let Some(frame) = self.active.take() {
                    ready.extend(frame.uploads);
                }
                self.next_epoch = self.next_epoch.saturating_add(1);
                self.active = Some(DecodedFrame {
                    min_left: upload.dest.left,
                    max_right: upload.dest.right,
                    last_left: upload.dest.left,
                    top: upload.dest.top,
                    bottom: upload.dest.bottom,
                    bytes: 0,
                    uploads: Vec::new(),
                });
            }
        }
        if let Some(frame) = self.active.as_mut() {
            frame.min_left = frame.min_left.min(upload.dest.left);
            frame.max_right = frame.max_right.max(upload.dest.right);
            frame.last_left = upload.dest.left;
            frame.top = upload.dest.top;
            frame.bottom = upload.dest.bottom;
            frame.bytes = frame.bytes.saturating_add(upload_bytes);
            frame.uploads.push(upload);
        }
        ready
    }
}

fn starts_new_frame(frame: &DecodedFrame, dest: DrawRect) -> bool {
    dest.left < frame.last_left - 32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembler_flushes_completed_strip_run_when_next_run_starts() {
        let mut assembler = DecodedFrameAssembler::new(1024);

        assert!(assembler.push(upload(1, 0, 64)).is_empty());
        assert!(assembler.push(upload(2, 64, 128)).is_empty());

        let ready = assembler.push(upload(3, 0, 64));
        assert_eq!(ready.len(), 2);
        assert_eq!(ready[0].token, 1);
        assert_eq!(ready[1].token, 2);

        let pending = assembler.finish();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].token, 3);
    }

    #[test]
    fn assembler_flushes_before_exceeding_byte_cap() {
        let mut assembler = DecodedFrameAssembler::new(7);

        assert!(assembler.push(upload(1, 0, 1)).is_empty());
        let ready = assembler.push(upload(2, 1, 2));

        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].token, 1);
        assert_eq!(assembler.finish().len(), 1);
    }

    fn upload(token: u64, left: i32, right: i32) -> DecodedUpload {
        DecodedUpload {
            token,
            rgba: vec![255, 0, 0, 255],
            width: 1,
            height: 1,
            dest: DrawRect {
                left,
                top: 0,
                right,
                bottom: 1,
            },
            source: DrawRect {
                left: 0,
                top: 0,
                right: 1,
                bottom: 1,
            },
            rop_descriptor: 8,
            scale_mode: 0,
            mask_present: false,
        }
    }
}
