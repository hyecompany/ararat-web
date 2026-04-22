'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { IconSettings } from '@tabler/icons-react';
import {
  CopyPlusIcon,
  HardDriveIcon,
  LogsIcon,
  RefreshCcwDotIcon,
  Settings2Icon,
  SquaresIntersectIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';

import { OSLogo } from '@/app/_components/OSLogo';
import { Button } from 'ui-web/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'ui-web/components/dialog';
import { cn } from 'ui-web/lib/utils';
import type { Instance } from '../../instances/_lib/instances.d';
import { getBaseImage } from '../_lib/utils';
import Clone from './management/clone';
import Configuration from './management/configuration';
import Delete from './management/delete';
import Devices from './management/devices';
import Logs from './management/logs';
import Profiles from './management/profiles';
import Rebuild from './management/rebuild';
import Repair from './management/repair';
import { useStoragePools } from '@/app/(main)/_hooks/storagePools';

type ActionView =
  | 'menu'
  | 'devices'
  | 'configuration'
  | 'profiles'
  | 'logs'
  | 'rebuild'
  | 'clone'
  | 'repair'
  | 'delete';

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

  const rootDiskPoolName =
    instance.expanded_devices?.root?.pool ?? instance.devices?.root?.pool ?? null;
  const rootDiskPool =
    storagePools?.find((pool) => pool.name === rootDiskPoolName) ?? null;
  const canRepair =
    instance.type === 'virtual-machine' &&
    rootDiskPool?.driver === 'lvm' &&
    (rootDiskPool.locations?.length ?? 0) > 1;
  const status = instance.status?.toLowerCase();
  const isRunning = status === 'running' || status === 'started';
  const isStopped = status === 'stopped';

  React.useEffect(() => {
    if (!open) {
      setView('menu');
    }
  }, [open]);

  const handleClose = React.useCallback(() => {
    setOpen(false);
    setView('menu');
  }, []);

  const handleMutateAndClose = React.useCallback(async () => {
    handleClose();
    await onMutate();
  }, [handleClose, onMutate]);

  const handleDeleteDone = React.useCallback(async () => {
    handleClose();
    React.startTransition(() => {
      router.push('/instances');
    });
  }, [handleClose, router]);

  const dialogContentClassName = cn(
    'flex w-full flex-col overflow-hidden',
    view === 'logs'
      ? 'h-[95vh] max-h-[95vh] sm:max-w-[95vw]'
      : view === 'configuration' || view === 'devices' || view === 'rebuild'
        ? 'h-[90vh] max-h-[90vh] sm:max-w-6xl'
        : view === 'menu'
          ? 'max-h-[90vh] sm:max-w-4xl'
          : view === 'clone'
            ? 'max-h-[90vh] sm:max-w-2xl'
            : view === 'profiles'
              ? 'max-h-[90vh] sm:max-w-2xl'
              : view === 'delete'
                ? 'max-h-[90vh] sm:max-w-2xl'
                : 'max-h-[90vh] sm:max-w-2xl',
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="group relative h-16 w-16 rounded-lg border bg-muted p-0 hover:bg-muted"
          aria-label={`Manage instance ${instance.name}`}
        >
          <OSLogo brand={getBaseImage(instance)} className="size-8" />
          <span className="absolute inset-0 rounded-lg bg-background/0 transition-colors group-hover:bg-background/10 group-focus-visible:bg-background/10" />
          <span className="absolute -right-1 -bottom-1 size-3.75" aria-hidden="true">
            {isRunning ? (
              <>
                <span className="absolute inset-0 rounded-full bg-emerald-500/20 scale-[1.35]" />
                <span className="absolute inset-0 rounded-full bg-emerald-500/35 [animation:status-halo-pulse_2.8s_ease-out_infinite]" />
              </>
            ) : null}
            <span
              className={cn(
                'absolute inset-0 rounded-full border-2 border-background shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-transform group-hover:scale-105',
                isRunning && 'bg-emerald-500',
                isStopped && 'bg-red-400',
                !isRunning && !isStopped && 'bg-amber-400',
              )}
            />
          </span>
          <span className="absolute top-1 right-1 rounded-full border bg-background/95 p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Settings2Icon className="size-3" />
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className={dialogContentClassName}>
        <DialogHeader>
          <DialogTitle>{getDialogTitle(view, instance.name)}</DialogTitle>
          <DialogDescription>
            {getDialogDescription(view, instance.name)}
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'min-h-0 flex-1 pr-1',
            view === 'menu' || view === 'clone' || view === 'delete' || view === 'repair' || view === 'profiles'
              ? 'overflow-y-auto'
              : 'overflow-hidden',
          )}
        >
          {view === 'menu' ? (
            <ActionMenu canRepair={canRepair} onSelect={setView} />
          ) : null}

          {view === 'devices' ? (
            <Devices
              instance={instance}
              onMutate={onMutate}
              onBack={() => setView('menu')}
            />
          ) : null}

          {view === 'configuration' ? (
            <Configuration
              instance={instance}
              onMutate={onMutate}
              onBack={() => setView('menu')}
            />
          ) : null}

          {view === 'profiles' ? (
            <Profiles
              instance={instance}
              onMutate={onMutate}
              onBack={() => setView('menu')}
            />
          ) : null}

          {view === 'logs' ? (
            <Logs
              instance={instance}
              onBack={() => setView('menu')}
            />
          ) : null}

          {view === 'rebuild' ? (
            <Rebuild
              instance={instance}
              onBack={() => setView('menu')}
              onDone={handleMutateAndClose}
            />
          ) : null}

          {view === 'clone' ? (
            <Clone
              instance={instance}
              onBack={() => setView('menu')}
              onDone={handleMutateAndClose}
            />
          ) : null}

          {view === 'repair' ? (
            <Repair
              instance={instance}
              onBack={() => setView('menu')}
              onDone={handleMutateAndClose}
            />
          ) : null}

          {view === 'delete' ? (
            <Delete
              instance={instance}
              onBack={() => setView('menu')}
              onDone={handleDeleteDone}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionMenu({
  canRepair,
  onSelect,
}: {
  canRepair: boolean;
  onSelect: (view: Exclude<ActionView, 'menu'>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ActionCard
        title="Manage Devices"
        description="Add, remove, and edit instance devices."
        icon={HardDriveIcon}
        onClick={() => onSelect('devices')}
      />
      <ActionCard
        title="Edit Configuration"
        description="Update instance configuration values and raw YAML."
        icon={IconSettings}
        onClick={() => onSelect('configuration')}
      />
      <ActionCard
        title="Manage Profiles"
        description="Add or remove profiles applied to this instance."
        icon={SquaresIntersectIcon}
        onClick={() => onSelect('profiles')}
      />
      <ActionCard
        title="Manage Logs"
        description="View and delete instance log files."
        icon={LogsIcon}
        onClick={() => onSelect('logs')}
      />
      <ActionCard
        title="Clone"
        description="Create a local copy of this instance."
        icon={CopyPlusIcon}
        onClick={() => onSelect('clone')}
      />
      {canRepair ? (
        <ActionCard
          title="Repair"
          description="Run the supported low-level repair action for this instance."
          icon={WrenchIcon}
          onClick={() => onSelect('repair')}
        />
      ) : null}
      <ActionCard
        title="Rebuild"
        description="Replace this instance from an image or empty source."
        icon={RefreshCcwDotIcon}
        onClick={() => onSelect('rebuild')}
      />
      <ActionCard
        title="Delete"
        description="Permanently remove this instance and its data."
        icon={Trash2Icon}
        destructive
        onClick={() => onSelect('delete')}
      />
    </div>
  );
}

function ActionCard({
  title,
  description,
  icon: Icon,
  destructive = false,
  onClick,
}: {
  title: string;
  description: string;
    icon: React.ComponentType<{ className?: string }>;
    destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/40',
        destructive && 'border-destructive/30 hover:bg-destructive/5',
      )}
    >
      <span
        className={cn(
          'rounded-md border bg-muted p-2 text-muted-foreground',
          destructive && 'border-destructive/20 text-destructive',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function getDialogTitle(view: ActionView, instanceName: string) {
  switch (view) {
    case 'devices':
      return 'Manage Devices';
    case 'configuration':
      return 'Edit Configuration';
    case 'profiles':
      return 'Manage Profiles';
    case 'logs':
      return 'Manage Logs';
    case 'rebuild':
      return `Rebuild ${instanceName}`;
    case 'clone':
      return `Clone ${instanceName}`;
    case 'repair':
      return `Repair ${instanceName}`;
    case 'delete':
      return `Delete ${instanceName}`;
    case 'menu':
    default:
      return 'Manage Instance';
  }
}

function getDialogDescription(view: ActionView, instanceName: string) {
  switch (view) {
    case 'devices':
      return `Manage the devices attached to ${instanceName}.`;
    case 'configuration':
      return `Edit configuration keys and YAML for ${instanceName}.`;
    case 'profiles':
      return `Choose which profiles are applied to ${instanceName}.`;
    case 'logs':
      return `View and delete log files for ${instanceName}.`;
    case 'rebuild':
      return 'Choose how to rebuild this instance.';
    case 'clone':
      return 'Create a local copy of this instance.';
    case 'repair':
      return 'Run the supported repair action for this instance.';
    case 'delete':
      return 'Confirm the destructive delete action for this instance.';
    case 'menu':
    default:
      return 'Edit this instance or run advanced actions.';
  }
}
