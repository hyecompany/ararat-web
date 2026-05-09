import {
  useInstancesResource,
  type UseInstancesRequest,
} from '@/app/_incus/resources/instances/hooks';

export function useInstances(request?: string | null | UseInstancesRequest) {
  if (request && typeof request === 'object') {
    return useInstancesResource(request);
  }

  return useInstancesResource({ project: request });
}
