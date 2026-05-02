import useSWR from 'swr';
import { Instance } from '../../instances/_lib/instances.d';
import { buildInstanceLogsKey, getInstanceLogContent, getInstanceLogs } from '../_lib/logs';

export function useInstanceLogs(instance: Instance) {
  return useSWR(buildInstanceLogsKey(instance), () => getInstanceLogs(instance));
}

export function useInstanceLogContent(instance: Instance, filename: string | null) {
  return useSWR(
    instance && filename ? buildInstanceLogsKey(instance, filename) : null,
    () => (instance && filename ? getInstanceLogContent(instance, filename) : null),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
