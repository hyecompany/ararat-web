export type UnitValue = {
  amount: string;
  unit: string;
  preserveRaw: boolean;
  hasExplicitUnit: boolean;
};

export function parseUnitValue(
  value: string | undefined,
  unitOptions: string[],
  defaultUnit: string,
): UnitValue {
  const fallbackUnit = getCanonicalUnit(defaultUnit, unitOptions) ?? defaultUnit;
  const trimmedValue = value?.trim() ?? '';

  if (!trimmedValue) {
    return {
      amount: '',
      unit: fallbackUnit,
      preserveRaw: false,
      hasExplicitUnit: false,
    };
  }

  const match = trimmedValue.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  if (!match) {
    return {
      amount: trimmedValue,
      unit: fallbackUnit,
      preserveRaw: true,
      hasExplicitUnit: false,
    };
  }

  const [, amount, unit] = match;
  const canonicalUnit = unit ? getCanonicalUnit(unit, unitOptions) : fallbackUnit;

  if (!canonicalUnit) {
    return {
      amount: trimmedValue,
      unit: fallbackUnit,
      preserveRaw: true,
      hasExplicitUnit: Boolean(unit),
    };
  }

  return {
    amount,
    unit: canonicalUnit,
    preserveRaw: false,
    hasExplicitUnit: Boolean(unit),
  };
}

export function formatUnitValue(
  amount: string,
  unit: string,
  unitOptions: string[],
  defaultUnit: string,
) {
  const trimmedAmount = amount.trim();
  if (!trimmedAmount) return '';

  const canonicalUnit =
    getCanonicalUnit(unit, unitOptions) ??
    getCanonicalUnit(defaultUnit, unitOptions) ??
    defaultUnit;

  return `${trimmedAmount}${canonicalUnit}`;
}

function getCanonicalUnit(unit: string, unitOptions: string[]) {
  return unitOptions.find(
    (option) => option.toLowerCase() === unit.toLowerCase(),
  );
}
