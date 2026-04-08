import type { InstancesResponse } from '../_lib/instances.d';
import { useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { buildApiPath } from '@/app/_lib/url';
import type { StandardResponse } from '@/app/_lib/response.d';
import type { Instance } from '../_lib/instances.d';

const fetcher = (...args: Parameters<typeof fetch>) =>
  fetch(...args)
    .then((res) => res.json())
    .then((data: InstancesResponse) => data.metadata);

function buildInstanceDetailCacheValue(instance: Instance): StandardResponse<Instance> {
  return {
    type: 'sync',
    status: 'Success',
    status_code: 200,
    metadata: instance,
  };
}

function shouldSeedUnscopedInstanceDetail(project: string | null | undefined, instance: Instance) {
  const isDefaultProject = !project || project === 'default';
  const isDefaultInstance = !instance.project || instance.project === 'default';

  return isDefaultProject && isDefaultInstance;
}

export function useInstances(project?: string | null) {
  const { mutate: mutateCache } = useSWRConfig();
  const url = buildApiPath('/1.0/instances', {
    project: project ?? null,
    params: { recursion: 2 },
  });
  const result = useSWR(url, fetcher);

  useEffect(() => {
    if (!result.data) return;

    for (const instance of result.data) {
      if (!shouldSeedUnscopedInstanceDetail(project, instance)) {
        continue;
      }

      void mutateCache(
        `/1.0/instances/${instance.name}?recursion=1`,
        buildInstanceDetailCacheValue(instance),
        { revalidate: false },
      );
    }
  }, [mutateCache, project, result.data]);

  return result;
}
