import { debugIncusData } from '../../debug';
import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import { requestOperation } from '../../transport';
import type { Project } from '../../types';

export async function ensureProjects(store: IncusStore, requests: RequestRegistry) {
  const status = store.getSnapshot().state.projects.collection.status;
  if (!shouldFetchStoredStatus(status)) return;

  debugIncusData('projects.ensure:fetch', { from: status });

  await requests.run('projects:collection', [resourceKeys.projectsCollection], async () => {
    try {
      const response = await requestJson<Project[]>('/1.0/projects', {
        params: { recursion: 1 },
      });

      store.update((state) => {
        state.projects.collection = { status: 'ready' };
        for (const project of response.metadata) {
          const item = store.ensureProject(project.name);
          item.metadata = { status: 'ready', data: project };
        }
      }, [
        resourceKeys.projectsCollection,
        ...response.metadata.map((project) =>
          resourceKeys.projectMetadata(project.name),
        ),
      ]);
      debugIncusData('projects.ensure:ready', {
        count: response.metadata.length,
      });
    } catch (error) {
      store.update((state) => {
        state.projects.collection = {
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unable to load projects.',
        };
      }, [resourceKeys.projectsCollection]);
      debugIncusData('projects.ensure:error', error);
    }
  });
}

export function createProjectsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: () => ensureProjects(store, requests),
    create: async (
      payload: { name: string; description?: string; config?: Record<string, string> },
      signal?: AbortSignal,
    ) => {
      const response = await requestOperation('/1.0/projects', {
        init: {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      });
      const project: Project = {
        name: payload.name,
        description: payload.description,
        config: payload.config ?? {},
      };
      store.update((state) => {
        state.projects.collection.status = 'stale';
        state.projects.items[project.name] = {
          metadata: { status: 'ready', data: project },
        };
      }, [
        resourceKeys.projectsCollection,
        resourceKeys.projectMetadata(project.name),
      ]);
      return response;
    },
    update: async (
      payload: {
        currentName: string;
        name: string;
        description?: string;
        config?: Record<string, string>;
      },
      signal?: AbortSignal,
    ) => {
      const currentName = payload.currentName.trim();
      const nextName = payload.name.trim();
      const nextProject: Project = {
        name: nextName,
        description: payload.description?.trim() || undefined,
        config: payload.config ?? {},
      };

      await requestOperation(`/1.0/projects/${encodeURIComponent(currentName)}`, {
        init: {
          method: 'PUT',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: nextProject.description ?? '',
            config: nextProject.config,
          }),
        },
      });

      if (nextName !== currentName) {
        await requestOperation(`/1.0/projects/${encodeURIComponent(currentName)}`, {
          init: {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nextName }),
          },
        });
      }

      store.update((state) => {
        state.projects.collection.status = 'stale';
        if (nextName !== currentName) delete state.projects.items[currentName];
        state.projects.items[nextName] = {
          metadata: { status: 'ready', data: nextProject },
        };
      }, [
        resourceKeys.projectsCollection,
        resourceKeys.projectMetadata(currentName),
        resourceKeys.projectMetadata(nextName),
      ]);

      return {
        project: nextProject,
        renamedFrom: nextName !== currentName ? currentName : undefined,
      };
    },
  };
}
