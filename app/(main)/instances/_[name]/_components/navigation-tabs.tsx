"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/app/_components/ui/lib/utils";

interface NavigationTabsProps {
    instanceName: string;
}

const tabs = [
    { name: "Dashboard", href: "" },
    { name: "Backups", href: "/backups" },
    { name: "Console", href: "/console" },
    { name: "Files", href: "/files" },
    { name: "Snapshots", href: "/snapshots" },
    { name: "Devices", href: "/devices" },
    { name: "Configuration", href: "/configuration" },
];

export function NavigationTabs({ instanceName }: NavigationTabsProps) {
    const pathname = usePathname();
    const baseUrl = `/instances/${instanceName}`;

    return (
        <div className="border-b">
            <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
                {tabs.map((tab) => {
                    const href = `${baseUrl}${tab.href}`;
                    const isActive = pathname === href || (tab.href === "" && pathname === baseUrl);

                    return (
                        <Link
                            key={tab.name}
                            href={href}
                            className={cn(
                                isActive
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
                                "whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors"
                            )}
                            aria-current={isActive ? "page" : undefined}
                        >
                            {tab.name}
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}
