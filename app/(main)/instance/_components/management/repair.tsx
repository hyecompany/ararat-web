'use client';

import * as React from 'react';

import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { repairInstance } from '../../_lib/instance';
import { ManagementFooter } from './footer';

export default function Repair({
  instance,
  onBack,
  onDone,
}: {
  instance: Instance;
  onBack: () => void;
  onDone: () => Promise<void>;
}) {
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleRepair = async () => {
    try {
      setError(null);
      setIsSaving(true);
      await repairInstance({
        instance,
        action: 'rebuild-config-volume',
      });
      await onDone();
    } catch (repairError) {
      setError(
        repairError instanceof Error
          ? repairError.message
          : 'Unable to repair instance.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Supported action</span>
          <Badge variant="outline">rebuild-config-volume</Badge>
        </div>
        <p className="mt-2 text-muted-foreground">
          This triggers the currently supported low-level repair action exposed by
          Incus for this instance.
        </p>
      </div>

      <ManagementFooter
        onBack={onBack}
        backDisabled={isSaving}
        primaryLabel="Run repair"
        onPrimary={handleRepair}
        primaryLoading={isSaving}
      />
    </div>
  );
}
