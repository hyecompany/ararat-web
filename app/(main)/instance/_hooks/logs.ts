import useSWR from 'swr';
import { Instance } from '../../instances/_lib/instances.d';
import { getInstanceLogContent, getInstanceLogs } from '../_lib/logs';

function buildInstanceLogsKey(instance: Instance, filename?: string | null) {
  if (!instance) {
    return null;
  }

  let key = '/1.0/instances/' + encodeURIComponent(instance.name) + '/logs';

  if (filename) {
    key += '/' + encodeURIComponent(filename);
  }

  if (instance.project) {
    key += '?project=' + encodeURIComponent(instance.project);
  }

  return key;
}

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
