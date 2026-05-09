'use client';

import React from 'react';
import { useInstanceContext } from '../_context/instance';
import { useInstance } from '../_hooks/instance';
import { SnapshotsContent } from './_components/snapshots-content';
import { useInstanceSnapshots } from '@/app/_incus/resources/instances/snapshots/hooks';

export default function SnapshotsPage() {
  const { name, project } = useInstanceContext();
  const { instance } = useInstance(name, project, { metadata: true });
  const instanceName = name;
  const instanceProject = project ?? null;

  if (!instanceName) {
    return null;
  }

  return <SnapshotsPageContent
    instanceName={instanceName}
    instanceProject={instanceProject}
    instanceType={instance?.type ?? 'container'}
  />;
}

function SnapshotsPageContent({
  instanceName,
  instanceProject,
  instanceType,
}: {
  instanceName: string;
  instanceProject: string | null;
  instanceType: string;
}) {
  const {
    snapshots,
    isLoading,
    isError,
  } = useInstanceSnapshots(instanceName, instanceProject);

  return (
    <SnapshotsContent
      instanceName={instanceName}
      instanceProject={instanceProject}
      instanceType={instanceType}
      snapshots={snapshots}
      isLoading={isLoading}
      isError={isError}
    />
  );
}
