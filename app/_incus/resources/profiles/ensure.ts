import { nameEqualsFilter } from '../../filters';
import { profileKey } from '../../keys';
import { resourceKeys } from '../../resources';
import {
  applyProjectSelection,
  collectionStatusKey,
  resolveProjectResourceScope,
} from '../../scope';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { Profile } from '../../types';
import { ensureProjects } from '../projects/ensure';

export type ProfilesRequest = {
  names?: string[];
};

export async function ensureProfiles(
  store: IncusStore,
  requests: RequestRegistry,
  project: string,
  request: ProfilesRequest = {},
) {
  await ensureProjects(store, requests);

  const effectiveProject = resolveProjectResourceScope(
    store.getSnapshot().state,
    project,
    'profiles',
  );
  const collectionKey = collectionStatusKey(effectiveProject);
  const collection =
    store.getSnapshot().state.profiles.collection.byProject[collectionKey] ??
    store.getSnapshot().state.profiles.collection.all;
  const status = collection.status;
  if (!shouldFetchStoredStatus(status)) return;

  const affectedKeys = [resourceKeys.profilesCollection(collectionKey)];
  await requests.run(
    `profiles:${project}:${collectionKey}:${request.names?.join('|') ?? '*'}`,
    affectedKeys,
    async () => {
      try {
        const params = new URLSearchParams({ recursion: '1' });
        applyProjectSelection(params, effectiveProject);
        if (request.names?.length) {
          params.set('filter', nameEqualsFilter(request.names));
        }

        const response = await requestJson<Profile[]>('/1.0/profiles', {
          params: Object.fromEntries(params.entries()),
        });

        store.update((state) => {
          state.profiles.collection.byProject[collectionKey] = { status: 'ready' };
          for (const profile of response.metadata) {
            const itemKey = profileKey(collectionKey, profile.name);
            const item = store.ensureProfile(itemKey);
            item.metadata = { status: 'ready', data: profile };
          }
        }, [
          resourceKeys.profilesCollection(collectionKey),
          ...response.metadata.map((profile) =>
            resourceKeys.profileMetadata(profileKey(collectionKey, profile.name)),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          state.profiles.collection.byProject[collectionKey] = {
            status: 'error',
            error:
              error instanceof Error ? error.message : 'Unable to load profiles.',
          };
        }, [resourceKeys.profilesCollection(collectionKey)]);
      }
    },
  );
}

export function createProfilesResource(
  store: IncusStore,
  requests: RequestRegistry,
  getProject: () => string,
) {
  return {
    ensure: (request?: ProfilesRequest) =>
      ensureProfiles(store, requests, getProject(), request),
  };
}
