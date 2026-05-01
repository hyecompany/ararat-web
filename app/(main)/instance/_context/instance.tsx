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
  isError: any;
  isValidating: boolean;
  mutate: () => Promise<any>;
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

function InstanceProviderInner({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const name = searchParams.get('name');
  const project = searchParams.get('project');
  const { instance, isLoading, isError, mutate, isValidating } =
    useInstance(name, project);
  const instanceClass = useMemo(
    () =>
      instance
        ? new InstanceClass(instance.name, instance.project ?? project ?? null)
        : null,
    [instance, project]
  );

  const value: InstanceContextValue = useMemo(
    () => ({
      name,
      project,
      instance,
      isLoading,
      isError,
      isValidating,
      mutate,
      instanceClass,
    }),
    [instance, instanceClass, isError, isLoading, isValidating, mutate, name, project],
  );



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
