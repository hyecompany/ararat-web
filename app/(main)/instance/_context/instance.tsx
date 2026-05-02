'use client';

import React, {
  createContext,
  useContext,
  ReactNode,
  useMemo,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useInstance } from '../_hooks/instance';
import { Instance } from '../../instances/_lib/instances.d';
import InstanceClass from '../../_lib/instance';

interface InstanceContextValue {
  name: string | null;
  project: string | null;
  instance: Instance | undefined;
  isLoading: boolean;
  isError: Error | null;
  isValidating: boolean;
  mutate: () => Promise<void>;
  instanceClass: InstanceClass | null;
}

const InstanceContext = createContext<InstanceContextValue>({
  name: null,
  project: null,
  instance: undefined,
  isLoading: true,
  isError: null,
  isValidating: true,
  mutate: async () => {},
  instanceClass: null,
});

function useInstanceContextValue(
  name: string | null,
  project: string | null,
): InstanceContextValue {
  const { instance, isLoading, isError, mutate, isValidating } =
    useInstance(name, project);
  const instanceName = instance?.name ?? name;
  const instanceProject = instance?.project ?? project ?? null;
  const instanceClass = useMemo(
    () => (instanceName ? new InstanceClass(instanceName, instanceProject) : null),
    [instanceName, instanceProject],
  );

  return useMemo(
    () => ({
      name,
      project,
      instance,
      isLoading,
      isError: isError instanceof Error ? isError : null,
      isValidating,
      mutate: async () => {
        await mutate();
      },
      instanceClass,
    }),
    [instance, instanceClass, isError, isLoading, isValidating, mutate, name, project],
  );
}

function InstanceProviderInner({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const value = useInstanceContextValue(
    searchParams.get('name'),
    searchParams.get('project'),
  );

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
}

export function InstanceProviderForName({
  children,
  name,
  project = null,
}: {
  children: ReactNode;
  name: string | null;
  project?: string | null;
}) {
  const value = useInstanceContextValue(name, project);

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  return (
    <React.Suspense fallback={null}>
      <InstanceProviderInner>{children}</InstanceProviderInner>
    </React.Suspense>
  );
}

export function useInstanceContext() {
  const context = useContext(InstanceContext);
  if (context === undefined) {
    throw new Error('useInstanceContext must be used within InstanceProvider');
  }
  return context;
}

export { InstanceContext };
