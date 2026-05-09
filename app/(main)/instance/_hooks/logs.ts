import React from 'react';
import { useIncusClient } from '@/app/_incus/provider';
import {
  useInstanceLogContent as useInstanceLogContentResource,
  useInstanceLogs as useInstanceLogsResource,
} from '@/app/_incus/resources/instances/logs/hooks';
import { Instance } from '../../instances/_lib/instances.d';

export function useInstanceLogs(instance: Instance) {
  const client = useIncusClient();
  const resource = useInstanceLogsResource(instance.name, instance.project);

  const mutate = React.useCallback(async () => {
    client.instanceLogs.markStale({
      instanceName: instance.name,
      project: instance.project,
    });
    await client.instanceLogs.ensure({
      instanceName: instance.name,
      project: instance.project,
    });
  }, [client, instance.name, instance.project]);

  return {
    ...resource,
    mutate,
  };
}

export function useInstanceLogContent(instance: Instance, filename: string | null) {
  return useInstanceLogContentResource(
    instance.name,
    instance.project,
    filename,
  );
}
