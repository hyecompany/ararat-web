import { useServerResourcesResource } from '@/app/_incus/resources/server/hooks';

export function useResources() {
  return useServerResourcesResource();
}
