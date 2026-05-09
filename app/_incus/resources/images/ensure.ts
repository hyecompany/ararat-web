import { imageKey } from '../../keys';
import { resourceKeys } from '../../resources';
import {
  applyProjectSelection,
  collectionStatusKey,
  resolveProjectResourceScope,
  type IncusProjectSelection,
} from '../../scope';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { Image } from '../../types';
import { ensureProjects } from '../projects/ensure';

function imageCollectionKey(project: IncusProjectSelection) {
  return collectionStatusKey(project);
}

export async function ensureImages(
  store: IncusStore,
  requests: RequestRegistry,
  selectedProject: IncusProjectSelection,
) {
  await ensureProjects(store, requests);

  const effectiveProject = resolveProjectResourceScope(
    store.getSnapshot().state,
    selectedProject,
    'images',
  );
  const collectionKey = imageCollectionKey(effectiveProject);
  const collection =
    store.getSnapshot().state.images.collection.byProject[collectionKey] ??
    store.getSnapshot().state.images.collection.all;
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(
    `images:${collectionKey}:collection`,
    [resourceKeys.imagesCollection(collectionKey)],
    async () => {
      try {
        const params = new URLSearchParams({ recursion: '1' });
        applyProjectSelection(params, effectiveProject);
        const response = await requestJson<Image[]>('/1.0/images', {
          params: Object.fromEntries(params.entries()),
        });

        store.update((state) => {
          state.images.collection.byProject[collectionKey] = { status: 'ready' };
          for (const image of response.metadata) {
            const key = imageKey(
              image.project ?? (collectionKey === 'all' ? 'default' : collectionKey),
              image.fingerprint,
            );
            const item = state.images.items[key] ?? store.ensureImage(key);
            item.metadata = { status: 'ready', data: image };
          }
        }, [
          resourceKeys.imagesCollection(collectionKey),
          ...response.metadata.map((image) =>
            resourceKeys.imageMetadata(
              imageKey(
                image.project ?? (collectionKey === 'all' ? 'default' : collectionKey),
                image.fingerprint,
              ),
            ),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          state.images.collection.byProject[collectionKey] = {
            status: 'error',
            error:
              error instanceof Error ? error.message : 'Unable to load images.',
          };
        }, [resourceKeys.imagesCollection(collectionKey)]);
      }
    },
  );
}

export function createImagesResource(
  store: IncusStore,
  requests: RequestRegistry,
  getProject: () => string,
) {
  return {
    ensure: (project?: IncusProjectSelection) =>
      ensureImages(store, requests, project ?? getProject()),
  };
}
