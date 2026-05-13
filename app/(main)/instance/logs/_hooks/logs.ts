import React from 'react';
import { useIncusClient } from '@/app/_incus/provider';
import {
  useInstanceLogContent as useInstanceLogContentResource,
  useInstanceLogs as useInstanceLogsResource,
} from '@/app/_incus/resources/instances/logs/hooks';

export function useInstanceLogs(instanceName: string, project?: string | null) {
  const client = useIncusClient();
  const resource = useInstanceLogsResource(instanceName, project);

  const mutate = React.useCallback(async () => {
    client.instanceLogs.markStale({
      instanceName,
      project,
    });
    await client.instanceLogs.ensure({
      instanceName,
      project,
    });
  }, [client, instanceName, project]);

  return {
    ...resource,
    mutate,
  };
}

export function useInstanceLogContent(
  instanceName: string,
  project: string | null | undefined,
  filename: string | null,
) {
  return useInstanceLogContentResource(instanceName, project, filename);
}
