import { ProfilesResponse } from "@/lib/incus/types/profiles";
import useSWR from "swr";

const fetcher = (...args: Parameters<typeof fetch>) =>
    fetch(...args)
        .then((res) => res.json())
        .then((data: ProfilesResponse) => data.metadata);

const buildProfilesPath = (project?: string | null) => {
    const params = new URLSearchParams({ recursion: "1" });
    if (project === "all") {
        params.set("all-projects", "true");
    } else if (project) {
        params.set("project", project);
    }
    return `/1.0/profiles?${params.toString()}`;
};

export function useProfiles(project?: string | null) {
    return useSWR(buildProfilesPath(project), fetcher);
}
