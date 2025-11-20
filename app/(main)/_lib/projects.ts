import { jsonFetcher } from "../../_lib/fetcher";
import type { Project, ProjectsMetadata } from "./projects.d";

export async function getProjects() {
  return jsonFetcher("/1.0/projects?recursion=1").then(
    (data) => data.metadata as ProjectsMetadata
  );
}

export async function getProject(projectName: string) {
  return jsonFetcher(`/1.0/projects/${projectName}`).then(
    (data) => data.metadata as Project
  );
}

export async function updateProject(
  projectName: string,
  config: Record<string, string>,
  description?: string
) {
  const endpoint = new URL(
    window.location.origin + `/1.0/projects/${projectName}`
  );
  const response = await fetch(endpoint.toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config,
      description,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: response.statusText,
    }));
    throw new Error(errorData.error || "Failed to update project");
  }

  return response.json();
}
