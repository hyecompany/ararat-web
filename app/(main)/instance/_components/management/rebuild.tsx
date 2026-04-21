'use client';

import * as React from 'react';
import { z } from 'zod';

import ImageSelector, {
  type SelectableImage,
} from '@/app/(main)/_components/image-selector';
import { useImages } from '@/app/(main)/images/_hooks/images';
import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { fromYaml, toYaml } from '@/app/(main)/_lib/yaml';
import { Button } from 'ui-web/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { CodeXmlIcon } from 'lucide-react';
import { rebuildInstance, type AdvancedInstanceRebuildSource } from '../../_lib/instance';
import { SettingsYamlEditor } from '../settings-yaml-editor';
import { ManagementFooter } from './footer';

type RebuildMode = 'image' | 'empty';

const rebuildSourceSchema = z
  .object({
    type: z.enum(['image', 'none']),
    fingerprint: z.string().trim().min(1).optional(),
    alias: z.string().trim().min(1).optional(),
    server: z.string().trim().min(1).optional(),
    mode: z.literal('pull').optional(),
    protocol: z.enum(['simplestreams', 'oci']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'none') {
      return;
    }

    const hasFingerprint = Boolean(value.fingerprint);
    const hasAliasAndServer = Boolean(value.alias && value.server);

    if (!hasFingerprint && !hasAliasAndServer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Image source YAML must include fingerprint or both alias and server.',
      });
    }
  });

export default function Rebuild({
  instance,
  onBack,
  onDone,
}: {
  instance: Instance;
  onBack: () => void;
  onDone: () => Promise<void>;
}) {
  const { data: localImagesData } = useImages(instance.project ?? null);
  const [selectedImage, setSelectedImage] = React.useState<SelectableImage | null>(null);
  const [rebuildMode, setRebuildMode] = React.useState<RebuildMode>('image');
  const [showSourceYamlEditor, setShowSourceYamlEditor] = React.useState(false);
  const [sourceYamlContent, setSourceYamlContent] = React.useState('');
  const [sourceYamlError, setSourceYamlError] = React.useState<string | null>(null);
  const [yamlSourceOverride, setYamlSourceOverride] =
    React.useState<AdvancedInstanceRebuildSource | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initializedDefaultSourceRef = React.useRef(false);

  const projectLabel = instance.project
    ? `Project · ${instance.project}`
    : 'Project · default';
  const localSelectableImages = React.useMemo<SelectableImage[]>(() => {
    if (!localImagesData) {
      return [];
    }

    return localImagesData.map((image) => ({
      id: `local-${image.fingerprint}`,
      local: true,
      label:
        image.aliases?.[0]?.name ?? image.properties.os ?? image.fingerprint,
      os: image.properties.os,
      release: image.properties.release,
      variant: image.properties.variant,
      arch: image.architecture,
      types: image.type ? [image.type as 'container' | 'virtual-machine'] : [],
      fingerprint: image.fingerprint,
    }));
  }, [localImagesData]);

  React.useEffect(() => {
    setSelectedImage(null);
    setRebuildMode('image');
    setShowSourceYamlEditor(false);
    setSourceYamlContent('');
    setSourceYamlError(null);
    setYamlSourceOverride(null);
    setError(null);
    initializedDefaultSourceRef.current = false;
  }, [instance.name]);

  const getSelectedImageSource = React.useCallback((): AdvancedInstanceRebuildSource => {
    if (!selectedImage) {
      throw new Error('Select an image before rebuilding this instance.');
    }

    if (selectedImage.local && selectedImage.fingerprint) {
      return {
        type: 'image',
        fingerprint: selectedImage.fingerprint,
      };
    }

    if (selectedImage.remote?.alias && selectedImage.remote?.server) {
      return {
        type: 'image',
        alias: selectedImage.remote.alias,
        server: selectedImage.remote.server,
        mode: 'pull',
        protocol: selectedImage.remote.protocol,
      };
    }

    throw new Error('The selected image is missing the data needed for rebuild.');
  }, [selectedImage]);

  const getRebuildSource = React.useCallback((): AdvancedInstanceRebuildSource => {
    if (yamlSourceOverride) {
      return yamlSourceOverride;
    }

    if (rebuildMode === 'empty') {
      return { type: 'none' };
    }

    return getSelectedImageSource();
  }, [getSelectedImageSource, rebuildMode, yamlSourceOverride]);

  const updateYamlSourceOverride = React.useCallback(
    (
      nextSource: AdvancedInstanceRebuildSource | null,
      skipContentUpdate = false,
    ) => {
      setYamlSourceOverride(nextSource);

      if (!nextSource) {
        setSourceYamlError(null);
        return;
      }

      if (!skipContentUpdate) {
        setSourceYamlContent(
          toYaml(nextSource as unknown as Record<string, unknown>),
        );
      }
      setSourceYamlError(null);
    },
    [],
  );

  const syncSelectedImageFromSource = React.useCallback(
    (nextSource: AdvancedInstanceRebuildSource) => {
      if (nextSource.type !== 'image') {
        setSelectedImage(null);
        return;
      }

      if (nextSource.fingerprint) {
        setSelectedImage((current) => {
          if (current?.fingerprint === nextSource.fingerprint) {
            return current;
          }

          return (
            localSelectableImages.find(
              (image) => image.fingerprint === nextSource.fingerprint,
            ) ?? null
          );
        });
        return;
      }

      if (nextSource.alias && nextSource.server) {
        setSelectedImage((current) =>
          current?.remote?.alias === nextSource.alias &&
          current?.remote?.server === nextSource.server
            ? current
            : null,
        );
        return;
      }

      setSelectedImage(null);
    },
    [localSelectableImages],
  );

  const defaultRebuildSource = React.useMemo<AdvancedInstanceRebuildSource | null>(() => {
    const fingerprint =
      instance.expanded_config?.['volatile.base_image'] ??
      instance.config?.['volatile.base_image'] ??
      null;
    if (fingerprint) {
      return {
        type: 'image',
        fingerprint,
      };
    }

    return null;
  }, [instance.config, instance.expanded_config]);

  React.useEffect(() => {
    if (initializedDefaultSourceRef.current || !defaultRebuildSource) {
      return;
    }

    setRebuildMode('image');
    updateYamlSourceOverride(defaultRebuildSource);

    if (localImagesData !== undefined) {
      syncSelectedImageFromSource(defaultRebuildSource);
      initializedDefaultSourceRef.current = true;
    }
  }, [
    defaultRebuildSource,
    localImagesData,
    syncSelectedImageFromSource,
    updateYamlSourceOverride,
  ]);

  const handleSourceYamlChange = React.useCallback(
    (value: string | undefined) => {
      const nextValue = value ?? '';
      setSourceYamlContent(nextValue);

      try {
        const parsed = fromYaml(nextValue);
        const nextSource = rebuildSourceSchema.parse(parsed) as AdvancedInstanceRebuildSource;

        if (nextSource.type === 'none') {
          setRebuildMode('empty');
          updateYamlSourceOverride(nextSource, true);
          syncSelectedImageFromSource(nextSource);
          return;
        }

        setRebuildMode('image');
        updateYamlSourceOverride(nextSource, true);
        syncSelectedImageFromSource(nextSource);
      } catch (yamlError) {
        setSourceYamlError(
          yamlError instanceof z.ZodError
            ? yamlError.issues[0]?.message ?? 'Invalid source YAML.'
            : yamlError instanceof Error
              ? yamlError.message
              : 'Invalid source YAML.',
        );
      }
    },
    [syncSelectedImageFromSource, updateYamlSourceOverride],
  );

  const handleToggleSourceYamlEditor = React.useCallback(() => {
    if (!showSourceYamlEditor) {
      try {
        const currentSource = getRebuildSource();
        setSourceYamlContent(
          toYaml(currentSource as unknown as Record<string, unknown>),
        );
        setSourceYamlError(null);
      } catch {
        setSourceYamlContent(
          toYaml({ type: rebuildMode } as unknown as Record<string, unknown>),
        );
      }
    }

    setShowSourceYamlEditor((current) => !current);
  }, [getRebuildSource, rebuildMode, showSourceYamlEditor]);

  const handleRebuildModeChange = React.useCallback(
    (nextMode: RebuildMode) => {
      setRebuildMode(nextMode);
      setSourceYamlError(null);

      if (nextMode === 'empty') {
        const emptySource: AdvancedInstanceRebuildSource = { type: 'none' };
        updateYamlSourceOverride(emptySource);
        setSourceYamlContent(toYaml(emptySource as Record<string, unknown>));
        return;
      }

      updateYamlSourceOverride(null);

      try {
        const imageSource = getSelectedImageSource();
        setSourceYamlContent(toYaml(imageSource as Record<string, unknown>));
      } catch {
        setSourceYamlContent(toYaml({ type: 'image' } as Record<string, unknown>));
      }
    },
    [getSelectedImageSource, updateYamlSourceOverride],
  );

  const handleRebuildImageSelect = React.useCallback(
    (image: SelectableImage) => {
      setSelectedImage(image);
      updateYamlSourceOverride(null);
      setSourceYamlError(null);
    },
    [updateYamlSourceOverride],
  );

  const handleRebuild = async () => {
    try {
      setError(null);
      setIsSaving(true);
      const source = getRebuildSource();
      await rebuildInstance({ instance, source });
      await onDone();
    } catch (rebuildError) {
      setError(
        rebuildError instanceof Error
          ? rebuildError.message
          : 'Unable to rebuild instance.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!showSourceYamlEditor ? (
          <div className="mb-4 grid gap-2">
            <p className="text-sm font-medium">Rebuild source</p>
            <Select
              value={rebuildMode}
              onValueChange={(value) =>
                handleRebuildModeChange(value as RebuildMode)
              }
              disabled={isSaving}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Select rebuild source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="empty">Empty rebuild</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {rebuildMode === 'image' ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {showSourceYamlEditor ? (
              <SettingsYamlEditor
                value={sourceYamlContent}
                error={sourceYamlError}
                onChange={handleSourceYamlChange}
                className="h-full"
              />
            ) : (
              <ImageSelector
                selectedImage={selectedImage}
                onSelect={handleRebuildImageSelect}
                instanceType={
                  instance.type === 'virtual-machine'
                    ? 'virtual-machine'
                    : 'container'
                }
                project={instance.project ?? null}
                projectLabel={projectLabel}
                emptyDescription="Select the image to use for the rebuild."
                defaultSelection={{
                  fingerprint:
                    instance.expanded_config?.['volatile.base_image'] ??
                    instance.config?.['volatile.base_image'] ??
                    null,
                  alias: instance.config?.['image.alias'] ?? null,
                  description: instance.config?.['image.description'] ?? null,
                }}
                disableAutoSelect={showSourceYamlEditor}
              />
            )}
          </div>
        ) : (
          <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            An empty rebuild recreates the instance without selecting an image source.
          </div>
        )}
      </div>

      <ManagementFooter
        left={
          rebuildMode === 'image' ? (
            <Button
              variant="outline"
              onClick={handleToggleSourceYamlEditor}
              disabled={isSaving}
            >
              <CodeXmlIcon className="mr-2 h-4 w-4" />
              {showSourceYamlEditor ? 'Back to Wizard' : 'Edit YAML'}
            </Button>
          ) : null
        }
        onBack={onBack}
        backDisabled={isSaving}
        primaryLabel="Rebuild Instance"
        onPrimary={handleRebuild}
        primaryDisabled={
          Boolean(sourceYamlError) ||
          (rebuildMode === 'image' && !selectedImage && !yamlSourceOverride)
        }
        primaryLoading={isSaving}
      />
    </div>
  );
}
