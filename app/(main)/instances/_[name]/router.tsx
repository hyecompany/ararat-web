"use client";

import React from "react";
import { usePathname } from "next/navigation";
import InstanceDashboard from "./page";

export default function InstancePageRouter({ name }: { name: string }) {
    const pathname = usePathname();

    // Extract the part after /instances/[name]
    // e.g. /instances/foo/backups -> backups
    const prefix = `/instances/${name}`;
    const suffix = pathname?.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    const tab = suffix.split("/")[1]; // /backups -> backups

    if (!tab || tab === "dashboard") {
        return <InstanceDashboard name={name} />;
    }

    return (
        <div className="p-4 text-center text-muted-foreground">
            {tab.charAt(0).toUpperCase() + tab.slice(1)} view not implemented yet.
        </div>
    );
}
