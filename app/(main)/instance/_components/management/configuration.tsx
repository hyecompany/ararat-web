'use client';

import * as React from 'react';
import stableStringify from 'fast-json-stable-stringify';
import { CodeXmlIcon } from 'lucide-react';

import { Button } from 'ui-web/components/button';

import GeneralConfiguration from '@/app/(main)/_components/general-configuration';
import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { updateInstanceSettings } from '../../_lib/instance';
import { SettingsYamlEditor } from '../settings-yaml-editor';
import { parseConfigYaml, serializeConfigYaml } from '../../_lib/settings-yaml';
import { ManagementFooter } from './footer';
import { ManagementShell } from './shell';

export default function Configuration({
  instance,
  onMutate,
  onBack,
}: {
  instance: Instance;
  onMutate: () => Promise<void>;
  onBack?: () => void;
}) {
  const [draftConfig, setDraftConfig] = React.useState<Record<string, string>>({});
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

  const currentConfig = React.useMemo(
    () => instance.config ?? {},
    [instance.config],
  );
  const expandedConfig = React.useMemo(
    () => instance.expanded_config ?? {},
    [instance.expanded_config],
  );
  const serializedCurrentConfig = React.useMemo(
    () => stableStringify(currentConfig),
    [currentConfig],
  );
  const serializedDraftConfig = React.useMemo(
    () => stableStringify(draftConfig),
    [draftConfig],
  );
  const isDirty = serializedDraftConfig !== serializedCurrentConfig;

  React.useEffect(() => {
    const instanceChanged = lastInstanceNameRef.current !== instance.name;
    const serverChanged = lastSyncedSnapshotRef.current !== serializedCurrentConfig;

    if (!instanceChanged && (isDirty || !serverChanged)) {
      return;
    }

    setDraftConfig(currentConfig);
    setSaveError(null);
    lastSyncedSnapshotRef.current = serializedCurrentConfig;
    lastInstanceNameRef.current = instance.name;
  }, [currentConfig, instance.name, isDirty, serializedCurrentConfig]);

  const instanceType =
    instance.type === 'virtual-machine' ? 'virtual-machine' : 'container';

  const handleCancel = () => {
    setDraftConfig(currentConfig);
    setSaveError(null);
    setYamlContent(serializeConfigYaml(currentConfig));
    setYamlError(null);
    lastSyncedSnapshotRef.current = serializedCurrentConfig;
  };

  const toggleYamlEditor = () => {
    if (!showYamlEditor) {
      setYamlContent(serializeConfigYaml(draftConfig));
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
      setDraftConfig(parseConfigYaml(value));
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
        nextConfig: draftConfig,
        signal: abortController.signal,
      });
      await onMutate();

      lastSyncedSnapshotRef.current = stableStringify(draftConfig);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      setSaveError(
        error instanceof Error
          ? error.message
          : 'Unable to update instance configuration.',
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
        <SettingsYamlEditor
          value={yamlContent}
          error={yamlError}
          onChange={handleYamlChange}
          description="Edit the raw instance configuration YAML. Changes stay synced with the structured editor."
          className="h-full"
        />
      ) : (
        <div className="h-full min-h-0 overflow-hidden">
          <GeneralConfiguration
            config={draftConfig}
            expandedConfig={expandedConfig}
            onConfigChange={setDraftConfig}
            instanceType={instanceType}
            configTarget="instance"
            className="rounded-xl border"
          />
        </div>
      )}
    </ManagementShell>
  );
}
