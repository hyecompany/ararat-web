'use client';

import { createContext, ReactNode, useEffect, useState } from 'react';

const IsClientContext = createContext(false);

export function IsClientProvider({ children }: { children: ReactNode }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) {
        setIsClient(true);
      }
    });
    return () => {
      canceled = true;
    };
  }, []);

  return <IsClientContext value={isClient}>{children}</IsClientContext>;
}

export default IsClientContext;
