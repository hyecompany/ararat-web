'use client';

import React from 'react';
import { useInstanceContext } from '../_context/instance';
import { Spinner } from 'ui-web/components/spinner';
import { SnapshotsContent } from './_components/snapshots-content';

export default function SnapshotsPage() {
  const { instance, project, isLoading } = useInstanceContext();

  if (isLoading) {
    return <Spinner />;
  }

  if (!instance) {
    return null;
  }

  return (
    <SnapshotsContent
      instanceName={instance.name}
      instanceProject={instance.project ?? project ?? null}
      instanceType={instance.type}
      snapshots={instance.snapshots || []}
    />
  );
}
