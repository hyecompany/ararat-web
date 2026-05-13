'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { InstanceProvider, useInstanceContext } from './_context/instance';
import { useInstance } from './_hooks/instance';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Instance } from '../instances/_lib/instances.d';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  LogsIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  Settings2Icon,
  type LucideIcon,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  performInstanceAction,
  updateInstanceMetadata,
  type InstanceAction,
} from './_lib/instance';
import { SiteHeader } from '@/app/(main)/_components/header';
import { InstanceActionsMenu } from './_components/instance-actions-menu';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { PageTransition, TabContentTransition } from '@/components/ui/view-transitions';

export const dynamic = 'force-dynamic';

function InstanceLayoutContent({ children }: { children: React.ReactNode }) {
  const { name, project } = useInstanceContext();
  const { instance, isError, mutate } = useInstance(name, project, {
    metadata: true,
    state: true,
  });

  const pathname = usePathname();

  const getTabFromPathname = (path: string) => {
    const pathSegments = path.split('/').filter(Boolean);
    const rawTab = pathSegments.length > 1 ? pathSegments[1] : 'dashboard';
    const label = rawTab.charAt(0).toUpperCase() + rawTab.slice(1);
    return { rawTab, label };
  };

  const { rawTab: currentTab, label: formattedTab } = getTabFromPathname(pathname);
  const instanceQuery = React.useMemo(() => {
    if (!name) return undefined;

    const query: Record<string, string> = { name };
    if (project) {
      query.project = project;
    }
    return query;
  }, [name, project]);

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

    return (
      <div className="flex h-full min-h-0 flex-col gap-6 p-6">
        <InstanceHeader instance={instance} fallbackName={name} onMutate={mutate} />

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <InstanceTabs />
          <div className="mt-4 min-h-0 flex-1">
            <TabContentTransition
              transitionKey={currentTab}
              className="h-full"
              variant="tab"
            >
              {isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{isError.message}</AlertDescription>
                </Alert>
              ) : (
                children
              )}
            </TabContentTransition>
          </div>
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
                <Link href="/instances" transitionTypes={['nav-back']}>
                  Instances
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {name && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      href={{
                        pathname: '/instance',
                        query: instanceQuery,
                      }}
                      transitionTypes={['nav-lateral']}
                    >
                      {name}
                    </Link>
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
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <PageTransition className="h-full">{renderContent()}</PageTransition>
      </div>
    </div>
  );
}

export default function InstanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <InstanceProvider>
      <InstanceLayoutContent>{children}</InstanceLayoutContent>
    </InstanceProvider>
  );
}

// --- Inlined Components ---

const instanceActionDetails: Record<
  InstanceAction,
  { label: string; Icon: LucideIcon }
> = {
  start: { label: 'Start', Icon: PlayIcon },
  stop: { label: 'Stop', Icon: SquareIcon },
  restart: { label: 'Restart', Icon: RotateCcwIcon },
  freeze: { label: 'Freeze', Icon: SnowflakeIcon },
};

type EditableField = 'name' | 'description' | null;

function InstanceHeader({
  instance,
  fallbackName,
  onMutate,
}: {
  instance: Instance | undefined;
  fallbackName?: string | null;
  onMutate: () => Promise<void>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [actionInFlight, setActionInFlight] = React.useState<InstanceAction | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [activeField, setActiveField] = React.useState<EditableField>(null);
  const [hoveredField, setHoveredField] = React.useState<EditableField>(null);
  const [draftValue, setDraftValue] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [isSavingField, setIsSavingField] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const fieldContainerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const saveAbortControllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    return () => {
      saveAbortControllerRef.current?.abort();
    };
  }, []);

  const handleAction = async (action: InstanceAction) => {
    if (!instance) return;
    try {
      setActionError(null);
      setActionInFlight(action);
      await performInstanceAction({ action, instance });
      await onMutate();
    } catch (err) {
      const message = err instanceof Error ? err.message : `Unable to ${action} instance.`;
      setActionError(message);
    } finally {
      setActionInFlight(null);
    }
  };

  const displayName = instance?.name ?? fallbackName ?? '';
  const currentDescription = instance?.description ?? '';
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
      setDraftValue(field === 'name' ? displayName : currentDescription);
    },
    [currentDescription, displayName, isBusy],
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
    if (!instance || !activeField || isSavingField) {
      return;
    }

    const trimmedValue = draftValue.trim();
    if (activeField === 'name' && trimmedValue.length === 0) {
      setFieldError('Instance name is required.');
      return;
    }

    const nextName = activeField === 'name' ? trimmedValue : instance.name;
    const nextDescription = activeField === 'description' ? trimmedValue : currentDescription;

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

      await onMutate();

      if (updatedInstance.name !== instance.name) {
        const nextQuery = new URLSearchParams(window.location.search);
        nextQuery.set('name', updatedInstance.name);
        React.startTransition(() => {
          router.replace(`${pathname}?${nextQuery.toString()}`, {
            scroll: false,
            transitionTypes: ['nav-lateral'],
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
      setFieldError(err instanceof Error ? err.message : 'Unable to update instance field.');
    } finally {
      saveAbortControllerRef.current = null;
      setIsSavingField(false);
    }
  };

  const status = instance?.status?.toLowerCase();
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
              aria-label={field === 'name' ? 'Edit instance name' : 'Edit instance description'}
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
              {isSavingField ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
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
              'hover:text-foreground focus-visible:ring-ring flex max-w-full items-center gap-2 rounded-md text-left transition-colors select-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              !value && 'text-muted-foreground/80 italic',
            )}
            onClick={() => startEditing(field)}
            disabled={isBusy || !instance}
          >
            <span className={cn(displayClassName, !value && 'font-normal')}>{displayValue}</span>
            <PencilIcon
              className={cn(
                'text-muted-foreground size-4 shrink-0 transition-opacity',
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
        {hydrated && instance ? (
          <InstanceActionsMenu instance={instance} disabled={isBusy} onMutate={onMutate} />
        ) : (
          <InstanceActionsButtonPending name={displayName} />
        )}

        <div ref={fieldContainerRef} className="flex-1 space-y-1">
          {displayName ? (
            instance ? (
              renderEditableField({
                field: 'name',
                value: displayName,
                placeholder: 'Untitled instance',
                displayClassName: 'truncate text-2xl font-bold',
                inputClassName: 'h-11 text-2xl font-bold',
              })
            ) : (
              <p className="truncate text-2xl font-bold">{displayName}</p>
            )
          ) : (
            <Skeleton className="h-8 w-40 max-w-[60vw]" />
          )}
          {instance ? (
            renderEditableField({
              field: 'description',
              value: currentDescription,
              placeholder: 'Add a description',
              displayClassName: 'truncate text-sm text-muted-foreground',
              inputClassName: 'h-9 text-sm',
            })
          ) : (
            <Skeleton className="h-4 w-56 max-w-[70vw]" />
          )}
        </div>

        <div className="flex gap-2">
          {instance
            ? availableActions.map((action) => {
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
                      <Icon data-icon="inline-start" />
                    )}
                    {label}
                  </Button>
                );
              })
            : null}
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

function InstanceActionsButtonPending({ name }: { name?: string | null }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled
      className="bg-muted relative h-16 w-16 shrink-0 rounded-lg border p-0 shadow-sm"
      aria-label={name ? `Manage instance ${name}` : 'Manage instance'}
    >
      <Skeleton className="size-8 rounded-md" />
      <span className="border-background bg-muted-foreground/30 absolute -right-1 -bottom-1 size-3.75 rounded-full border-2" />
      <span className="bg-background/95 text-muted-foreground absolute top-1 right-1 rounded-full border p-1 shadow-sm">
        <Settings2Icon className="size-3" />
      </span>
    </Button>
  );
}

const TABS = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'console', label: 'Console', icon: Terminal },
  { value: 'files', label: 'Files', icon: Folder },
  { value: 'snapshots', label: 'Snapshots', icon: Camera },
  { value: 'backups', label: 'Backups', icon: Archive },
  { value: 'logs', label: 'Logs', icon: LogsIcon },
];

function InstanceTabs() {
  const pathname = usePathname();
  const { name: instanceName, project } = useInstanceContext();

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
  const currentIndex = TABS.findIndex((tab) => tab.value === currentTab);

  return (
    <Tabs value={currentTab}>
      <div className="w-full overflow-x-auto">
        <TabsList
          variant="line"
          underline="baseline"
          className="h-9 w-full justify-start gap-0"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const targetPath = tab.value === 'dashboard' ? '/instance' : `/instance/${tab.value}`;
            const targetIndex = TABS.findIndex((candidate) => candidate.value === tab.value);
            const transitionType =
              targetIndex > currentIndex ? 'tab-next' : 'tab-prev';
            const query = instanceName
              ? {
                  name: instanceName,
                  ...(project ? { project } : {}),
                }
              : undefined;

            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                underline="baseline"
                className="flex-none rounded-none px-3 has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3"
                asChild
              >
                <Link
                  href={{
                    pathname: targetPath,
                    query,
                  }}
                  transitionTypes={[transitionType]}
                >
                  <Icon aria-hidden="true" data-icon="inline-start" />
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
