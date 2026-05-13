'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from './command';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { XIcon } from 'lucide-react';
import { ComboboxOptionsSkeleton } from './skeleton-patterns';

interface ComboboxContextValue {
  value?: string;
  label?: string;
  setSelected: (value: string, label: string | undefined) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
  triggerWidth?: number;
  setTriggerWidth: (width: number) => void;
  defaultValue?: string;
  allowDeselect?: boolean;
  validating?: boolean;
  multiple?: boolean;
  values?: string[];
  toggleValue: (value: string) => void;
}

const ComboboxContext = React.createContext<ComboboxContextValue | null>(null);

function useComboboxContext() {
  const ctx = React.useContext(ComboboxContext);
  if (!ctx)
    throw new Error('Combobox components must be used within <Combobox />');
  return ctx;
}

type ComboboxProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  values?: string[];
  onValuesChange?: (values: string[]) => void;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  allowDeselect?: boolean;
  validating?: boolean;
  multiple?: boolean;
};

function Combobox({
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  open: controlledOpen,
  onOpenChange,
  disabled,
  allowDeselect,
  validating,
  multiple,
  values: controlledValues,
  onValuesChange,
}: ComboboxProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState<
    string | undefined
  >(defaultValue);
  const [uncontrolledValues, setUncontrolledValues] = React.useState<string[]>(
    () => {
      if (multiple) {
        return defaultValue ? [defaultValue] : [];
      }
      return [];
    },
  );
  const [label, setLabel] = React.useState<string | undefined>(undefined);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const value =
    controlledValue !== undefined ? controlledValue : uncontrolledValue;
  const values = multiple
    ? controlledValues !== undefined
      ? controlledValues
      : uncontrolledValues
    : undefined;
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;

  const setSelected = React.useCallback(
    (v: string, l: string | undefined) => {
      if (controlledValue === undefined) setUncontrolledValue(v);
      setLabel(l);
      onValueChange?.(v);
      if (controlledOpen === undefined) setUncontrolledOpen(false);
      onOpenChange?.(false);
    },
    [controlledValue, onValueChange, controlledOpen, onOpenChange],
  );

  const toggleValue = React.useCallback(
    (v: string) => {
      if (!multiple) return;
      const current = values ? [...values] : [];
      const exists = current.includes(v);
      let next = exists ? current.filter((x) => x !== v) : [...current, v];
      if (next.length === 0 && defaultValue) next = [defaultValue];
      if (controlledValues === undefined) setUncontrolledValues(next);
      onValuesChange?.(next);
    },
    [multiple, values, defaultValue, controlledValues, onValuesChange],
  );

  const setOpen = React.useCallback(
    (o: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(o);
      onOpenChange?.(o);
    },
    [controlledOpen, onOpenChange],
  );

  React.useEffect(() => {
    if (multiple) return; // single-value label derivation only
    if (!value || label) return;
    const search = (nodes: React.ReactNode): string | undefined => {
      let found: string | undefined;
      React.Children.forEach(nodes, (child) => {
        if (found) return;
        if (React.isValidElement(child)) {
          const el = child as React.ReactElement & { props: any };
          const elType: any = el.type;
          const elProps = el.props || {};
          if (
            elType?.displayName === 'ComboboxItem' &&
            elProps.value === value
          ) {
            if (typeof elProps.children === 'string') found = elProps.children;
          } else if (elProps.children) {
            found = search(elProps.children);
          }
        }
      });
      return found;
    };
    const derived = search(children);
    if (derived) setLabel(derived);
  }, [value, label, children, multiple]);

  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  const [triggerWidth, setTriggerWidthState] = React.useState<
    number | undefined
  >(undefined);
  const setTriggerWidth = React.useCallback((w: number) => {
    setTriggerWidthState(w);
  }, []);

  return (
    <ComboboxContext.Provider
      value={{
        value,
        label,
        setSelected,
        open,
        setOpen,
        disabled,
        triggerWidth,
        setTriggerWidth,
        defaultValue,
        allowDeselect,
        validating,
        multiple,
        values,
        toggleValue,
      }}
    >
      <span
        ref={wrapperRef}
        className="flex flex-col w-full"
        style={{ maxWidth: '100%' }}
      >
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
          {children}
        </PopoverPrimitive.Root>
      </span>
    </ComboboxContext.Provider>
  );
}

function ComboboxTrigger({
  className,
  size = 'default',
  children,
  placeholder,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger> & {
  size?: 'sm' | 'default';
  placeholder?: string;
}) {
  const {
    label,
    open,
    setOpen,
    disabled,
    setTriggerWidth,
    multiple,
    values,
    toggleValue,
    defaultValue,
  } = useComboboxContext();
  const ref = React.useRef<HTMLButtonElement | null>(null);

  // Use callback ref + layout effect for immediate measurement before first paint.
  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      if (!node) return;
      ref.current = node;
      const measure = () =>
        setTriggerWidth(Math.ceil(node.getBoundingClientRect().width));
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(node);
      window.addEventListener('resize', measure);
      // store cleanup on node
      (node as any)._comboboxCleanup = () => {
        ro.disconnect();
        window.removeEventListener('resize', measure);
      };
    },
    [setTriggerWidth],
  );

  React.useEffect(() => {
    return () => {
      const node = ref.current as any;
      if (node?._comboboxCleanup) node._comboboxCleanup();
    };
  }, []);

  return (
    <PopoverPrimitive.Trigger
      ref={setRef}
      data-slot="combobox-trigger"
      data-size={size}
      data-state={open ? 'open' : 'closed'}
      disabled={disabled}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=combobox-value]:line-clamp-1 *:data-[slot=combobox-value]:flex *:data-[slot=combobox-value]:items-center *:data-[slot=combobox-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children ??
        (multiple ? (
          values && values.length ? (
            <ComboboxValue>
              <span className="flex flex-wrap gap-1 max-w-full">
                {values.map((v) => {
                  const isDefault = v === defaultValue;
                  const canRemoveDefault = !isDefault || values.length > 1;
                  return (
                    <Badge
                      key={v}
                      variant="secondary"
                      className="max-w-40 truncate px-2 py-0.5 flex items-center gap-2"
                    >
                      <span className="truncate" title={v}>
                        {v}
                      </span>
                      {canRemoveDefault && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${v}`}
                          className="inline-flex items-center justify-center rounded-full hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleValue(v);
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.key === 'Enter' ||
                              e.key === ' ' ||
                              e.key === 'Spacebar'
                            ) {
                              e.stopPropagation();
                              e.preventDefault();
                              toggleValue(v);
                            }
                          }}
                        >
                          <XIcon className="size-3" />
                        </span>
                      )}
                    </Badge>
                  );
                })}
              </span>
            </ComboboxValue>
          ) : (
            <ComboboxValue placeholder={placeholder} />
          )
        ) : label ? (
          <ComboboxValue>{label}</ComboboxValue>
        ) : (
          <ComboboxValue placeholder={placeholder} />
        ))}
      <ChevronDownIcon className="size-4 opacity-50" />
    </PopoverPrimitive.Trigger>
  );
}

function ComboboxValue({
  className,
  children,
  placeholder,
}: {
  className?: string;
  children?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <span
      data-slot="combobox-value"
      data-placeholder={children ? undefined : placeholder ? 'true' : undefined}
      className={cn(
        'flex items-center gap-2',
        // Muted color when placeholder state (no children content)
        !children && placeholder && 'text-muted-foreground',
        className,
      )}
    >
      {children || placeholder}
    </span>
  );
}

function ComboboxContent({
  className,
  children,
  align = 'center',
  sideOffset = 4,
  searchPlaceholder = 'Search...',
  emptyLabel = 'No results found.',
  loading = false,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  searchPlaceholder?: string;
  emptyLabel?: string;
  loading?: boolean;
}) {
  const { setOpen, triggerWidth } = useComboboxContext();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="combobox-content"
        align={align}
        sideOffset={sideOffset}
        style={
          triggerWidth
            ? { width: triggerWidth, minWidth: triggerWidth }
            : undefined
        }
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 rounded-md border p-0 shadow-md outline-hidden overflow-hidden',
          className,
        )}
        onEscapeKeyDown={() => setOpen(false)}
        onPointerDownOutside={(e) => {
          if (
            e.target &&
            (e.target as HTMLElement).getAttribute('data-slot') ===
              'combobox-trigger'
          )
            return;
          setOpen(false);
        }}
        {...props}
      >
        <Command className="[&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-1.5">
          <CommandInput placeholder={searchPlaceholder} disabled={loading} />
          {loading ? (
            <ComboboxOptionsSkeleton />
          ) : (
            <>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandList className="p-1">{children}</CommandList>
            </>
          )}
        </Command>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function ComboboxItem({
  className,
  children,
  value,
  onSelect,
  disabled,
  description,
  ...props
}: React.ComponentProps<typeof CommandItem> & {
  value: string;
  description?: string;
}) {
  const {
    setSelected,
    value: selectedValue,
    allowDeselect,
    defaultValue,
    validating,
    multiple,
    values,
    toggleValue,
  } = useComboboxContext();
  return (
    <CommandItem
      data-slot="combobox-item"
      value={value}
      onSelect={(v: string) => {
        if (disabled) return;
        // If deselect allowed and clicking current selection, revert to defaultValue
        if (multiple) {
          toggleValue(v);
          onSelect?.(v);
          return;
        }
        if (allowDeselect && selectedValue === value) {
          const revert = defaultValue ?? '';
          setSelected(revert, undefined);
          onSelect?.(revert);
          return;
        }
        setSelected(v, typeof children === 'string' ? children : String(v));
        onSelect?.(v);
      }}
      disabled={disabled as any}
      className={cn(
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        validating && 'freshness-shimmer',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        {multiple
          ? values && values.includes(value) && <CheckIcon className="size-4" />
          : selectedValue === value && <CheckIcon className="size-4" />}
      </span>
      <span className="flex flex-col items-start gap-0.5">
        <span className="font-medium leading-none">{children}</span>
        {description && (
          <span className="text-muted-foreground text-xs leading-snug line-clamp-2">
            {description}
          </span>
        )}
      </span>
    </CommandItem>
  );
}
ComboboxItem.displayName = 'ComboboxItem';

function ComboboxGroup({
  className,
  children,
  heading,
  ...props
}: React.ComponentProps<typeof CommandGroup> & { heading?: string }) {
  return (
    <CommandGroup
      data-slot="combobox-group"
      heading={heading}
      className={cn(
        'p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        className,
      )}
      {...props}
    >
      {children}
    </CommandGroup>
  );
}

function ComboboxLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="combobox-label"
      className={cn(
        'text-muted-foreground px-2 py-1.5 text-xs font-medium',
        className,
      )}
    >
      {children}
    </div>
  );
}

function ComboboxSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandSeparator>) {
  return (
    <CommandSeparator
      data-slot="combobox-separator"
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
  ComboboxValue,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxSeparator,
};
