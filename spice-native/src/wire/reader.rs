/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use super::{WireParseError, WireResult};

pub(super) struct Reader<'a> {
    input: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    pub(super) fn new(input: &'a [u8]) -> Reader<'a> {
        Reader { input, position: 0 }
    }

    pub(super) fn finish(&self) -> WireResult<()> {
        if self.position == self.input.len() {
            Ok(())
        } else {
            Err(WireParseError::new(
                "SPICE message body has trailing bytes.",
            ))
        }
    }

    pub(super) fn take(&mut self, length: usize) -> WireResult<&'a [u8]> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| WireParseError::new("SPICE message body length overflowed."))?;
        if end > self.input.len() {
            return Err(WireParseError::new("SPICE message body is truncated."));
        }
        let start = self.position;
        self.position = end;
        Ok(&self.input[start..end])
    }

    pub(super) fn rest_vec(&mut self) -> Vec<u8> {
        let start = self.position;
        self.position = self.input.len();
        self.input[start..].to_vec()
    }

    pub(super) fn vec(&mut self, length: usize) -> WireResult<Vec<u8>> {
        Ok(self.take(length)?.to_vec())
    }

    pub(super) fn u8(&mut self) -> WireResult<u8> {
        Ok(self.take(1)?[0])
    }

    pub(super) fn u16(&mut self) -> WireResult<u16> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    pub(super) fn i16(&mut self) -> WireResult<i16> {
        let bytes = self.take(2)?;
        Ok(i16::from_le_bytes([bytes[0], bytes[1]]))
    }

    pub(super) fn u32(&mut self) -> WireResult<u32> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    pub(super) fn i32(&mut self) -> WireResult<i32> {
        let bytes = self.take(4)?;
        Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    pub(super) fn u64(&mut self) -> WireResult<u64> {
        let bytes = self.take(8)?;
        Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }
}
