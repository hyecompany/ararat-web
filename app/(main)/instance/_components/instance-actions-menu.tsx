'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { IconSettings } from '@tabler/icons-react';
import {
  ArrowRightIcon,
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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemActions,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from 'ui-web/components/item';
import { Tooltip, TooltipContent, TooltipTrigger } from 'ui-web/components/tooltip';
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

type MenuSection = 'settings' | 'utilities' | 'danger';

type MenuAction = {
  view: Exclude<ActionView, 'menu'>;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  section: MenuSection;
  destructive?: boolean;
};

const menuActions: MenuAction[] = [
  {
    view: 'configuration',
    title: 'Edit Configuration',
    description: 'Update instance configuration values and raw YAML.',
    icon: IconSettings,
    section: 'settings',
  },
  {
    view: 'devices',
    title: 'Manage Devices',
    description: 'Add, remove, and edit instance devices.',
    icon: HardDriveIcon,
    section: 'settings',
  },
  {
    view: 'profiles',
    title: 'Manage Profiles',
    description: 'Add or remove profiles applied to this instance.',
    icon: SquaresIntersectIcon,
    section: 'settings',
  },
  {
    view: 'logs',
    title: 'Manage Logs',
    description: 'View and delete instance log files.',
    icon: LogsIcon,
    section: 'utilities',
  },
  {
    view: 'clone',
    title: 'Clone',
    description: 'Create a local copy of this instance.',
    icon: CopyPlusIcon,
    section: 'utilities',
  },
  {
    view: 'rebuild',
    title: 'Rebuild',
    description: 'Replace this instance from an image or empty source.',
    icon: RefreshCcwDotIcon,
    section: 'utilities',
  },
  {
    view: 'repair',
    title: 'Repair',
    description: 'Run the supported low-level repair action for this instance.',
    icon: WrenchIcon,
    section: 'utilities',
  },
  {
    view: 'delete',
    title: 'Delete',
    description: 'Permanently remove this instance and its data.',
    icon: Trash2Icon,
    section: 'danger',
    destructive: true,
  },
];

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
  const rootDiskPool = storagePools?.find((pool) => pool.name === rootDiskPoolName) ?? null;
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
      router.push('/instances', { transitionTypes: ['nav-back'] });
    });
  }, [handleClose, router]);

  const viewSizing: Record<ActionView, string> = {
    logs: 'h-[90vh] max-h-[90vh] sm:max-w-[95vw]',
    configuration: 'h-[90vh] max-h-[90vh] sm:max-w-6xl',
    devices: 'h-[90vh] max-h-[90vh] sm:max-w-6xl',
    rebuild: 'h-[90vh] max-h-[90vh] sm:max-w-6xl',
    menu: 'max-h-[85vh] sm:max-w-3xl',
    clone: 'max-h-[85vh] sm:max-w-2xl',
    profiles: 'max-h-[85vh] sm:max-w-2xl',
    delete: 'max-h-[85vh] sm:max-w-2xl',
    repair: 'max-h-[85vh] sm:max-w-2xl',
  };

  const dialogContentClassName = cn(
    'flex w-full flex-col overflow-hidden',
    viewSizing[view] || 'max-h-[90vh] sm:max-w-2xl',
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                className="group bg-muted hover:bg-muted/90 focus-visible:scale-105 hover:scale-105 relative h-16 w-16 rounded-lg border p-0 shadow-sm transition-transform duration-200"
                aria-label={`Manage instance ${instance.name}`}
              >
                <OSLogo brand={getBaseImage(instance)} className="size-8" />
                <span className="bg-background/0 group-hover:bg-background/10 group-focus-visible:bg-background/10 absolute inset-0 rounded-lg transition-colors" />
                <span className="absolute -right-1 -bottom-1 size-3.75" aria-hidden="true">
                  {isRunning ? (
                    <>
                      <span className="absolute inset-0 scale-[1.35] rounded-full bg-emerald-500/20" />
                      <span className="absolute inset-0 [animation:status-halo-pulse_2.8s_ease-out_infinite] rounded-full bg-emerald-500/35" />
                    </>
                  ) : null}
                  <span
                    className={cn(
                      'border-background absolute inset-0 rounded-full border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] transition-transform group-hover:scale-105',
                      isRunning && 'bg-emerald-500',
                      isStopped && 'bg-red-400',
                      !isRunning && !isStopped && 'bg-amber-400',
                    )}
                  />
                </span>
                <span className="bg-background/95 text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground absolute top-1 right-1 rounded-full border p-1 shadow-sm transition-colors">
                  <Settings2Icon className="size-3" />
                </span>
              </Button>
            </DialogTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Manage
        </TooltipContent>
      </Tooltip>
      <DialogContent className={dialogContentClassName}>
        <DialogHeader className="shrink-0 pr-8 pb-2">
          <DialogTitle>{getDialogTitle(view, instance.name)}</DialogTitle>
          <DialogDescription>{getDialogDescription(view, instance.name)}</DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'min-h-0 flex-1 pr-1',
            view === 'menu' ||
              view === 'clone' ||
              view === 'delete' ||
              view === 'repair' ||
              view === 'profiles'
              ? 'overflow-y-auto'
              : 'overflow-hidden',
          )}
        >
          {view === 'menu' ? <ActionMenu canRepair={canRepair} onSelect={setView} /> : null}

          {view === 'devices' ? (
            <Devices instance={instance} onMutate={onMutate} onBack={() => setView('menu')} />
          ) : null}

          {view === 'configuration' ? (
            <Configuration instance={instance} onMutate={onMutate} onBack={() => setView('menu')} />
          ) : null}

          {view === 'profiles' ? (
            <Profiles instance={instance} onMutate={onMutate} onBack={() => setView('menu')} />
          ) : null}

          {view === 'logs' ? <Logs instance={instance} onBack={() => setView('menu')} /> : null}

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
            <Delete instance={instance} onBack={() => setView('menu')} onDone={handleDeleteDone} />
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
  const visibleActions = menuActions.filter((action) => action.view !== 'repair' || canRepair);
  const sections: MenuSection[] = ['settings', 'utilities', 'danger'];

  return (
    <div className="flex min-h-0 flex-col gap-5 py-1">
      {sections.map((section) => {
        const sectionActions = visibleActions.filter((action) => action.section === section);

        if (sectionActions.length === 0) {
          return null;
        }

        return (
          <section key={section} className="space-y-2">
            <ItemHeader>{getSectionTitle(section)}</ItemHeader>
            <ItemGroup className="bg-background overflow-hidden rounded-lg border">
              {sectionActions.map((action, index) => (
                <React.Fragment key={action.view}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <ActionRow
                    title={action.title}
                    description={action.description}
                    icon={action.icon}
                    destructive={action.destructive}
                    onClick={() => onSelect(action.view)}
                  />
                </React.Fragment>
              ))}
            </ItemGroup>
          </section>
        );
      })}
    </div>
  );
}

function ActionRow({
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
    <Item asChild variant="outline" size="sm">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'focus-visible:ring-ring rounded-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          destructive &&
            'text-destructive hover:bg-destructive/[0.05] focus-visible:ring-destructive/30',
        )}
      >
        <ItemMedia
          variant="icon"
          className={cn(destructive && 'bg-destructive/[0.08] text-destructive')}
        >
          <Icon className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription>{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="text-muted-foreground self-center">
          <ArrowRightIcon className="size-4" />
        </ItemActions>
      </button>
    </Item>
  );
}

function getSectionTitle(section: MenuSection) {
  switch (section) {
    case 'settings':
      return 'Settings';
    case 'utilities':
      return 'Utilities';
    case 'danger':
      return 'Danger zone';
    default:
      return '';
  }
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
