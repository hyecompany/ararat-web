'use client';

export function debugIncusData(message: string, details?: unknown) {
  if (process.env.NODE_ENV === 'production') return;

  const suffix =
    details === undefined
      ? ''
      : ` ${JSON.stringify(details, (_key, value) => {
          if (value instanceof Error) {
            return { name: value.name, message: value.message };
          }
          return value;
        })}`;
  console.info(`[incus:data] ${message}${suffix}`);
}
