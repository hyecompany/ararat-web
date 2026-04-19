/**
 * Parse Incus/LXD JSON error bodies into a short user-facing message.
 */
export async function errorMessageFromResponse(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j: unknown = JSON.parse(text);
    if (typeof j === 'object' && j !== null) {
      const rec = j as Record<string, unknown>;
      if (typeof rec.error === 'string' && rec.error.trim()) {
        return rec.error;
      }
      if (typeof rec.message === 'string' && rec.message.trim()) {
        return rec.message;
      }
      const meta = rec.metadata;
      if (typeof meta === 'object' && meta !== null) {
        const m = meta as Record<string, unknown>;
        if (typeof m.err === 'string' && m.err.trim()) return m.err;
      }
    }
  } catch {
    // ignore
  }
  if (text.trim()) return text.slice(0, 500);
  return res.statusText || `HTTP ${res.status}`;
}

export async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  throw new Error(await errorMessageFromResponse(res));
}
