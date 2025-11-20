import useSWR from "swr";
import { getProject } from "@/app/(main)/_lib/projects";

export function useProject(projectName: string | null) {
  return useSWR(
    projectName ? `/1.0/projects/${projectName}` : null,
    () => (projectName ? getProject(projectName) : null)
  );
}
