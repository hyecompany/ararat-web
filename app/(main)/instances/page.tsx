"use client";

import React, { use } from "react";
import { ColumnDef, Row } from "@tanstack/react-table";
import {
  PlayIcon,
  RotateCcwIcon,
  SnowflakeIcon,
  SquareIcon,
} from "lucide-react";

import CreateInstance from "./_components/create";
import DataTable from "@/app/_components/ui/data-table";
import { Input } from "@/app/_components/ui/input";
import { Skeleton } from "@/app/_components/ui/skeleton";
import { useInstances } from "@/app/(main)/instances/_hooks/instances";
import type { Instance, InstanceState } from "./_lib/instances.d";
import { Badge } from "@/app/_components/ui/badge";
import { Button } from "@/app/_components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/app/_components/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/app/_components/ui/sheet";
import { Spinner } from "@/app/_components/ui/spinner";
import ProjectsContext from "@/app/(main)/_context/projects";
import { Progress } from "@/app/_components/ui/progress";
import IsClientContext from "@/app/_context/isClient";

type InstanceAction = "start" | "stop" | "restart" | "freeze";

const instanceActionDetails: Record<
  InstanceAction,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  start: { label: "Start", Icon: PlayIcon },
  stop: { label: "Stop", Icon: SquareIcon },
  restart: { label: "Restart", Icon: RotateCcwIcon },
  freeze: { label: "Freeze", Icon: SnowflakeIcon },
};

async function performInstanceAction({
  action,
  instance,
  project,
}: {
  action: InstanceAction;
  instance: Instance;
  project: string | null;
}) {
  const instanceProject = project ?? instance.project ?? null;
  const projectSuffix = instanceProject
    ? `?project=${encodeURIComponent(instanceProject)}`
    : "";
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}/state${projectSuffix}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        timeout: 30,
        force: false,
        stateful: false,
      }),
    }
  );
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      payload?.error || `Unable to ${action} instance ${instance.name}`
    );
  }
}

export default function Instances() {
  const { currentProject } = use(ProjectsContext);
  const { data, error, isLoading, isValidating, mutate } =
    useInstances(currentProject);
  const [search, setSearch] = React.useState("");
  const [selectedInstances, setSelectedInstances] = React.useState<Instance[]>(
    []
  );
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionInFlight, setActionInFlight] =
    React.useState<InstanceAction | null>(null);
  const [inspectorInstance, setInspectorInstance] =
    React.useState<Instance | null>(null);
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const isClient = use(IsClientContext);

  const columns = React.useMemo(() => {
    const baseColumns = [
      {
        header: "Name",
        accessorKey: "name",
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return (
            <button
              type="button"
              className="text-left font-medium text-primary underline focus:outline-none"
              onClick={(event) => event.stopPropagation()}
            >
              {instance.name}
            </button>
          );
        },
      },
      {
        header: "Description",
        accessorKey: "description",
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return (
            <span className="text-muted-foreground">
              {instance.description || "—"}
            </span>
          );
        },
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          const isRunning =
            instance.status?.toLowerCase() === "running" ||
            instance.status?.toLowerCase() === "started";
          return (
            <Badge variant={isRunning ? "default" : "secondary"}>
              {instance.status}
            </Badge>
          );
        },
      },
      {
        header: "Type",
        accessorKey: "type",
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return instance.type === "virtual-machine"
            ? "Virtual Machine"
            : "Container";
        },
      },
      {
        header: "Usage",
        id: "usage",
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          const memoryUsage = instance.state?.memory?.usage ?? 0;
          const diskUsage = getRootDiskUsage(instance.state) ?? 0;
          const memoryPercent = calcUsagePercent(
            memoryUsage,
            instance.state?.memory?.total ?? instance.state?.memory?.usage_peak
          );
          const diskPercent = calcUsagePercent(
            diskUsage,
            instance.state?.disk?.root?.total
          );
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Memory</span>
                <span>
                  {formatBytes(memoryUsage)}
                  {instance.state?.memory?.total
                    ? ` / ${formatBytes(instance.state.memory.total)}`
                    : ""}
                </span>
              </div>
              <Progress value={memoryPercent} className="h-1.5" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Disk</span>
                <span>
                  {formatBytes(diskUsage)}
                  {instance.state?.disk?.root?.total
                    ? ` / ${formatBytes(instance.state.disk.root.total)}`
                    : ""}
                </span>
              </div>
              <Progress value={diskPercent} className="h-1.5 bg-muted" />
            </div>
          );
        },
      },
    ] as ColumnDef<object, unknown>[];

    if (currentProject === "all") {
      baseColumns.splice(1, 0, {
        header: "Project",
        accessorKey: "project",
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return instance.project ?? "default";
        },
      });
    }

    return baseColumns;
  }, [currentProject]);

  const hasSelection = selectedInstances.length > 0;

  const handleMassAction = React.useCallback(
    async (action: InstanceAction) => {
      if (!selectedInstances.length) return;
      try {
        setActionError(null);
        setActionInFlight(action);
        await Promise.all(
          selectedInstances.map((instance) =>
            performInstanceAction({
              action,
              instance,
              project:
                currentProject === "all"
                  ? instance.project ?? null
                  : currentProject ?? instance.project ?? null,
            })
          )
        );
        await mutate();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to update instances.";
        setActionError(message);
      } finally {
        setActionInFlight(null);
      }
    },
    [currentProject, mutate, selectedInstances]
  );

  const handleSelectionChange = React.useCallback((rows: Row<object>[]) => {
    setSelectedInstances(rows.map((row) => row.original as Instance));
  }, []);

  const handleRowClick = React.useCallback((row: Row<object>) => {
    setInspectorInstance(row.original as Instance);
    setIsSheetOpen(true);
  }, []);

  const isBusy = (isLoading && !data) || !isClient;

  React.useEffect(() => {
    setSelectedInstances([]);
  }, [currentProject]);

  return (
    <>
      <div className="space-y-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-2xl font-semibold">Instances</p>
          <div className="flex flex-1 flex-wrap items-center gap-3 justify-end">
            {!hasSelection ? (
              !isBusy ? (
                <Input
                  placeholder="Search instances..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full sm:w-64"
                />
              ) : (
                <Skeleton className="h-10 w-full sm:w-64" />
              )
            ) : null}
            {hasSelection ? (
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                {(
                  Object.entries(instanceActionDetails) as [
                    InstanceAction,
                    {
                      label: string;
                      Icon: React.ComponentType<{ className?: string }>;
                    }
                  ][]
                ).map(([action, { label, Icon }]) => (
                  <Button
                    key={action}
                    variant="outline"
                    size="sm"
                    disabled={actionInFlight !== null}
                    onClick={() => handleMassAction(action)}
                  >
                    {actionInFlight === action ? (
                      <Spinner className="mr-2 size-3" />
                    ) : (
                      <Icon className="mr-2 size-3" />
                    )}
                    {label}
                  </Button>
                ))}
              </div>
            ) : (
              <CreateInstance className="w-full sm:w-auto" />
            )}
          </div>
        </div>
        {actionError ? (
          <Alert variant="destructive">
            <AlertTitle>Mass action failed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load instances</AlertTitle>
            <AlertDescription>
              {error.message ||
                "Check your Incus API connection and try again."}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {!isBusy ? (
        <DataTable
          key={currentProject}
          enableSelection
          data={(data as Instance[]) ?? []}
          cols={columns}
          className={isValidating ? "animate-pulse" : ""}
          stringFilter={search}
          onSelectionChange={handleSelectionChange}
          onRowClick={(row) => handleRowClick(row)}
        />
      ) : (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      <Sheet
        open={isSheetOpen}
        onOpenChange={(open) => {
          setIsSheetOpen(open);
          if (!open) setInspectorInstance(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-md">
          {inspectorInstance ? (
            <InstanceDetails instance={inspectorInstance} />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Select an instance to view its details.
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function InstanceDetails({ instance }: { instance: Instance }) {
  const memoryUsage = instance.state?.memory?.usage;
  const diskUsage = getRootDiskUsage(instance.state);
  const networkDetails = React.useMemo(
    () => getNetworkDetails(instance),
    [instance]
  );
  const baseImage = getBaseImage(instance);
  const rootDiskPool = getRootDiskPool(instance);
  const hasStateData = Boolean(instance.state);
  const hasNetworking =
    networkDetails.ipv4.length > 0 ||
    networkDetails.ipv6.length > 0 ||
    networkDetails.macs.length > 0;

  return (
    <>
      <SheetHeader className="px-4 pt-4">
        <SheetTitle>{instance.name}</SheetTitle>
        <SheetDescription>
          {instance.description || "No description available."}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Badge>{instance.status}</Badge>
          <Badge variant="outline" className="capitalize">
            {instance.type}
          </Badge>
        </div>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <Section title="Overview">
          <DetailRow
            label="Instance Memory"
            value={
              instance.state?.memory?.total
                ? `${formatBytes(memoryUsage)} / ${formatBytes(
                    instance.state.memory.total
                  )}`
                : formatBytes(memoryUsage)
            }
            hidden={!hasStateData || typeof memoryUsage !== "number"}
          />
          <DetailRow
            label="Instance Root Disk Usage"
            value={formatBytes(diskUsage)}
            hidden={!hasStateData || typeof diskUsage !== "number"}
          />
        </Section>
        <Section title="Metadata">
          <DetailRow
            label="Project"
            value={instance.project ?? "default"}
            hidden={false}
          />
          <DetailRow
            label="Base Image"
            value={baseImage ?? "—"}
            hidden={false}
          />
          <DetailRow
            label="Architecture"
            value={instance.architecture ?? "—"}
            hidden={false}
          />
          <DetailRow
            label="Cluster Member"
            value={instance.location ?? "—"}
            hidden={false}
          />
          <DetailRow
            label="Root Disk Storage Pool"
            value={rootDiskPool ?? "—"}
            hidden={false}
          />
          <DetailRow
            label="Process ID"
            value={instance.state?.pid?.toString() ?? "—"}
            hidden={!instance.state?.pid}
          />
          <DetailRow
            label="Creation Date"
            value={formatDate(instance.created_at)}
            hidden={false}
          />
          <DetailRow
            label="Date of Last Use"
            value={formatDate(instance.last_used_at)}
            hidden={false}
          />
        </Section>
        <Section title="Networking" hidden={!hasNetworking}>
          <DetailRow
            label="IPv4 Addresses"
            value={
              <TagList
                items={networkDetails.ipv4}
                placeholder="No IPv4 addresses"
              />
            }
            hidden={networkDetails.ipv4.length === 0}
          />
          <DetailRow
            label="IPv6 Addresses"
            value={
              <TagList
                items={networkDetails.ipv6}
                placeholder="No IPv6 addresses"
              />
            }
            hidden={networkDetails.ipv6.length === 0}
          />
          <DetailRow
            label="MAC Addresses"
            value={
              <TagList
                items={networkDetails.macs}
                placeholder="No MAC addresses"
              />
            }
            hidden={networkDetails.macs.length === 0}
          />
        </Section>
        <Section title="Profiles">
          {instance.profiles?.length ? (
            <div className="flex flex-wrap gap-2 justify-end">
              {instance.profiles.map((profile) => (
                <Badge key={profile} variant="outline">
                  {profile}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-right">
              No profiles
            </p>
          )}
        </Section>
        <Section title="Snapshots">
          {instance.snapshots?.length ? (
            <div className="space-y-2">
              {instance.snapshots.map((snapshot) => (
                <div
                  key={snapshot.name}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{snapshot.name}</span>
                    <Badge variant="outline">
                      {snapshot.stateful ? "Stateful" : "Stateless"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(snapshot.created_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-right">
              No snapshots
            </p>
          )}
        </Section>
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
  hidden,
}: {
  label: string;
  value: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }
  return (
    <div className="flex justify-between gap-4 text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }
  return (
    <div className="mt-4 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TagList({
  items,
  placeholder,
}: {
  items: string[];
  placeholder: string;
}) {
  if (!items.length) {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }
  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function formatBytes(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  if (value === 0) return "0 B";
  const exponent = Math.min(
    Math.max(Math.floor(Math.log(value) / Math.log(1024)), 0),
    units.length - 1
  );
  const num = value / Math.pow(1024, exponent);
  return `${num.toFixed(num >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getRootDiskUsage(state?: InstanceState) {
  if (!state?.disk) return undefined;
  const rootDisk =
    state.disk["root"] ||
    state.disk["/"] ||
    Object.values(state.disk)[0] ||
    null;
  return rootDisk?.usage;
}

function getNetworkDetails(instance: Instance) {
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();
  const macs = new Set<string>();
  const network = instance.state?.network ?? {};
  Object.values(network).forEach((iface) => {
    iface.addresses?.forEach((address) => {
      if (!address.address) return;
      if (address.family === "inet") {
        ipv4.add(address.address);
      } else if (address.family === "inet6" && address.scope !== "link") {
        ipv6.add(address.address);
      }
    });
    if (iface.hwaddr) {
      macs.add(iface.hwaddr);
    }
  });
  return {
    ipv4: Array.from(ipv4),
    ipv6: Array.from(ipv6),
    macs: Array.from(macs),
  };
}

function getBaseImage(instance: Instance) {
  return (
    instance.config?.["image.description"] ||
    instance.config?.["image.alias"] ||
    instance.config?.["image.os"] ||
    instance.expanded_config?.["volatile.base_image"] ||
    instance.config?.["volatile.base_image"] ||
    null
  );
}

function getRootDiskPool(instance: Instance) {
  const rootDisk = instance.expanded_devices?.root || instance.devices?.root;
  return rootDisk?.pool ?? null;
}

function calcUsagePercent(current?: number, peak?: number) {
  if (!peak || peak <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((current ?? 0) / peak) * 100));
}
