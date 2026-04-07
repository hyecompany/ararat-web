'use client';

import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Input } from 'ui-web/components/input';
import { formatUnitValue, parseUnitValue } from '@/app/_lib/instance-units';
import { cn } from 'ui-web/lib/utils';

type UnitInputProps = {
  id: string;
  value: string | undefined;
  unitOptions: string[];
  defaultUnit: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
  selectClassName?: string;
  wrapperClassName?: string;
};

export function UnitInput({
  id,
  value,
  unitOptions,
  defaultUnit,
  onValueChange,
  disabled,
  placeholder,
  inputClassName,
  selectClassName = 'h-9 w-24 shrink-0',
  wrapperClassName = 'flex items-center gap-2',
}: UnitInputProps) {
  const parsedValue = React.useMemo(
    () => parseUnitValue(value, unitOptions, defaultUnit),
    [defaultUnit, unitOptions, value],
  );
  const [selectedUnit, setSelectedUnit] = React.useState(parsedValue.unit);

  React.useEffect(() => {
    if (!parsedValue.preserveRaw && value?.trim()) {
      setSelectedUnit(parsedValue.unit);
    }
  }, [parsedValue.preserveRaw, parsedValue.unit, value]);

  const handleAmountChange = (amount: string) => {
    const nextValue = parseUnitValue(amount, unitOptions, defaultUnit);

    if (nextValue.preserveRaw) {
      onValueChange(amount);
      return;
    }

    if (
      amount.trim() &&
      nextValue.hasExplicitUnit &&
      nextValue.unit !== selectedUnit
    ) {
      setSelectedUnit(nextValue.unit);
    }

    const unit = nextValue.hasExplicitUnit ? nextValue.unit : selectedUnit;

    onValueChange(
      formatUnitValue(
        nextValue.amount,
        unit,
        unitOptions,
        defaultUnit,
      ),
    );
  };

  const handleUnitChange = (unit: string) => {
    setSelectedUnit(unit);
    if (!parsedValue.amount || parsedValue.preserveRaw) return;

    onValueChange(
      formatUnitValue(parsedValue.amount, unit, unitOptions, defaultUnit),
    );
  };

  return (
    <div className={wrapperClassName}>
      <Input
        id={id}
        value={parsedValue.amount}
        placeholder={placeholder}
        onChange={(event) => handleAmountChange(event.target.value)}
        disabled={disabled}
        className={inputClassName}
      />
      {!parsedValue.preserveRaw && (
        <div className={cn('relative shrink-0', selectClassName)}>
          <select
            value={selectedUnit}
            onChange={(event) => handleUnitChange(event.target.value)}
            disabled={disabled}
            className="border-input data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 h-full w-full appearance-none rounded-md border bg-transparent px-3 py-1 pr-8 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] [color-scheme:light] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:[color-scheme:dark] [&_option]:bg-popover [&_option]:text-popover-foreground"
          >
            {unitOptions.map((unit) => (
              <option key={unit} value={unit} className="bg-popover text-popover-foreground">
                {unit}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50" />
        </div>
      )}
    </div>
  );
}
