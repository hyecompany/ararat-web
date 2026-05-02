import { jsonFetcher, textFetcher } from '@/app/_lib/fetcher';
import { Instance } from '../../instances/_lib/instances.d';

function getProjectQuery(project?: string | null) {
  return project ? `?project=${encodeURIComponent(project)}` : '';
}

export function buildInstanceLogsKey(instance: Instance, filename?: string | null) {
  const projectQuery = getProjectQuery(instance.project);
  const logPath = filename ? `/${encodeURIComponent(filename)}` : '';
  return `/1.0/instances/${encodeURIComponent(instance.name)}/logs${logPath}${projectQuery}`;
}

export async function getInstanceLogs(instance: Instance) {
  return jsonFetcher<string[]>(buildInstanceLogsKey(instance)).then((data) => {
    // The API returns a list of URLs like "/1.0/instances/foo/logs/lxc.log"
    // We want to extract just the filename part for the UI
    return data.metadata.map((url) => {
      const parts = url.split('/');
      return parts[parts.length - 1];
    });
  });
}

export async function getInstanceLogContent(instance: Instance, filename: string) {
  const projectQuery = getProjectQuery(instance.project);
  return textFetcher(
    `/1.0/instances/${encodeURIComponent(instance.name)}/logs/${encodeURIComponent(filename)}${projectQuery}`,
  );
}

export async function deleteInstanceLog(instance: Instance, filename: string) {
  const projectQuery = getProjectQuery(instance.project);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}/logs/${encodeURIComponent(filename)}${projectQuery}`,
    {
      method: 'DELETE',
    },
  );

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(payload?.error || `Unable to delete log file ${filename}`);
  }
}
