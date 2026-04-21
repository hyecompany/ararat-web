'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  CodeXmlIcon,
  PackageIcon,
  RefreshCcwDotIcon,
  Settings2Icon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';

import { OSLogo } from '@/app/_components/OSLogo';
import ImageSelector, {
  type SelectableImage,
} from '@/app/(main)/_components/image-selector';
import { useStoragePools } from '@/app/(main)/_hooks/storagePools';
import { fromYaml, toYaml } from '@/app/(main)/_lib/yaml';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Badge } from 'ui-web/components/badge';
import { Button } from 'ui-web/components/button';
import { Checkbox } from 'ui-web/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'ui-web/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';
import {
  canDeleteInstance,
  deleteInstance,
  isInstanceDeleteProtected,
  isInstanceRunning,
  rebuildInstance,
  repairInstance,
  type AdvancedInstanceRebuildSource,
} from '../_lib/instance';
import { SettingsYamlEditor } from './settings-yaml-editor';
import { getBaseImage } from '../_lib/utils';
import type { Instance } from '../../instances/_lib/instances.d';

type ActionView = 'menu' | 'delete' | 'rebuild' | 'repair';
type RebuildMode = 'image' | 'empty';

export function InstanceActionsMenu({
  instance,
  disabled = false,
  onMutate,
}: {
  instance: Instance;
  disabled?: boolean;
  onMutate: () => Promise<void>;
}) {
  const router = useRouter();
  const { data: storagePools } = useStoragePools();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<ActionView>('menu');
  const [busyAction, setBusyAction] = React.useState<ActionView | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [rebuildMode, setRebuildMode] = React.useState<RebuildMode>('image');
  const [forceDelete, setForceDelete] = React.useState(false);
  const [selectedImage, setSelectedImage] =
    React.useState<SelectableImage | null>(null);
  const [showSourceYamlEditor, setShowSourceYamlEditor] = React.useState(false);
  const [sourceYamlContent, setSourceYamlContent] = React.useState('');
  const [sourceYamlError, setSourceYamlError] = React.useState<string | null>(null);
  const [yamlSourceOverride, setYamlSourceOverride] =
    React.useState<AdvancedInstanceRebuildSource | null>(null);

  const rootDiskPoolName =
    instance.expanded_devices?.root?.pool ?? instance.devices?.root?.pool ?? null;
  const rootDiskPool =
    storagePools?.find((pool) => pool.name === rootDiskPoolName) ?? null;
  const isRunning = isInstanceRunning(instance);
  const isDeleteProtected = isInstanceDeleteProtected(instance);
  const canDelete = canDeleteInstance(instance);
  const canForceDelete = isRunning && !isDeleteProtected;
  const canRepair =
    instance.type === 'virtual-machine' &&
    rootDiskPool?.driver === 'lvm' &&
    (rootDiskPool.locations?.length ?? 0) > 1;
  const isBusy = busyAction !== null;

  React.useEffect(() => {
    if (open) {
      return;
    }

    setView('menu');
    setBusyAction(null);
    setActionError(null);
    setRebuildMode('image');
    setForceDelete(false);
    setSelectedImage(null);
    setShowSourceYamlEditor(false);
    setSourceYamlContent('');
    setSourceYamlError(null);
    setYamlSourceOverride(null);
  }, [open]);

  const projectLabel = instance.project
    ? `Project · ${instance.project}`
    : 'Project · default';

  const getSelectedImageSource =
    React.useCallback((): AdvancedInstanceRebuildSource => {
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
    (nextSource: AdvancedInstanceRebuildSource | null) => {
      setYamlSourceOverride(nextSource);

      if (!nextSource) {
        setSourceYamlError(null);
        return;
      }

      setSourceYamlContent(
        toYaml(nextSource as unknown as Record<string, unknown>),
      );
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
        setSelectedImage((current) =>
          current?.fingerprint === nextSource.fingerprint
            ? current
            : null,
        );
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
    [],
  );

  const handleSourceYamlChange = React.useCallback(
    (value: string | undefined) => {
      const nextValue = value ?? '';
      setSourceYamlContent(nextValue);

      try {
        const parsed = fromYaml(nextValue);
        const type = parsed.type;

        if (type !== 'image' && type !== 'none') {
          throw new Error('Source YAML must include type: image or type: none.');
        }

        if (type === 'none') {
          const nextSource: AdvancedInstanceRebuildSource = { type: 'none' };
          setRebuildMode('empty');
          updateYamlSourceOverride(nextSource);
          syncSelectedImageFromSource(nextSource);
          return;
        }

        const fingerprint =
          typeof parsed.fingerprint === 'string' && parsed.fingerprint.trim()
            ? parsed.fingerprint.trim()
            : undefined;
        const alias =
          typeof parsed.alias === 'string' && parsed.alias.trim()
            ? parsed.alias.trim()
            : undefined;
        const server =
          typeof parsed.server === 'string' && parsed.server.trim()
            ? parsed.server.trim()
            : undefined;
        const mode = parsed.mode;
        const protocol = parsed.protocol;

        if (!fingerprint && !(alias && server)) {
          throw new Error(
            'Image source YAML must include fingerprint or both alias and server.',
          );
        }

        if (mode !== undefined && mode !== 'pull') {
          throw new Error('Only mode: pull is supported for rebuild sources.');
        }

        if (
          protocol !== undefined &&
          protocol !== 'simplestreams' &&
          protocol !== 'oci'
        ) {
          throw new Error(
            'protocol must be either simplestreams or oci when provided.',
          );
        }

        const nextSource: AdvancedInstanceRebuildSource = {
          type: 'image',
          ...(fingerprint ? { fingerprint } : {}),
          ...(alias ? { alias } : {}),
          ...(server ? { server } : {}),
          ...(mode === 'pull' ? { mode } : {}),
          ...(protocol ? { protocol } : {}),
        };

        setRebuildMode('image');
        updateYamlSourceOverride(nextSource);
        syncSelectedImageFromSource(nextSource);
      } catch (error) {
        setSourceYamlError(
          error instanceof Error ? error.message : 'Invalid source YAML.',
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

  const handleDelete = async () => {
    if (!canDelete) {
      if (!canForceDelete || !forceDelete) {
        return;
      }
    }

    try {
      setActionError(null);
      setBusyAction('delete');
      await deleteInstance(instance, canForceDelete && forceDelete);
      setOpen(false);
      React.startTransition(() => {
        router.push('/instances');
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to delete instance.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRebuild = async () => {
    try {
      setActionError(null);
      setBusyAction('rebuild');
      const source = getRebuildSource();
      await rebuildInstance({ instance, source });
      setOpen(false);
      await onMutate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to rebuild instance.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRepair = async () => {
    try {
      setActionError(null);
      setBusyAction('repair');
      await repairInstance({
        instance,
        action: 'rebuild-config-volume',
      });
      setOpen(false);
      await onMutate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to repair instance.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const renderStatusIndicator = () => {
    const status = instance.status?.toLowerCase();

    if (status === 'running' || status === 'started') {
      return (
        <span className="absolute -right-1 -bottom-1 flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-green-500" />
        </span>
      );
    }

    if (status === 'stopped') {
      return (
        <span className="absolute -right-1 -bottom-1 flex h-4 w-4">
          <span className="relative inline-flex h-4 w-4 rounded-full bg-red-500" />
        </span>
      );
    }

    return (
      <span className="absolute -right-1 -bottom-1 flex h-4 w-4">
        <span className="relative inline-flex h-4 w-4 rounded-full bg-gray-400" />
      </span>
    );
  };

  const renderMenu = () => (
    <div className="grid gap-3">
      <ActionCard
        icon={<RefreshCcwDotIcon className="size-4" />}
        title="Rebuild instance"
        description="Recreate the instance from a selected image or as empty."
        onClick={() => setView('rebuild')}
      />
      {canRepair ? (
        <ActionCard
          icon={<WrenchIcon className="size-4" />}
          title="Repair instance"
          description="Run the supported low-level repair action for this instance."
          onClick={() => setView('repair')}
        />
      ) : null}
      <ActionCard
        icon={<Trash2Icon className="size-4 text-destructive" />}
        title="Delete instance"
        description="Permanently remove this instance and all of its data."
        onClick={() => setView('delete')}
      />
    </div>
  );

  const renderDeleteView = () => (
    <div className="space-y-4">
      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm">
        This action cannot be undone. This will permanently delete{' '}
        <strong>{instance.name}</strong> and all of its data.
      </div>

      {isRunning ? (
        <Alert>
          <AlertTitle>Stop the instance first</AlertTitle>
          <AlertDescription>
            Running instances must be stopped before deletion. You can force a
            stop first and then continue with deletion from here.
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
          The delete request will be sent immediately and progress will be
          tracked through the existing operation events.
        </p>
      ) : null}

      {canForceDelete ? (
        <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
          <Checkbox
            checked={forceDelete}
            onCheckedChange={(checked) => setForceDelete(checked === true)}
            disabled={isBusy}
            aria-label="Force stop before deleting"
          />
          <span className="space-y-1">
            <span className="block font-medium">Force stop before delete</span>
            <span className="block text-muted-foreground">
              Stop the running instance with force, wait for it to stop, then
              delete it.
            </span>
          </span>
        </label>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={() => setView('menu')} disabled={isBusy}>
          Back
        </Button>
        <Button
          variant="destructive"
          loading={busyAction === 'delete'}
          disabled={(!canDelete && !(canForceDelete && forceDelete)) || isBusy}
          onClick={() => void handleDelete()}
        >
          {canForceDelete && forceDelete ? 'Force stop and delete' : 'Delete instance'}
        </Button>
      </DialogFooter>
    </div>
  );

  const renderRebuildView = () => (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden">
      {!showSourceYamlEditor ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Rebuild source</p>
          <Select
            value={rebuildMode}
            onValueChange={(value) =>
              handleRebuildModeChange(value as RebuildMode)
            }
            disabled={isBusy}
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
        <div className="min-h-0 overflow-hidden">
          {showSourceYamlEditor ? (
            <div className="h-[24rem] min-h-[24rem] overflow-hidden">
              <SettingsYamlEditor
                value={sourceYamlContent}
                error={sourceYamlError}
                onChange={handleSourceYamlChange}
              />
            </div>
          ) : (
            <ImageSelector
              selectedImage={selectedImage}
              onSelect={(image) => {
                setSelectedImage(image);
                updateYamlSourceOverride(null);
                setSourceYamlError(null);
              }}
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
            />
          )}
        </div>
      ) : (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          An empty rebuild recreates the instance without selecting an image
          source.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <div>
          {rebuildMode === 'image' ? (
            <Button
              variant="outline"
              onClick={handleToggleSourceYamlEditor}
              disabled={isBusy}
            >
              {showSourceYamlEditor ? (
                <PackageIcon className="mr-2 h-4 w-4" />
              ) : (
                <CodeXmlIcon className="mr-2 h-4 w-4" />
              )}
              {showSourceYamlEditor ? 'Back to image list' : 'Edit YAML'}
            </Button>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setView('menu')}
            disabled={isBusy}
          >
            Back
          </Button>
          <Button
            loading={busyAction === 'rebuild'}
            disabled={Boolean(sourceYamlError)}
            onClick={() => void handleRebuild()}
          >
            Rebuild instance
          </Button>
        </div>
      </div>
    </div>
  );

  const renderRepairView = () => (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Supported action</span>
          <Badge variant="outline">rebuild-config-volume</Badge>
        </div>
        <p className="mt-2 text-muted-foreground">
          This triggers the currently supported low-level repair action exposed
          by Incus for this instance.
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setView('menu')} disabled={isBusy}>
          Back
        </Button>
        <Button loading={busyAction === 'repair'} onClick={() => void handleRepair()}>
          Run repair
        </Button>
      </DialogFooter>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="group relative h-16 w-16 rounded-lg border bg-muted p-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Open instance actions"
        >
          <OSLogo brand={getBaseImage(instance)} className="size-8" />
          <span className="absolute inset-0 rounded-lg bg-background/75 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          <Settings2Icon className="absolute size-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          {renderStatusIndicator()}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            {view !== 'menu' ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setView('menu')}
                disabled={isBusy}
                aria-label="Back to actions menu"
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
            ) : null}
            <DialogTitle>{getDialogTitle(view, instance.name)}</DialogTitle>
          </div>
          <DialogDescription>
            {getDialogDescription(view, instance.name)}
          </DialogDescription>
        </DialogHeader>

        {actionError ? (
          <Alert variant="destructive">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {view === 'menu' ? renderMenu() : null}
        {view === 'delete' ? renderDeleteView() : null}
        {view === 'rebuild' ? renderRebuildView() : null}
        {view === 'repair' && canRepair ? renderRepairView() : null}
      </DialogContent>
    </Dialog>
  );
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={onClick}
    >
      <span className="mt-0.5 rounded-md border bg-background p-2">{icon}</span>
      <span className="space-y-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function getDialogTitle(view: ActionView, instanceName: string) {
  switch (view) {
    case 'delete':
      return `Delete ${instanceName}`;
    case 'rebuild':
      return `Rebuild ${instanceName}`;
    case 'repair':
      return `Repair ${instanceName}`;
    default:
      return `${instanceName} actions`;
  }
}

function getDialogDescription(view: ActionView, instanceName: string) {
  switch (view) {
    case 'delete':
      return 'Confirm the destructive delete action for this instance.';
    case 'rebuild':
      return 'Choose how to rebuild this instance.';
    case 'repair':
      return 'Run the supported repair action for this instance.';
    default:
      return `Manage destructive and recovery actions for ${instanceName}.`;
  }
}
