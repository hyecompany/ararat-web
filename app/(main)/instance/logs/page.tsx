'use client';

import Logs from './_components/logs';
import { useInstanceContext } from '../_context/instance';

export default function LogsPage() {
  const { name, project } = useInstanceContext();

  if (!name) {
    return null;
  }

  return <Logs instanceName={name} project={project} />;
}
