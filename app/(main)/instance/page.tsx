'use client';

import React from 'react';
import { useInstanceContext } from './_context/instance';
import { Spinner } from 'ui-web/components/spinner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'ui-web/components/card';
import { Progress } from 'ui-web/components/progress';
import { Badge } from 'ui-web/components/badge';
import {
  formatBytes,
  formatDate,
  getRootDiskUsage,
  getNetworkDetails,
  getBaseImage,
  getRootDiskPool,
  calcResourcePercent,
  getCPUCount,
} from './_lib/utils';

export default function InstancePage() {
  const { instance, isLoading } = useInstanceContext();
  const [cpuPercent, setCpuPercent] = React.useState<number>(0);
  const lastCpuUsage = React.useRef<number | null>(null);
  const lastTime = React.useRef<number | null>(null);

  const currentCpuUsage = instance?.state?.cpu?.usage;

  React.useEffect(() => {
    if (!instance) {
      lastCpuUsage.current = null;
      lastTime.current = null;
      setCpuPercent(0);
      return;
    }

    const currentUsage = instance.state?.cpu?.usage;
    const currentTime = Date.now();

    if (
      currentUsage !== undefined &&
      lastCpuUsage.current !== null &&
      lastTime.current !== null
    ) {
      const usageDelta = currentUsage - lastCpuUsage.current;
      const timeDelta = (currentTime - lastTime.current) * 1000000; // ms to ns

      if (timeDelta > 0) {
        const cpuCount = getCPUCount(instance);
        // percent is total usage across all cores (e.g. 200% for 2 cores)
        // we want to normalize to 0-100%
        const percent = ((usageDelta / timeDelta) * 100) / cpuCount;
        setCpuPercent(Math.max(0, percent));
      }
    }

    if (currentUsage !== undefined) {
      lastCpuUsage.current = currentUsage;
      lastTime.current = currentTime;
    }
  }, [currentCpuUsage, instance]);

  if (isLoading) {
    return <Spinner />;
  }

  if (!instance) {
    return null; // Layout handles error display
  }

  const memoryUsage = instance.state?.memory?.usage ?? 0;
  const memoryTotal =
    instance.state?.memory?.total ?? instance.state?.memory?.usage_peak;
  const memoryPercent = calcResourcePercent(memoryUsage, memoryTotal);

  const diskUsage = getRootDiskUsage(instance.state) ?? 0;
  const diskTotal = instance.state?.disk?.root?.total;
  const diskPercent = calcResourcePercent(diskUsage, diskTotal);

  const networkDetails = getNetworkDetails(instance);
  const baseImage = getBaseImage(instance);
  const rootDiskPool = getRootDiskPool(instance);
  const instanceType =
    instance.type === 'virtual-machine'
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
              <span>
                {formatBytes(memoryUsage)}
                {memoryTotal ? ` / ${formatBytes(memoryTotal)}` : ''}
              </span>
            </div>
            <Progress value={memoryPercent} className="h-2" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Root Disk</span>
              <span>
                {formatBytes(diskUsage)}
                {diskTotal ? ` / ${formatBytes(diskTotal)}` : ''}
              </span>
            </div>
            <Progress value={diskPercent} className="h-2" />
          </div>
          {instance.state?.cpu?.usage !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">CPU Usage</span>
                <span>{cpuPercent.toFixed(2)}%</span>
              </div>
              <Progress value={cpuPercent} className="h-2" />
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
              {networkDetails.ipv4.length > 0 ? (
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
              {networkDetails.ipv6.length > 0 ? (
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
              {networkDetails.macs.length > 0 ? (
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
            <span>{instance.project ?? 'default'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <span>{instanceType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Base Image</span>
            <span className="truncate max-w-[150px]" title={baseImage ?? ''}>
              {baseImage ?? '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Architecture</span>
            <span>{instance.architecture ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location</span>
            <span>{instance.location ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Storage Pool</span>
            <span>{rootDiskPool ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">PID</span>
            <span>{instance.state?.pid ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <span>{formatDate(instance.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Used</span>
            <span>{formatDate(instance.last_used_at)}</span>
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
            {(instance.profiles && instance.profiles.length > 0
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
