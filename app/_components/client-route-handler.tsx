"use client";

import React from "react";
import { usePathname } from "next/navigation";
import InstanceLayout from "../(main)/instances/_[name]/layout";
import InstancePageRouter from "../(main)/instances/_[name]/router";
import DashboardLayout from "../(main)/layout";
import { InstanceList } from "../(main)/instances/_components/instance-list";

/**
 * ClientRouteHandler is a workaround for static exports on servers that serve index.html for unknown routes.
 * It intercepts the rendering process on the client side and renders the correct component based on the URL.
 * This allows us to support dynamic routes (like /instances/[name]) even when the server doesn't know about them.
 */
export default function ClientRouteHandler({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const [isMounted, setIsMounted] = React.useState(false);

    // Wait for mount to avoid hydration mismatch.
    // The server renders "children" (default content), but the client might want to render a specific instance page.
    React.useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return <>{children}</>;
    }

    // Check if the path matches /instances/[name] or /instances/[name]/[tab]
    const instanceMatch = pathname?.match(/^\/instances\/([^/]+)(?:\/([^/]+))?$/);

    if (instanceMatch) {
        const name = instanceMatch[1];
        return (
            <DashboardLayout>
                <InstanceLayout name={name}>
                    <InstancePageRouter name={name} />
                </InstanceLayout>
            </DashboardLayout>
        );
    }

    if (pathname === "/instances") {
        return (
            <DashboardLayout>
                <InstanceList />
            </DashboardLayout>
        );
    }

    return <>{children}</>;
}
