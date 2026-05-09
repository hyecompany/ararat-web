const MAX_FILTER_URL_LENGTH = 1700;
const MAX_FILTER_ITEMS = 24;

export function nameEqualsFilter(names: string[]) {
  // Incus' filter parser accepts resource names as bare values here. Names are
  // already URL-encoded by URLSearchParams, so quoting them would make this
  // server reject an otherwise valid filtered collection request.
  return names.map((name) => `name eq ${name}`).join(' or ');
}

export function chunkFilterNames(names: string[], basePath: string) {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const name of names) {
    const next = [...current, name];
    const filter = nameEqualsFilter(next);
    const projectedLength = `${basePath}&filter=${encodeURIComponent(filter)}`.length;
    // Incus filters let us batch many "get these exact names" reads into one
    // collection call. Chunking keeps that optimization inside practical URL and
    // server parser limits.
    if (
      current.length > 0 &&
      (next.length > MAX_FILTER_ITEMS || projectedLength > MAX_FILTER_URL_LENGTH)
    ) {
      chunks.push(current);
      current = [name];
    } else {
      current = next;
    }
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}
