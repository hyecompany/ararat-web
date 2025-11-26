"use client";

import React, { use } from "react";
import { useInstance } from "../_hooks/useInstance";
import { InstanceHeader } from "./_components/instance-header";
import { NavigationTabs } from "./_components/navigation-tabs";
import ProjectsContext from "@/app/(main)/_context/projects";
import IsClientContext from "@/app/_context/isClient";
import { Spinner } from "@/app/_components/ui/spinner";
import { performInstanceAction, InstanceAction } from "../_lib/actions";
import { Alert, AlertDescription, AlertTitle } from "@/app/_components/ui/alert";

export default function InstanceLayout({
    children,
    name,
}: {
    children: React.ReactNode;
    name: string;
}) {
    const { currentProject } = use(ProjectsContext);

    const { data: instance, error, isLoading, mutate } = useInstance(name, currentProject === "all" ? null : currentProject);
    const [actionError, setActionError] = React.useState<string | null>(null);
    const [actionInFlight, setActionInFlight] = React.useState<InstanceAction | null>(null);

    const handleAction = async (action: InstanceAction) => {
        if (!instance) return;
        try {
            setActionError(null);
            setActionInFlight(action);
            await performInstanceAction({
                action,
                instance,
                project: currentProject === "all" ? instance.project ?? null : currentProject ?? instance.project ?? null,
            });
            await mutate();
        } catch (err) {
            const message =
                err instanceof Error ? err.message : `Unable to ${action} instance.`;
            setActionError(message);
        } finally {
            setActionInFlight(null);
        }
    };

    const isClient = use(IsClientContext);

    if (isLoading || !isClient) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spinner className="size-8" />
            </div>
        );
    }

    if (error || !instance) {
        return (
            <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                    {error?.message || "Instance not found or unable to load."}
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <InstanceHeader
                instance={instance}
                onAction={handleAction}
                actionInFlight={actionInFlight}
            />
            {actionError && (
                <Alert variant="destructive">
                    <AlertTitle>Action Failed</AlertTitle>
                    <AlertDescription>{actionError}</AlertDescription>
                </Alert>
            )}
            <NavigationTabs instanceName={name} />
            <div className="mt-4">
                {children}
            </div>
        </div>
    );
}
