'use client';

import * as React from 'react';
import stableStringify from 'fast-json-stable-stringify';
import { CodeXmlIcon } from 'lucide-react';

import { Button } from 'ui-web/components/button';

import type { Device, Instance } from '@/app/(main)/instances/_lib/instances.d';
import InstanceDevices from '@/app/(main)/instances/_components/devices';
import { updateInstanceSettings } from '../../_lib/instance';
import { SettingsYamlEditor } from '../settings-yaml-editor';
import { parseDevicesYaml, serializeDevicesYaml } from '../../_lib/settings-yaml';
import { ManagementFooter } from './footer';
import { ManagementShell } from './shell';

const editorTransitionClassName =
  'h-full animate-in fade-in-0 slide-in-from-bottom-1 duration-200';

export default function Devices({
  instance,
  onMutate,
  onBack,
}: {
  instance: Instance;
  onMutate: () => Promise<void>;
  onBack?: () => void;
}) {
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
    () => (instance.devices as Record<string, Device> | undefined) ?? {},
    [instance.devices],
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
    const instanceChanged = lastInstanceNameRef.current !== instance.name;
    const serverChanged = lastSyncedSnapshotRef.current !== serializedCurrentDevices;

    if (!instanceChanged && (isDirty || !serverChanged)) {
      return;
    }

    setDraftDevices(currentDevices);
    setSaveError(null);
    lastSyncedSnapshotRef.current = serializedCurrentDevices;
    lastInstanceNameRef.current = instance.name;
  }, [currentDevices, instance.name, isDirty, serializedCurrentDevices]);

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
        nextDevices: draftDevices,
        signal: abortController.signal,
      });
      await onMutate();

      lastSyncedSnapshotRef.current = stableStringify(draftDevices);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setSaveError(
        error instanceof Error ? error.message : 'Unable to update instance devices.',
      );
    } finally {
      saveAbortControllerRef.current = null;
      setIsSaving(false);
    }
  };

  return (
    <ManagementShell
      error={saveError}
      footer={
        <ManagementFooter
          left={
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={toggleYamlEditor}
            >
              <CodeXmlIcon className="mr-2 size-4" />
              {showYamlEditor ? 'Back to Wizard' : 'Edit YAML'}
            </Button>
          }
          backLabel={onBack ? 'Back' : 'Reset'}
          onBack={onBack ?? handleCancel}
          backDisabled={isSaving}
          primaryLabel="Save Changes"
          onPrimary={handleSave}
          primaryDisabled={!isDirty || isSaving || Boolean(yamlError)}
          primaryLoading={isSaving}
        />
      }
    >
      {showYamlEditor ? (
        <div
          key="yaml-editor"
          className={editorTransitionClassName}
        >
          <SettingsYamlEditor
            value={yamlContent}
            error={yamlError}
            onChange={handleYamlChange}
            className="h-full"
          />
        </div>
      ) : (
        <div
          key="device-editor"
          className={editorTransitionClassName}
        >
          <div className="h-full min-h-0 overflow-hidden">
            <InstanceDevices
              profiles={instance.profiles ?? ['default']}
              devices={draftDevices}
              onDevicesChange={setDraftDevices}
              instanceType={instanceType}
              project={instance.project ?? null}
              className="rounded-xl border"
            />
          </div>
        </div>
      )}
    </ManagementShell>
  );
}
