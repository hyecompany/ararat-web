import { describe, expect, test } from 'bun:test';

import { classifyBufferIsBinary, preflightOpen } from './file-open-policy';

function bytesBuffer(bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
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
