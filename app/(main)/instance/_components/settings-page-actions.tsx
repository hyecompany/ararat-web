'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

interface SettingsPageActionsProps {
  isDirty: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  className?: string;
  extraActions?: React.ReactNode;
  saveDisabled?: boolean;
}

export function SettingsPageActions({
  isDirty,
  isSaving,
  onCancel,
  onSave,
  className,
  extraActions,
  saveDisabled = false,
}: SettingsPageActionsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 border-t pt-4', className)}>
      {isDirty ? (
        <Button
          type="button"
          variant="outline"
          disabled={isSaving}
          onClick={onCancel}
        >
          Reset
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">No unsaved changes.</p>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {extraActions}
        <Button
          type="button"
          disabled={isSaving || saveDisabled}
          onClick={() => void onSave()}
        >
          {isSaving ? <Spinner className="mr-2 size-4" /> : null}
          Save changes
        </Button>
      </div>
    </div>
  );
}
