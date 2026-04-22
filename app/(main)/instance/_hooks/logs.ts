import useSWR from 'swr';
import { Instance } from '../../instances/_lib/instances.d';
import { getInstanceLogContent, getInstanceLogs } from '../_lib/logs';

export function useInstanceLogs(instance: Instance) {
  return useSWR(
    instance ? '/1.0/instances/' + instance.name + '/logs?project=' + instance.project : null,
    () => getInstanceLogs(instance),
  );
}

export function useInstanceLogContent(instance: Instance, filename: string | null) {
  return useSWR(
    instance && filename
      ? `/1.0/instances/${instance.name}/logs/${filename}`
      : null,
    () => (instance && filename ? getInstanceLogContent(instance, filename) : null),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
