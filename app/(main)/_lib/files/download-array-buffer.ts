/** Trigger a browser download for raw bytes (no server-specific logic). */
export function downloadArrayBufferAsFile(
  buffer: ArrayBuffer,
  filename: string,
): void {
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
