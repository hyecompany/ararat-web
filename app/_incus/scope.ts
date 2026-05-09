import type { IncusStoreState, Project } from './types';

export type IncusProjectSelection = 'all' | string;

export type ProjectResourceFeature =
  | 'images'
  | 'networks'
  | 'profiles'
  | 'storage.buckets'
  | 'storage.volumes';

export function applyProjectSelection(
  params: URLSearchParams,
  project: IncusProjectSelection,
) {
  // Keep all-projects explicit in the query string. Incus treats "default",
  // "all projects", and omitted project differently, so callers should not have
  // to remember those rules at every endpoint.
  if (project === 'all') {
    params.set('all-projects', 'true');
    params.delete('project');
    return;
  }

  params.set('project', project);
  params.delete('all-projects');
}

export function collectionStatusKey(project: IncusProjectSelection) {
  return project === 'all' ? 'all' : project;
}

export function projectFeatureConfigKey(feature: ProjectResourceFeature) {
  return `features.${feature}`;
}

export function projectUsesSeparateResource(
  project: Project | undefined,
  feature: ProjectResourceFeature,
) {
  if (!project) return true;
  const value = project.config?.[projectFeatureConfigKey(feature)];

  // Incus stores project feature flags as strings. Absence means "use the
  // server default"; for existing resources we treat that as separate so an
  // incomplete project payload does not accidentally collapse data into default.
  return value !== 'false';
}

export function resolveProjectResourceScope(
  state: IncusStoreState,
  selectedProject: IncusProjectSelection,
  feature: ProjectResourceFeature,
): IncusProjectSelection {
  if (selectedProject === 'all' || selectedProject === 'default') {
    return selectedProject;
  }

  const project = state.projects.items[selectedProject]?.metadata.data;
  return projectUsesSeparateResource(project, feature) ? selectedProject : 'default';
}
