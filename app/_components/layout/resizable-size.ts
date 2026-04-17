export type PanelSize = number | string;

/**
 * Normalizes legacy panel sizes for `react-resizable-panels` v4.
 *
 * Numeric inputs are treated as percentages, so `50` becomes `'50%'`.
 * String inputs are passed through unchanged and should already be valid
 * panel size values such as `'50%'`, `'200px'`, `'20rem'`, or `'50vh'`.
 */
export function toPanelSize(size: PanelSize): string {
  return typeof size === 'number' ? `${size}%` : size;
}
