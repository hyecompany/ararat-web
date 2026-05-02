'use client';

import * as React from 'react';
import stableStringify from 'fast-json-stable-stringify';

import { Combobox, ComboboxContent, ComboboxItem, ComboboxTrigger } from '@/components/ui/combobox';
import { useProfiles } from '@/app/(main)/_hooks/profiles';
import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { updateInstanceSettings } from '../../_lib/instance';
import { ManagementFooter } from './footer';

export default function Profiles({
  instance,
  onMutate,
  onBack,
}: {
  instance: Instance;
  onMutate: () => Promise<void>;
  onBack?: () => void;
}) {
  const currentProfiles = React.useMemo(
    () => instance.profiles ?? ['default'],
    [instance.profiles],
  );
  const { data: profiles, isLoading, isValidating } = useProfiles();
  const [draftProfiles, setDraftProfiles] = React.useState<string[]>(currentProfiles);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const lastSyncedSnapshotRef = React.useRef<string>('');
  const lastInstanceNameRef = React.useRef<string | null>(null);
  const saveAbortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      saveAbortControllerRef.current?.abort();
    };
  }, []);

  const serializedCurrentProfiles = React.useMemo(
    () => stableStringify(currentProfiles),
    [currentProfiles],
  );
  const serializedDraftProfiles = React.useMemo(
    () => stableStringify(draftProfiles),
    [draftProfiles],
  );
  const isDirty = serializedDraftProfiles !== serializedCurrentProfiles;

  React.useEffect(() => {
    const instanceChanged = lastInstanceNameRef.current !== instance.name;
    const serverChanged = lastSyncedSnapshotRef.current !== serializedCurrentProfiles;

    if (!instanceChanged && (isDirty || !serverChanged)) {
      return;
    }

    setDraftProfiles(currentProfiles);
    setSaveError(null);
    lastSyncedSnapshotRef.current = serializedCurrentProfiles;
    lastInstanceNameRef.current = instance.name;
  }, [currentProfiles, instance.name, isDirty, serializedCurrentProfiles]);

  const handleCancel = () => {
    setDraftProfiles(currentProfiles);
    setSaveError(null);
    lastSyncedSnapshotRef.current = serializedCurrentProfiles;
  };

  const handleSave = async () => {
    if (!isDirty || isSaving) {
      return;
    }

    try {
      setSaveError(null);
      setIsSaving(true);
      saveAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      saveAbortControllerRef.current = abortController;

      await updateInstanceSettings({
        instance,
        nextProfiles: draftProfiles,
        signal: abortController.signal,
      });
      await onMutate();

      lastSyncedSnapshotRef.current = stableStringify(draftProfiles);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setSaveError(error instanceof Error ? error.message : 'Unable to update instance profiles.');
    } finally {
      saveAbortControllerRef.current = null;
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {saveError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">Profiles</p>
          <Combobox
            multiple
            values={draftProfiles}
            onValuesChange={setDraftProfiles}
            validating={isValidating}
            disabled={isSaving}
          >
            <ComboboxTrigger placeholder="Profiles" id="instance-profiles" />
            <ComboboxContent
              searchPlaceholder="Search profiles..."
              loading={isLoading}
              emptyLabel="No profiles found."
            >
              {profiles?.map((profile) => (
                <ComboboxItem
                  key={profile.name}
                  value={profile.name}
                  description={profile.description}
                >
                  {profile.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        </div>
      </div>

      <ManagementFooter
        backLabel={onBack ? 'Back' : 'Reset'}
        onBack={onBack ?? handleCancel}
        backDisabled={isSaving}
        primaryLabel="Save Changes"
        onPrimary={handleSave}
        primaryDisabled={!isDirty || isSaving}
        primaryLoading={isSaving}
      />
    </div>
  );
}
