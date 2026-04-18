'use client';

import * as React from 'react';
import stableStringify from 'fast-json-stable-stringify';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Button } from 'ui-web/components/button';
import { cn } from 'ui-web/lib/utils';

import { useInstanceContext } from '../_context/instance';
import { updateInstanceSettings } from '../_lib/instance';
import { SettingsPageActions } from '../_components/settings-page-actions';
import { SettingsYamlEditor } from '../_components/settings-yaml-editor';
import {
  parseDevicesYaml,
  serializeDevicesYaml,
} from '../_lib/settings-yaml';
import InstanceDevices from '../../instances/_components/devices';
import type { Device } from '../../instances/_lib/instances.d';

export default function DevicesPage() {
  const { instance, mutate } = useInstanceContext();
  const [draftDevices, setDraftDevices] = React.useState<Record<string, Device>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [showYamlEditor, setShowYamlEditor] = React.useState(false);
  const [yamlContent, setYamlContent] = React.useState('');
  const [yamlError, setYamlError] = React.useState<string | null>(null);
  const lastSyncedSnapshotRef = React.useRef<string>('');
  const lastInstanceNameRef = React.useRef<string | null>(null);
  const saveAbortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      saveAbortControllerRef.current?.abort();
    };
  }, []);

  const currentDevices = React.useMemo(
    () => ((instance?.devices as Record<string, Device> | undefined) ?? {}),
    [instance?.devices],
  );
  const serializedCurrentDevices = React.useMemo(
    () => stableStringify(currentDevices),
    [currentDevices],
  );
  const serializedDraftDevices = React.useMemo(
    () => stableStringify(draftDevices),
    [draftDevices],
  );
  const isDirty = serializedDraftDevices !== serializedCurrentDevices;

  React.useEffect(() => {
    if (!instance) {
      return;
    }

    const instanceChanged = lastInstanceNameRef.current !== instance.name;
    const serverChanged = lastSyncedSnapshotRef.current !== serializedCurrentDevices;

    if (!instanceChanged && (isDirty || !serverChanged)) {
      return;
    }

    setDraftDevices(currentDevices);
    setSaveError(null);
    lastSyncedSnapshotRef.current = serializedCurrentDevices;
    lastInstanceNameRef.current = instance.name;
  }, [currentDevices, instance, isDirty, serializedCurrentDevices]);

  if (!instance) {
    return null;
  }

  const instanceType =
    instance.type === 'virtual-machine' ? 'virtual-machine' : 'container';

  const handleCancel = () => {
    setDraftDevices(currentDevices);
    setSaveError(null);
    setYamlContent(serializeDevicesYaml(currentDevices));
    setYamlError(null);
    lastSyncedSnapshotRef.current = serializedCurrentDevices;
  };

  const toggleYamlEditor = () => {
    if (!showYamlEditor) {
      setYamlContent(serializeDevicesYaml(draftDevices));
      setYamlError(null);
    }
    setShowYamlEditor((current) => !current);
  };

  const handleYamlChange = (value: string | undefined) => {
    if (!value) {
      return;
    }

    setYamlContent(value);

    try {
      setDraftDevices(parseDevicesYaml(value));
      setYamlError(null);
    } catch (error) {
      setYamlError(
        error instanceof Error ? error.message : 'Invalid YAML syntax.',
      );
    }
  };

  const handleSave = async () => {
    if (!instance || !isDirty || isSaving) {
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
        nextDevices: draftDevices,
        signal: abortController.signal,
      });
      await mutate();

      lastSyncedSnapshotRef.current = stableStringify(draftDevices);
      toast.success('Instance devices updated');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update instance devices.';
      setSaveError(message);
      toast.error(message);
    } finally {
      saveAbortControllerRef.current = null;
      setIsSaving(false);
    }
  };

  return (
    <div
      className={cn(
        'bg-card text-card-foreground flex h-full min-h-[32rem] flex-col overflow-hidden rounded-xl border shadow-sm',
      )}
    >
      {saveError ? (
        <Alert variant="destructive" className="mx-6 mt-6">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="min-h-0 flex-1">
        {showYamlEditor ? (
          <SettingsYamlEditor
            value={yamlContent}
            error={yamlError}
            onChange={handleYamlChange}
            description="Edit the raw instance devices YAML. Changes stay synced with the structured editor."
          />
        ) : (
          <InstanceDevices
            profiles={instance.profiles ?? ['default']}
            devices={draftDevices}
            onDevicesChange={setDraftDevices}
            instanceType={instanceType}
            className="rounded-none border-0"
          />
        )}
      </div>
      <SettingsPageActions
        isDirty={isDirty}
        isSaving={isSaving}
        onCancel={handleCancel}
        onSave={handleSave}
        className="px-6 py-4"
        saveDisabled={Boolean(yamlError)}
        extraActions={
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={toggleYamlEditor}
          >
            {showYamlEditor ? 'Back to editor' : 'Edit YAML'}
          </Button>
        }
      />
    </div>
  );
}
