'use client';

import * as React from 'react';
import stableStringify from 'fast-json-stable-stringify';

import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Button } from 'ui-web/components/button';
import { cn } from 'ui-web/lib/utils';

import GeneralConfiguration from '../../_components/general-configuration';
import { useInstanceContext } from '../_context/instance';
import { updateInstanceSettings } from '../_lib/instance';
import { SettingsPageActions } from '../_components/settings-page-actions';
import { SettingsYamlEditor } from '../_components/settings-yaml-editor';
import {
  parseConfigYaml,
  serializeConfigYaml,
} from '../_lib/settings-yaml';

export default function ConfigurationPage() {
  const { instance, mutate } = useInstanceContext();
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
    () => instance?.config ?? {},
    [instance?.config],
  );
  const expandedConfig = React.useMemo(
    () => instance?.expanded_config ?? {},
    [instance?.expanded_config],
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
    if (!instance) {
      return;
    }

    const instanceChanged = lastInstanceNameRef.current !== instance.name;
    const serverChanged = lastSyncedSnapshotRef.current !== serializedCurrentConfig;

    if (!instanceChanged && (isDirty || !serverChanged)) {
      return;
    }

    setDraftConfig(currentConfig);
    setSaveError(null);
    lastSyncedSnapshotRef.current = serializedCurrentConfig;
    lastInstanceNameRef.current = instance.name;
  }, [currentConfig, instance, isDirty, serializedCurrentConfig]);

  if (!instance) {
    return null;
  }

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
        nextConfig: draftConfig,
        signal: abortController.signal,
      });
      await mutate();

      lastSyncedSnapshotRef.current = stableStringify(draftConfig);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update instance configuration.';
      setSaveError(message);
    } finally {
      saveAbortControllerRef.current = null;
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div
        className={cn(
          'bg-card text-card-foreground flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm',
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
              description="Edit the raw instance configuration YAML. Changes stay synced with the structured editor."
            />
          ) : (
            <GeneralConfiguration
              config={draftConfig}
              expandedConfig={expandedConfig}
              onConfigChange={setDraftConfig}
              instanceType={instanceType}
              configTarget="instance"
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
{showYamlEditor ? 'Back to form' : 'Edit YAML'}
            </Button>
          }
        />
      </div>
    </div>
  );
}
