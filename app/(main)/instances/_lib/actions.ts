import { Instance } from "./instances.d";

export type InstanceAction = "start" | "stop" | "restart" | "freeze";

export async function performInstanceAction({
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
