import { jsonFetcher } from "../../_lib/fetcher";
import type { Project, ProjectsMetadata } from "./projects.d";

/**
 * Fetches all projects with full details from the Incus API
 * @returns Promise resolving to an array of projects
 */
export async function getProjects() {
  return jsonFetcher("/1.0/projects?recursion=1").then(
    (data) => data.metadata as ProjectsMetadata
  );
}

/**
 * Fetches a single project by name from the Incus API
 * @param projectName - The name of the project to fetch
 * @returns Promise resolving to the project data
 * @throws Error if the project doesn't exist or API call fails
 */
export async function getProject(projectName: string) {
  return jsonFetcher(`/1.0/projects/${projectName}`).then(
    (data) => data.metadata as Project
  );
}

/**
 * Updates a project with new configuration and description
 * @param projectName - The name of the project to update
 * @param config - Project configuration key-value pairs
 * @param description - Optional project description
 * @returns Promise resolving to the API response
 * @throws Error if the update fails or returns an error
 */
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

  const data = await response.json();

  // Check if the response is an error type
  if (data.type === "error") {
    throw new Error(data.error || "Failed to update project");
  }

  if (!response.ok) {
    throw new Error(
      data.error || `Failed to update project: ${response.statusText}`
    );
  }

  return data;
}
