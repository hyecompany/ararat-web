function formatDateTimeLocalValue(date: Date) {
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function toDateTimeLocalValue(value?: string | null) {
  if (!value) return '';

  const date = new Date(value);
  return formatDateTimeLocalValue(date);
}

export function fromDateToLocalDateTimeValue(value: Date) {
  return formatDateTimeLocalValue(value);
}

export function toOptionalIsoDateTime(value?: string | null) {
  if (!value?.trim()) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Enter a valid date and time.');
  }

  return date.toISOString();
}
