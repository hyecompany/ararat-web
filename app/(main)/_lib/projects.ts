import { jsonFetcher } from "../../_lib/fetcher";
import type { Project, ProjectsMetadata } from "./projects.d";

export async function getProjects() {
  return jsonFetcher("/1.0/projects?recursion=1").then(
    (data) => data.metadata as ProjectsMetadata
  );
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  config?: Record<string, string>;
}

export async function createProject(
  projectData: CreateProjectRequest
): Promise<Project> {
  const endpoint = new URL(window.location.origin + "/1.0/projects");
  
  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(projectData),
  });

  const data = await response.json();
  
  if (data.type === "error") {
    throw new Error(data.error || "Failed to create project");
  }

  return data.metadata as Project;
}
