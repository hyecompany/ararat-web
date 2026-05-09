import { useImagesResource } from '@/app/_incus/resources/images/hooks';

export function useImages(project?: string | null) {
  return useImagesResource(project);
}
