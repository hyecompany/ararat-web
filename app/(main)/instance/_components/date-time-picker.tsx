'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { Calendar } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { fromDateToLocalDateTimeValue } from '../_lib/date-time';
import { Button } from 'ui-web/components/button';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'ui-web/components/popover';
import { cn } from 'ui-web/lib/utils';

function toDateAndTimeParts(value?: string | null) {
  if (!value) {
    return { date: undefined as Date | undefined, time: '' };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: undefined as Date | undefined, time: '' };
  }

  return {
    date,
    time: value.slice(11, 16),
  };
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const timeInputId = React.useId();
  const { date, time } = React.useMemo(() => toDateAndTimeParts(value), [value]);
  const [timeZone, setTimeZone] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const updateDate = (nextDate?: Date) => {
    if (!nextDate) {
      onChange('');
      return;
    }

    const [hours, minutes] = (time || '00:00').split(':').map((part) => Number(part));
    const merged = new Date(nextDate);
    merged.setHours(hours || 0, minutes || 0, 0, 0);
    onChange(fromDateToLocalDateTimeValue(merged));
  };

  const updateTime = (nextTime: string) => {
    if (!date && !nextTime) {
      onChange('');
      return;
    }

    const base = date ? new Date(date) : new Date();
    const [hours, minutes] = (nextTime || '00:00')
      .split(':')
      .map((part) => Number(part));
    base.setHours(hours || 0, minutes || 0, 0, 0);
    onChange(fromDateToLocalDateTimeValue(base));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={!date}
          className={cn(
            'w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground',
            !date && 'text-muted-foreground',
          )}
        >
          <CalendarIcon data-icon="inline-start" />
          {date ? format(date, 'PPP') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col">
          <Calendar
            mode="single"
            selected={date}
            onSelect={updateDate}
            captionLayout="dropdown"
            timeZone={timeZone}
            className="rounded-lg border-0"
          />
          <Separator />
          <div className="flex flex-col gap-2 p-3">
            <Label htmlFor={timeInputId}>Time</Label>
            <Input
              id={timeInputId}
              type="time"
              value={time}
              onChange={(e) => updateTime(e.target.value)}
              disabled={!date}
              className="w-full"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
