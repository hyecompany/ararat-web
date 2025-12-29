'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { InstanceProvider, useInstanceContext } from './_context/instance';
import { Spinner } from 'ui-web/components/spinner';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Instance } from '../instances/_lib/instances.d';
import { Button } from 'ui-web/components/button';
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
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from 'ui-web/components/tabs';
import { OSLogo } from '@/app/_components/OSLogo';
import { getBaseImage } from './_lib/utils';
import { performInstanceAction, type InstanceAction } from './_lib/instance';
import { SiteHeader } from '@/app/(main)/_components/header';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from 'ui-web/components/breadcrumb';
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
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>Missing Parameter</AlertTitle>
            <AlertDescription>
              The "name" query parameter is required.
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
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Instance not found or failed to load.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6 p-6">
        <InstanceHeader instance={instance} onMutate={mutate} />

        <div className="flex flex-col gap-4">
          <InstanceTabs />
          <div className="mt-4">{children}</div>
        </div>
      </div>
    );
  };

  return (
    <>
      <SiteHeader>
        <Breadcrumb>
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
      {renderContent()}
    </>
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

function InstanceHeader({
  instance,
  onMutate,
}: {
  instance: Instance;
  onMutate: () => Promise<void>;
}) {
  const [actionInFlight, setActionInFlight] =
    React.useState<InstanceAction | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

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

        <div className="flex-1">
          <h1 className="text-2xl font-bold">{instance.name}</h1>
          {instance.description && (
            <p className="text-muted-foreground">{instance.description}</p>
          )}
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

function getTabFromPathname(pathname: string): string {
  // Default to dashboard
  let currentTab = 'dashboard';

  if (pathname && pathname.startsWith('/instance/')) {
    // Take the segment after /instance/
    const segment = pathname.replace(/^\/instance\/?/, '').split('/')[0];
    // Match only known TABS by value
    if (TABS.some((tab) => tab.value === segment)) {
      currentTab = segment;
    }
  }

  return currentTab;
}

function InstanceTabs() {
  const pathname = usePathname();
  const { name: instanceName } = useInstanceContext();

  const currentTab = getTabFromPathname(pathname);

  return (
    <Tabs value={currentTab} className="w-full">
      <div className="w-full overflow-x-auto">
        <TabsList className="min-w-full inline-flex">
          {TABS.map((tab) => {
            const targetPath =
              tab.value === 'dashboard' ? '/instance' : `/instance/${tab.value}`;
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} asChild>
                <Link
                  href={{
                    pathname: targetPath,
                    query: instanceName ? { name: instanceName } : undefined,
                  }}
                >
                  <Icon aria-hidden="true" className="mr-2 h-4 w-4" />
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
