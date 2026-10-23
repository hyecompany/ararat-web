'use client';

import React from 'react';
import { useInstanceContext } from './_context/instance';
import { useInstance } from './_hooks/instance';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  formatBytes,
  formatDate,
  getRootDiskUsage,
  getNetworkDetails,
  getBaseImage,
  getRootDiskPool,
  calcResourcePercent,
  calcCpuPercent,
  getCPUCount,
} from './_lib/utils';
import { useServerResourcesResource } from '@/app/_incus/resources/server/hooks';

export default function InstancePage() {
  const { name, project } = useInstanceContext();
  const { instance, isError } = useInstance(name, project, {
    metadata: true,
    state: true,
  });
  const { data: serverResources } = useServerResourcesResource();
  const [cpuPercent, setCpuPercent] = React.useState<number>(0);
  const lastCpuUsage = React.useRef<number | null>(null);
  const latestInstanceRef = React.useRef<typeof instance>(undefined);
  const hostCpusRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    latestInstanceRef.current = instance;
    hostCpusRef.current = serverResources?.cpu?.total;
  });

  const hasInstance = Boolean(instance);

  React.useEffect(() => {
    if (!hasInstance) {
      lastCpuUsage.current = null;
      setCpuPercent(0);
      return;
    }

    // Sample on a fixed client timer instead of on store-render times: state
    // updates can coalesce or lag (fetch latency, bursts), while the CPU
    // counter comes from Incus at a known ~5s poll cadence (Issue #68).
    // Delta time must be the spacing between two *readings*, not between
    // renders, otherwise percent explodes.
    const timer = setInterval(() => {
      const inst = latestInstanceRef.current;
      if (!inst) return;
      const currentUsage = inst.state?.cpu?.usage;
      if (typeof currentUsage !== 'number') return;

      if (lastCpuUsage.current === null) {
        lastCpuUsage.current = currentUsage;
        return;
      }

      const usageDelta = currentUsage - lastCpuUsage.current;
      // Repeated sample without a fetch in between observes nothing, and a
      // lower counter means the instance restarted; both must not move percent.
      if (usageDelta > 0) {
        // The store polls /state every 5s; readings are one poll apart.
        // shortcut: a missed poll briefly halves the window and doubles the
        // percent; upgrade when state data carries a sampledAt timestamp.
        const percent = calcCpuPercent(
          usageDelta,
          5 * 1_000_000_000,
          getCPUCount(inst, hostCpusRef.current),
        );
        if (Number.isFinite(percent)) setCpuPercent(Math.max(0, percent));
      }
      lastCpuUsage.current = currentUsage;
    }, 5000);
    return () => clearInterval(timer);
  }, [hasInstance]);

  if (!name || isError) {
    return null; // Layout handles error display
  }

  const isValuePending = !instance;
  const memoryUsage = instance?.state?.memory?.usage ?? 0;
  const memoryTotal =
    instance?.state?.memory?.total ?? instance?.state?.memory?.usage_peak;
  const memoryPercent = instance
    ? calcResourcePercent(memoryUsage, memoryTotal)
    : 0;

  const diskUsage = instance ? getRootDiskUsage(instance.state) ?? 0 : 0;
  const diskTotal = instance?.state?.disk?.root?.total;
  const diskPercent = instance ? calcResourcePercent(diskUsage, diskTotal) : 0;

  const networkDetails = instance
    ? getNetworkDetails(instance)
    : { ipv4: [], ipv6: [], macs: [] };
  const baseImage = instance ? getBaseImage(instance) : undefined;
  const rootDiskPool = instance ? getRootDiskPool(instance) : undefined;
  const instanceType = !instance
    ? undefined
    : instance.type === 'virtual-machine'
      ? 'Virtual Machine'
      : instance.type === 'container'
        ? 'Container'
        : (instance.type ?? '—');

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
          <CardDescription>Current resource usage</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Memory</span>
              <PendingValue pending={isValuePending} className="w-28">
                {formatBytes(memoryUsage)}
                {memoryTotal ? ` / ${formatBytes(memoryTotal)}` : ''}
              </PendingValue>
            </div>
            {isValuePending ? (
              <Skeleton className="h-2 w-full" />
            ) : (
              <Progress value={memoryPercent} className="h-2" />
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Root Disk</span>
              <PendingValue pending={isValuePending} className="w-28">
                {formatBytes(diskUsage)}
                {diskTotal ? ` / ${formatBytes(diskTotal)}` : ''}
              </PendingValue>
            </div>
            {isValuePending ? (
              <Skeleton className="h-2 w-full" />
            ) : (
              <Progress value={diskPercent} className="h-2" />
            )}
          </div>
          {(isValuePending || instance?.state?.cpu?.usage !== undefined) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">CPU Usage</span>
                <PendingValue pending={isValuePending} className="w-14">
                  {cpuPercent.toFixed(2)}%
                </PendingValue>
              </div>
              {isValuePending ? (
                <Skeleton className="h-2 w-full" />
              ) : (
                <Progress value={cpuPercent} className="h-2" />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Networking</CardTitle>
          <CardDescription>Network interfaces and addresses</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              IPv4
            </span>
            <div className="flex flex-wrap gap-2">
              {isValuePending ? (
                <>
                  <Skeleton className="h-6 w-28 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                </>
              ) : networkDetails.ipv4.length > 0 ? (
                networkDetails.ipv4.map((ip) => (
                  <Badge key={ip} variant="secondary" className="font-mono">
                    {ip}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              IPv6
            </span>
            <div className="flex flex-wrap gap-2">
              {isValuePending ? (
                <>
                  <Skeleton className="h-6 w-36 rounded-full" />
                  <Skeleton className="h-6 w-28 rounded-full" />
                </>
              ) : networkDetails.ipv6.length > 0 ? (
                networkDetails.ipv6.map((ip) => (
                  <Badge key={ip} variant="secondary" className="font-mono">
                    {ip}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              MAC
            </span>
            <div className="flex flex-wrap gap-2">
              {isValuePending ? (
                <Skeleton className="h-6 w-32 rounded-full" />
              ) : networkDetails.macs.length > 0 ? (
                networkDetails.macs.map((mac) => (
                  <Badge key={mac} variant="outline" className="font-mono">
                    {mac}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
          <CardDescription>Instance details and configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Project</span>
            <PendingValue pending={isValuePending} className="w-16">
              {instance?.project ?? 'default'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <PendingValue pending={isValuePending} className="w-24">
              {instanceType ?? '—'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base Image</span>
            <PendingValue
              pending={isValuePending}
              className="w-32"
              valueClassName="truncate max-w-[150px]"
              title={baseImage ?? ''}
            >
              {baseImage ?? '—'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Architecture</span>
            <PendingValue pending={isValuePending} className="w-20">
              {instance?.architecture ?? '—'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location</span>
            <PendingValue pending={isValuePending} className="w-20">
              {instance?.location ?? '—'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Storage Pool</span>
            <PendingValue pending={isValuePending} className="w-20">
              {rootDiskPool ?? '—'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">PID</span>
            <PendingValue pending={isValuePending} className="w-12">
              {instance?.state?.pid ?? '—'}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <PendingValue pending={isValuePending} className="w-28">
              {formatDate(instance?.created_at)}
            </PendingValue>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Used</span>
            <PendingValue pending={isValuePending} className="w-28">
              {formatDate(instance?.last_used_at)}
            </PendingValue>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 lg:col-span-3">
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
          <CardDescription>Applied configuration profiles</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {isValuePending ? (
              <>
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </>
            ) : (instance?.profiles && instance.profiles.length > 0
              ? instance.profiles
              : ['default']
            ).map((profile: string) => (
              <Badge key={profile} variant="outline">
                {profile}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PendingValue({
  pending,
  className,
  valueClassName,
  title,
  children,
}: {
  pending: boolean;
  className?: string;
  valueClassName?: string;
  title?: string;
  children: React.ReactNode;
}) {
  if (pending) {
    return <Skeleton className={cn('h-4', className)} />;
  }

  return (
    <span className={valueClassName} title={title}>
      {children}
    </span>
  );
}
