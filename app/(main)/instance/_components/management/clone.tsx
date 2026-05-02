'use client';

import * as React from 'react';
import ProjectsContext from '@/app/(main)/_context/projects';
import { Combobox, ComboboxContent, ComboboxItem, ComboboxTrigger } from '@/components/ui/combobox';
import { useStoragePools } from '@/app/(main)/_hooks/storagePools';
import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Checkbox } from 'ui-web/components/checkbox';
import { Input } from 'ui-web/components/input';
import { cloneInstance } from '../../_lib/instance';
import { ManagementFooter } from './footer';

export default function Clone({
  instance,
  onBack,
  onDone,
}: {
  instance: Instance;
  onBack: () => void;
  onDone: () => Promise<void>;
}) {
  const { projects } = React.useContext(ProjectsContext);
  const { data: storagePools } = useStoragePools();
  const rootDiskPoolName =
    instance.expanded_devices?.root?.pool ?? instance.devices?.root?.pool ?? null;
  const [name, setName] = React.useState(`${instance.name}-copy`);
  const [targetProject, setTargetProject] = React.useState(instance.project ?? 'default');
  const [rootStoragePool, setRootStoragePool] = React.useState(rootDiskPoolName ?? '');
  const [allowInconsistent, setAllowInconsistent] = React.useState(false);
  const [instanceOnly, setInstanceOnly] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setName(`${instance.name}-copy`);
    setTargetProject(instance.project ?? 'default');
    setRootStoragePool(rootDiskPoolName ?? storagePools?.[0]?.name ?? '');
    setAllowInconsistent(false);
    setInstanceOnly(false);
    setError(null);
  }, [instance.name, instance.project, rootDiskPoolName, storagePools]);

  const availableTargetProjects = React.useMemo(() => {
    const names = new Set(projects.map((project) => project.name));
    names.add(targetProject || instance.project || 'default');
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [instance.project, projects, targetProject]);

  const availableRootStoragePools = React.useMemo(() => {
    const names = new Set((storagePools ?? []).map((pool) => pool.name));
    if (rootDiskPoolName) {
      names.add(rootDiskPoolName);
    }
    if (rootStoragePool) {
      names.add(rootStoragePool);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [rootDiskPoolName, rootStoragePool, storagePools]);

  const handleClone = async () => {
    try {
      setError(null);
      setIsSaving(true);
      await cloneInstance({
        instance,
        name,
        targetProject,
        rootStoragePool,
        allowInconsistent,
        instanceOnly,
      });
      await onDone();
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Unable to clone instance.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium">Name</p>
            <Input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={`${instance.name}-copy`}
              disabled={isSaving}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Root storage pool</p>
            <Combobox
              value={rootStoragePool}
              onValueChange={setRootStoragePool}
              disabled={isSaving}
            >
              <ComboboxTrigger placeholder="Select storage pool" />
              <ComboboxContent
                searchPlaceholder="Search storage pools..."
                emptyLabel="No storage pools found."
              >
                {availableRootStoragePools.map((poolName) => (
                  <ComboboxItem
                    key={poolName}
                    value={poolName}
                    description={storagePools?.find((pool) => pool.name === poolName)?.driver}
                  >
                    {poolName}
                  </ComboboxItem>
                ))}
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Target project</p>
            <Combobox value={targetProject} onValueChange={setTargetProject} disabled={isSaving}>
              <ComboboxTrigger placeholder="Select target project" />
              <ComboboxContent
                searchPlaceholder="Search projects..."
                emptyLabel="No projects found."
              >
                {availableTargetProjects.map((projectName) => (
                  <ComboboxItem
                    key={projectName}
                    value={projectName}
                    description={
                      projects.find((project) => project.name === projectName)?.description
                    }
                  >
                    {projectName}
                  </ComboboxItem>
                ))}
              </ComboboxContent>
            </Combobox>
          </div>
        </div>

        <label className="bg-muted/20 flex items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox
            checked={allowInconsistent}
            onCheckedChange={(checked) => setAllowInconsistent(checked === true)}
            disabled={isSaving}
            aria-label="Ignore copy errors for volatile files"
          />
          <span className="space-y-1">
            <span className="block font-medium">Ignore copy errors for volatile files</span>
            <span className="text-muted-foreground block">
              Continue the copy even if volatile files cannot be copied consistently.
            </span>
          </span>
        </label>

        <label className="bg-muted/20 flex items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox
            checked={instanceOnly}
            onCheckedChange={(checked) => setInstanceOnly(checked === true)}
            disabled={isSaving}
            aria-label="Copy without instance snapshots"
          />
          <span className="space-y-1">
            <span className="block font-medium">Copy without instance snapshots</span>
            <span className="text-muted-foreground block">
              Skip source snapshots and clone only the main instance.
            </span>
          </span>
        </label>
      </div>

      <ManagementFooter
        onBack={onBack}
        backDisabled={isSaving}
        primaryLabel="Clone Instance"
        onPrimary={handleClone}
        primaryDisabled={!name.trim() || !targetProject.trim() || !rootStoragePool.trim()}
        primaryLoading={isSaving}
      />
    </div>
  );
}
