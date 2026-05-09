'use client';

import React, {
  createContext,
  useContext,
  ReactNode,
  useMemo,
} from 'react';
import { useSearchParams } from 'next/navigation';

interface InstanceContextValue {
  name: string | null;
  project: string | null;
}

const InstanceContext = createContext<InstanceContextValue | undefined>(
  undefined,
);

function createInstanceRouteValue(
  name: string | null,
  project: string | null,
): InstanceContextValue {
  return { name, project };
}

function InstanceProviderInner({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const value = useMemo(
    () =>
      createInstanceRouteValue(
        searchParams.get('name'),
        searchParams.get('project'),
      ),
    [searchParams],
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
  const value = useMemo(
    () => createInstanceRouteValue(name, project),
    [name, project],
  );

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  return (
    <React.Suspense fallback={<InstanceProviderFallback>{children}</InstanceProviderFallback>}>
      <InstanceProviderInner>{children}</InstanceProviderInner>
    </React.Suspense>
  );
}

function InstanceProviderFallback({ children }: { children: ReactNode }) {
  const params =
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const name = params.get('name');
  const project = params.get('project');
  const value = useMemo(
    () => createInstanceRouteValue(name, project),
    [name, project],
  );

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
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
