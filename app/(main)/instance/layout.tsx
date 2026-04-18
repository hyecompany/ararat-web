'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { mutate as mutateCache } from 'swr';
import { InstanceProvider, useInstanceContext } from './_context/instance';
import { getInstanceCacheKey } from './_hooks/instance';
import { Spinner } from 'ui-web/components/spinner';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Instance } from '../instances/_lib/instances.d';
import { Button } from 'ui-web/components/button';
import { Input } from 'ui-web/components/input';
import {
  PlayIcon,
  SquareIcon,
  RotateCcwIcon,
  SnowflakeIcon,
  LayoutDashboard,
  Archive,
  Terminal,
  Folder,
  Camera,
  Cpu,
  Settings,
  PencilIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from 'ui-web/components/tabs';
import { OSLogo } from '@/app/_components/OSLogo';
import { getBaseImage } from './_lib/utils';
import {
  performInstanceAction,
  updateInstanceMetadata,
  type InstanceAction,
} from './_lib/instance';
import { SiteHeader } from '@/app/(main)/_components/header';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from 'ui-web/components/breadcrumb';
import { cn } from 'ui-web/lib/utils';
import Link from 'next/link';

function InstanceLayoutContent({ children }: { children: React.ReactNode }) {
  const { name, instance, isLoading, isError, mutate } = useInstanceContext();

  const pathname = usePathname();

  const getTabFromPathname = (path: string) => {
    const pathSegments = path.split('/').filter(Boolean);
    const rawTab = pathSegments.length > 1 ? pathSegments[1] : 'Dashboard';
    const label = rawTab.charAt(0).toUpperCase() + rawTab.slice(1);
    return { rawTab, label };
  };

  const { label: formattedTab } = getTabFromPathname(pathname);

  const renderContent = () => {
    if (!name) {
      return (
        <div className="h-full overflow-auto p-6">
            <Alert variant="destructive">
              <AlertTitle>Missing Parameter</AlertTitle>
              <AlertDescription>
                The <code>name</code> query parameter is required.
              </AlertDescription>
            </Alert>
          </div>
      );
    }

    if (isLoading && !instance) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <Spinner className="size-8" />
        </div>
      );
    }

    if (isError || !instance) {
      return (
        <div className="h-full overflow-auto p-6">
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {isError?.message || 'Instance not found.'}
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col gap-6 p-6">
        <InstanceHeader instance={instance} onMutate={mutate} />

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <InstanceTabs />
          <div className="mt-4 min-h-0 flex-1">{children}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SiteHeader>
<Breadcrumb className="select-none">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/instances">Instances</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {name && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/instance?name=${name}`}>{name}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{formattedTab}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </SiteHeader>
      <div className="min-h-0 flex-1 overflow-auto">{renderContent()}</div>
    </div>
  );
}

export default function InstanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <InstanceProvider>
      <InstanceLayoutContent>{children}</InstanceLayoutContent>
    </InstanceProvider>
  );
}

// --- Inlined Components ---

const instanceActionDetails: Record<
  InstanceAction,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  start: { label: 'Start', Icon: PlayIcon },
  stop: { label: 'Stop', Icon: SquareIcon },
  restart: { label: 'Restart', Icon: RotateCcwIcon },
  freeze: { label: 'Freeze', Icon: SnowflakeIcon },
};

type EditableField = 'name' | 'description' | null;

function InstanceHeader({
  instance,
  onMutate,
}: {
  instance: Instance;
  onMutate: () => Promise<void>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [actionInFlight, setActionInFlight] =
    React.useState<InstanceAction | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [activeField, setActiveField] = React.useState<EditableField>(null);
  const [hoveredField, setHoveredField] = React.useState<EditableField>(null);
  const [draftValue, setDraftValue] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [isSavingField, setIsSavingField] = React.useState(false);
  const fieldContainerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const saveAbortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      saveAbortControllerRef.current?.abort();
    };
  }, []);

  const handleAction = async (action: InstanceAction) => {
    try {
      setActionError(null);
      setActionInFlight(action);
      await performInstanceAction({ action, instance });
      await onMutate();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Unable to ${action} instance.`;
      setActionError(message);
    } finally {
      setActionInFlight(null);
    }
  };

  const currentDescription = instance.description ?? '';
  const isBusy = actionInFlight !== null || isSavingField;

  const cancelEditing = React.useCallback(() => {
    if (isSavingField) {
      return;
    }
    setActiveField(null);
    setFieldError(null);
    setDraftValue('');
  }, [isSavingField]);

  const startEditing = React.useCallback(
    (field: Exclude<EditableField, null>) => {
      if (isBusy) {
        return;
      }

      setFieldError(null);
      setActiveField(field);
      setDraftValue(field === 'name' ? instance.name : currentDescription);
    },
    [currentDescription, instance.name, isBusy],
  );

  React.useEffect(() => {
    if (!activeField || !inputRef.current) {
      return;
    }

    inputRef.current.focus();
    inputRef.current.select();
  }, [activeField]);

  React.useEffect(() => {
    if (!activeField) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (fieldContainerRef.current?.contains(target)) {
        return;
      }

      cancelEditing();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [activeField, cancelEditing]);

  const saveField = async () => {
    if (!activeField || isSavingField) {
      return;
    }

    const trimmedValue = draftValue.trim();
    if (activeField === 'name' && trimmedValue.length === 0) {
      setFieldError('Instance name is required.');
      return;
    }

    const nextName = activeField === 'name' ? trimmedValue : instance.name;
    const nextDescription =
      activeField === 'description' ? trimmedValue : currentDescription;

    if (nextName === instance.name && nextDescription === currentDescription) {
      cancelEditing();
      return;
    }

    try {
      setFieldError(null);
      setIsSavingField(true);
      saveAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      saveAbortControllerRef.current = abortController;

      const { instance: updatedInstance } = await updateInstanceMetadata({
        instance,
        nextName,
        nextDescription,
        signal: abortController.signal,
      });

      const nextKey = getInstanceCacheKey(updatedInstance.name);

      if (nextKey) {
        await mutateCache(
          nextKey,
          {
            type: 'sync',
            status: 'Success',
            status_code: 200,
            metadata: updatedInstance,
          },
          { revalidate: false },
        );
      }

      if (updatedInstance.name !== instance.name) {
        const nextQuery = new URLSearchParams(window.location.search);
        nextQuery.set('name', updatedInstance.name);
        React.startTransition(() => {
          router.replace(`${pathname}?${nextQuery.toString()}`, {
            scroll: false,
          });
        });
      } else {
        await onMutate();
      }

      setActiveField(null);
      setDraftValue('');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setFieldError(
        err instanceof Error ? err.message : 'Unable to update instance field.',
      );
    } finally {
      saveAbortControllerRef.current = null;
      setIsSavingField(false);
    }
  };

  const status = instance.status?.toLowerCase();
  const isRunning = status === 'running';
  const isStopped = status === 'stopped';
  const isFrozen = status === 'frozen';

  const availableActions: InstanceAction[] = [];
  if (isRunning) {
    availableActions.push('stop', 'restart', 'freeze');
  } else if (isStopped) {
    availableActions.push('start');
  } else if (isFrozen) {
    availableActions.push('start');
  }

  const isUnknownStatus = !isRunning && !isStopped && !isFrozen;

  const renderEditableField = ({
    field,
    value,
    placeholder,
    displayClassName,
    inputClassName,
  }: {
    field: Exclude<EditableField, null>;
    value: string;
    placeholder: string;
    displayClassName: string;
    inputClassName: string;
  }) => {
    const isActive = activeField === field;
    const showPencil = hoveredField === field && !isActive && !isBusy;
    const displayValue = value || placeholder;

    return (
      <div
        className="group relative"
        onMouseEnter={() => setHoveredField(field)}
        onMouseLeave={() => setHoveredField((current) => (current === field ? null : current))}
      >
        {isActive ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={draftValue}
              disabled={isSavingField}
              onChange={(event) => setDraftValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveField();
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelEditing();
                }
              }}
              className={inputClassName}
              aria-label={
                field === 'name' ? 'Edit instance name' : 'Edit instance description'
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              disabled={isSavingField}
              onClick={() => void saveField()}
              aria-label={`Save instance ${field}`}
            >
              {isSavingField ? (
                <Spinner className="size-4" />
              ) : (
                <CheckIcon className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              disabled={isSavingField}
              onClick={cancelEditing}
              aria-label={`Cancel editing instance ${field}`}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className={cn(
              'flex max-w-full items-center gap-2 rounded-md text-left transition-colors select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              !value && 'text-muted-foreground/80 italic',
            )}
            onClick={() => startEditing(field)}
            disabled={isBusy}
          >
            <span className={cn(displayClassName, !value && 'font-normal')}>
              {displayValue}
            </span>
            <PencilIcon
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-opacity',
                showPencil ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-lg border bg-muted">
          <OSLogo brand={getBaseImage(instance)} className="h-8 w-8" />

          {/* Pulsing Status Circle */}
          {isRunning && (
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500"></span>
            </span>
          )}
          {isUnknownStatus && (
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
              <span className="relative inline-flex rounded-full h-4 w-4 bg-gray-400"></span>
            </span>
          )}
          {isStopped && (
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
              <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
            </span>
          )}
        </div>

        <div ref={fieldContainerRef} className="flex-1 space-y-1">
          {renderEditableField({
            field: 'name',
            value: instance.name,
            placeholder: 'Untitled instance',
            displayClassName: 'truncate text-2xl font-bold',
            inputClassName: 'h-11 text-2xl font-bold',
          })}
          {renderEditableField({
            field: 'description',
            value: currentDescription,
            placeholder: 'Add a description',
            displayClassName: 'truncate text-sm text-muted-foreground',
            inputClassName: 'h-9 text-sm',
          })}
        </div>

        <div className="flex gap-2">
          {availableActions.map((action) => {
            const { label, Icon } = instanceActionDetails[action];
            return (
              <Button
                key={action}
                variant="outline"
                size="sm"
                disabled={actionInFlight !== null}
                onClick={() => handleAction(action)}
              >
                {actionInFlight === action ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <Icon className="mr-2 size-4" />
                )}
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {fieldError && (
        <Alert variant="destructive">
          <AlertTitle>Update failed</AlertTitle>
          <AlertDescription>{fieldError}</AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

const TABS = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'backups', label: 'Backups', icon: Archive },
  { value: 'console', label: 'Console', icon: Terminal },
  { value: 'files', label: 'Files', icon: Folder },
  { value: 'snapshots', label: 'Snapshots', icon: Camera },
  { value: 'devices', label: 'Devices', icon: Cpu },
  { value: 'configuration', label: 'Configuration', icon: Settings },
];

function InstanceTabs() {
  const pathname = usePathname();
  const { name: instanceName } = useInstanceContext();

  // Determine current tab based on pathname
  // /instance -> dashboard
  // /instance/backups -> backups
  // etc.
  // More robust logic: extract tab from pathname, supporting only known tabs.
  let currentTab = 'dashboard';
  if (pathname.startsWith('/instance/')) {
    // Take the segment after /instance/
    const segment = pathname.replace(/^\/instance\/?/, '').split('/')[0];
    // Match only known TABS by value
    if (TABS.some((tab) => tab.value === segment)) {
      currentTab = segment;
    }
  }

  return (
    <Tabs value={currentTab} className="w-full">
      <div className="w-full overflow-x-auto">
        <TabsList className="min-w-full inline-flex">
          {TABS.map((tab) => {
            const targetPath =
              tab.value === 'dashboard' ? '/instance' : `/instance/${tab.value}`;

            return (
              <TabsTrigger key={tab.value} value={tab.value} asChild>
                <Link
                  href={{
                    pathname: targetPath,
                    query: instanceName ? { name: instanceName } : undefined,
                  }}
                >
                  <tab.icon aria-hidden="true" className="mr-2 h-4 w-4" />
                  {tab.label}
                </Link>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
    </Tabs>
  );
}
