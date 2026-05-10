import { describe, expect, test } from 'bun:test';

import { classifyBufferIsBinary, preflightOpen } from './file-open-policy';

const BINARY_CLASSIFICATION_SAMPLE_BYTES = 24 * 1024;

function bytesBuffer(bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function repeatedByteBuffer(byte: number, length: number): ArrayBuffer {
  return new Uint8Array(length).fill(byte).buffer;
}

describe('classifyBufferIsBinary', () => {
  test('treats regular UTF-8 text as editable', () => {
    expect(classifyBufferIsBinary('notes.txt', textBuffer('hello\nworld\n'))).toBe(false);
  });

  test('treats empty files as editable text', () => {
    expect(classifyBufferIsBinary('empty', new ArrayBuffer(0))).toBe(false);
  });

  test('detects ZIP containers such as docx/pptx from magic bytes', () => {
    const zipHeader = bytesBuffer([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    expect(classifyBufferIsBinary('document.docx', zipHeader)).toBe(true);
    expect(classifyBufferIsBinary('deck.pptx', zipHeader)).toBe(true);
  });

  test('detects ELF object files from magic bytes', () => {
    const elfHeader = bytesBuffer([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(classifyBufferIsBinary('object.o', elfHeader)).toBe(true);
  });

  test('detects invalid UTF-8 bytes as binary', () => {
    expect(classifyBufferIsBinary('unknown', bytesBuffer([0xf0, 0x28, 0x8c, 0x28]))).toBe(true);
  });

  test('detects NUL bytes as binary', () => {
    expect(classifyBufferIsBinary('unknown', bytesBuffer([0x61, 0x00, 0x62]))).toBe(true);
  });

  test('treats valid UTF-8 content larger than the sample as editable', () => {
    const largeText = repeatedByteBuffer(0x61, BINARY_CLASSIFICATION_SAMPLE_BYTES * 2);
    expect(classifyBufferIsBinary('large.log', largeText)).toBe(false);
  });

  test('samples classification instead of scanning the full buffer', () => {
    const bytes = new Uint8Array(BINARY_CLASSIFICATION_SAMPLE_BYTES + 1).fill(0x61);
    bytes[BINARY_CLASSIFICATION_SAMPLE_BYTES] = 0x00;
    expect(classifyBufferIsBinary('large.log', bytes.buffer)).toBe(false);
  });
});

describe('preflightOpen', () => {
  test('downloads Office documents without fetching the body first', () => {
    expect(preflightOpen('document.docx')).toEqual({ kind: 'download_now' });
    expect(preflightOpen('deck.pptx')).toEqual({ kind: 'download_now' });
    expect(preflightOpen('spreadsheet.xlsx')).toEqual({ kind: 'download_now' });
  });

  test('downloads object and static library artifacts without fetching the body first', () => {
    expect(preflightOpen('object.o')).toEqual({ kind: 'download_now' });
    expect(preflightOpen('object.obj')).toEqual({ kind: 'download_now' });
    expect(preflightOpen('archive.a')).toEqual({ kind: 'download_now' });
    expect(preflightOpen('archive.lib')).toEqual({ kind: 'download_now' });
  });
});
