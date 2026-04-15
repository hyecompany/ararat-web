'use client';

import * as React from 'react';

import { CheckIcon } from 'lucide-react';
import { Input } from 'ui-web/components/input';
import { cn } from 'ui-web/lib/utils';

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

interface AutocompleteInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
}

export function AutocompleteInput({
  value,
  onValueChange,
  options,
  className,
  disabled,
  onFocus,
  onBlur,
  ...props
}: AutocompleteInputProps) {
  const [open, setOpen] = React.useState(false);
  const [triggerWidth, setTriggerWidth] = React.useState<number>();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const filteredOptions = React.useMemo(() => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalized));
  }, [options, value]);

  React.useEffect(() => {
    const node = inputRef.current;
    if (!node) return;

    const updateWidth = () => setTriggerWidth(Math.ceil(node.getBoundingClientRect().width));
    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(node);
    window.addEventListener('resize', updateWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  return (
    <Popover open={!disabled && open && filteredOptions.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="w-full">
          <Input
            {...props}
            ref={inputRef}
            value={value}
            disabled={disabled}
            className={className}
            autoComplete="off"
            onFocus={(event) => {
              setOpen(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              onBlur?.(event);
            }}
            onChange={(event) => {
              onValueChange(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
              }
              props.onKeyDown?.(event);
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="p-0"
        style={triggerWidth ? { width: triggerWidth } : undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Node && inputRef.current?.contains(target)) {
            event.preventDefault();
          }
        }}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {filteredOptions.map((option) => {
                const isSelected = option === value;
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onMouseDown={(event) => event.preventDefault()}
                    onSelect={(selectedValue) => {
                      onValueChange(selectedValue);
                      setOpen(false);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="flex-1">{option}</span>
                    <CheckIcon
                      className={cn('size-4 opacity-0', isSelected && 'opacity-100')}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
