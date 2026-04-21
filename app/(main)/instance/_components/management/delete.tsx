'use client';

import * as React from 'react';

import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Checkbox } from 'ui-web/components/checkbox';
import {
  canDeleteInstance,
  deleteInstance,
  isInstanceDeleteProtected,
  isInstanceRunning,
} from '../../_lib/instance';
import { ManagementFooter } from './footer';

export default function Delete({
  instance,
  onBack,
  onDone,
}: {
  instance: Instance;
  onBack: () => void;
  onDone: () => Promise<void>;
}) {
  const [forceDelete, setForceDelete] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isRunning = isInstanceRunning(instance);
  const isDeleteProtected = isInstanceDeleteProtected(instance);
  const canDelete = canDeleteInstance(instance);
  const canForceDelete = isRunning && !isDeleteProtected;

  React.useEffect(() => {
    setForceDelete(false);
    setError(null);
  }, [instance.name]);

  const handleDelete = async () => {
    if (!canDelete && !(canForceDelete && forceDelete)) {
      return;
    }

    try {
      setError(null);
      setIsSaving(true);
      await deleteInstance(instance, canForceDelete && forceDelete);
      await onDone();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to delete instance.',
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

      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm">
        This action cannot be undone. This will permanently delete{' '}
        <strong>{instance.name}</strong> and all of its data.
      </div>

      {isRunning ? (
        <Alert>
          <AlertTitle>Stop the instance first</AlertTitle>
          <AlertDescription>
            Running instances must be stopped before deletion. You can force a stop
            first and then continue with deletion from here.
          </AlertDescription>
        </Alert>
      ) : null}

      {isDeleteProtected ? (
        <Alert>
          <AlertTitle>Delete protection is enabled</AlertTitle>
          <AlertDescription>
            Disable <code>security.protection.delete</code> before deleting this
            instance.
          </AlertDescription>
        </Alert>
      ) : null}

      {!isRunning && !isDeleteProtected ? (
        <p className="text-sm text-muted-foreground">
          The delete request will be sent immediately and progress will be tracked
          through the existing operation events.
        </p>
      ) : null}

      {canForceDelete ? (
        <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
          <Checkbox
            checked={forceDelete}
            onCheckedChange={(checked) => setForceDelete(checked === true)}
            disabled={isSaving}
            aria-label="Force stop before deleting"
          />
          <span className="space-y-1">
            <span className="block font-medium">Force stop before delete</span>
            <span className="block text-muted-foreground">
              Stop the running instance with force, wait for it to stop, then delete it.
            </span>
          </span>
        </label>
      ) : null}

      <ManagementFooter
        onBack={onBack}
        backDisabled={isSaving}
        primaryLabel={
          canForceDelete && forceDelete ? 'Force stop and delete' : 'Delete instance'
        }
        onPrimary={handleDelete}
        primaryDisabled={(!canDelete && !(canForceDelete && forceDelete)) || isSaving}
        primaryLoading={isSaving}
        primaryVariant="destructive"
      />
    </div>
  );
}
