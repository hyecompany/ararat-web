import type { Instance } from "../_lib/instances.d";
import type { StandardResponse } from "@/app/_lib/response";
import useSWR from "swr";

type InstanceResponse = StandardResponse<Instance>;

const fetcher = (...args: Parameters<typeof fetch>) =>
    fetch(...args)
        .then((res) => res.json())
        .then((data: InstanceResponse) => data.metadata);

export function useInstance(name: string, project?: string | null) {
    const params = new URLSearchParams({ recursion: "1" });
    if (project) {
        params.set("project", project);
    }
    return useSWR(`/1.0/instances/${name}?${params.toString()}`, fetcher);
}
