import React from "react";
import { Instance } from "../../_lib/instances.d";
import { Badge } from "@/app/_components/ui/badge";
import { Button } from "@/app/_components/ui/button";
import { PlayIcon, SquareIcon, RotateCcwIcon, SnowflakeIcon } from "lucide-react";
import { Spinner } from "@/app/_components/ui/spinner";

interface InstanceHeaderProps {
    instance: Instance;
    onAction: (action: "start" | "stop" | "restart" | "freeze") => void;
    actionInFlight: string | null;
}

export function InstanceHeader({ instance, onAction, actionInFlight }: InstanceHeaderProps) {
    const isRunning =
        instance.status?.toLowerCase() === "running" ||
        instance.status?.toLowerCase() === "started";

    const os = instance.config?.["image.os"] || "Unknown";

    return (
        <div className="flex items-start justify-between gap-4 pb-6 border-b">
            <div className="flex items-center gap-4">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-lg border bg-muted/40">
                    {/* Placeholder for OS Logo - using text for now as per requirements */}
                    <span className="text-xs font-semibold">{os}</span>

                    {isRunning && (
                        <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500"></span>
                        </span>
                    )}
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{instance.name}</h1>
                    <p className="text-sm text-muted-foreground">
                        {instance.description || "No description provided"}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {isRunning ? (
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onAction("stop")}
                            disabled={actionInFlight !== null}
                        >
                            {actionInFlight === "stop" ? (
                                <Spinner className="mr-2 size-4" />
                            ) : (
                                <SquareIcon className="mr-2 size-4" />
                            )}
                            Stop
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onAction("restart")}
                            disabled={actionInFlight !== null}
                        >
                            {actionInFlight === "restart" ? (
                                <Spinner className="mr-2 size-4" />
                            ) : (
                                <RotateCcwIcon className="mr-2 size-4" />
                            )}
                            Restart
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onAction("freeze")}
                            disabled={actionInFlight !== null}
                        >
                            {actionInFlight === "freeze" ? (
                                <Spinner className="mr-2 size-4" />
                            ) : (
                                <SnowflakeIcon className="mr-2 size-4" />
                            )}
                            Freeze
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAction("start")}
                        disabled={actionInFlight !== null}
                    >
                        {actionInFlight === "start" ? (
                            <Spinner className="mr-2 size-4" />
                        ) : (
                            <PlayIcon className="mr-2 size-4" />
                        )}
                        Start
                    </Button>
                )}
            </div>
        </div>
    );
}
