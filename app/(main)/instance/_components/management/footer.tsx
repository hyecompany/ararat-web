'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';

export function ManagementFooter({
  left,
  backLabel = 'Back',
  onBack,
  backDisabled = false,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryLoading = false,
  primaryVariant,
}: {
  left?: React.ReactNode;
  backLabel?: string;
  onBack: () => void;
  backDisabled?: boolean;
  primaryLabel: string;
  onPrimary: () => void | Promise<void>;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  primaryVariant?: 'default' | 'destructive';
}) {
  return (
    <DialogFooter className="mt-4 flex w-full flex-row items-center justify-between gap-3 pt-4 sm:flex-row sm:justify-between">
      <div className="flex items-center">{left}</div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack} disabled={backDisabled}>
          {backLabel}
        </Button>
        <Button
          variant={primaryVariant}
          loading={primaryLoading}
          disabled={primaryDisabled}
          onClick={() => void onPrimary()}
        >
          {primaryLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}
