"use client";

import React, { use } from "react";
import { useInstance } from "../_hooks/useInstance";
import ProjectsContext from "@/app/(main)/_context/projects";
import { Instance, InstanceState } from "../_lib/instances.d";
import { Badge } from "@/app/_components/ui/badge";

export default function InstanceDashboard({ name }: { name: string }) {
    const { currentProject } = use(ProjectsContext);
    const { data: instance } = useInstance(name, currentProject === "all" ? null : currentProject);

    if (!instance) return null;

    const memoryUsage = instance.state?.memory?.usage;
    const diskUsage = getRootDiskUsage(instance.state);
    const networkDetails = getNetworkDetails(instance);
    const baseImage = getBaseImage(instance);
    const rootDiskPool = getRootDiskPool(instance);
    const hasStateData = Boolean(instance.state);
    const hasNetworking =
        networkDetails.ipv4.length > 0 ||
        networkDetails.ipv6.length > 0 ||
        networkDetails.macs.length > 0;

    return (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-6">
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
            </div>

            <div className="space-y-6">
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
                            {instance.profiles.map((profile: string) => (
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
            </div>
        </div>
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
        <div className="flex justify-between gap-4 text-sm py-1 border-b last:border-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium">{value}</span>
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
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="flex flex-col space-y-1.5 p-6 pb-3">
                <h3 className="font-semibold leading-none tracking-tight">{title}</h3>
            </div>
            <div className="p-6 pt-0">{children}</div>
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
    Object.values(network).forEach((iface: any) => {
        iface.addresses?.forEach((address: any) => {
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
