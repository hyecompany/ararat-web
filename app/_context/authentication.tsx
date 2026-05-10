'use client';

import { createContext, use, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useServerConfiguration } from '../_hooks/server';
import IsClientContext from './isClient';

export interface AuthenticationContextData {
  isAuthenticated: boolean;
  method?: string;
  identifier?: string;
}
const AuthenticationContext = createContext({
  data: null as AuthenticationContextData | null,
  isLoading: true,
  isStale: false,
  isRefreshing: true,
});

export default AuthenticationContext;

export function AuthenticationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isClient = use(IsClientContext);

  const { isLoading, isStale, isRefreshing, data } = useServerConfiguration();
  useEffect(() => {
    if (!isLoading && !isStale) {
      if (data?.auth == 'untrusted') {
        if (!pathname.startsWith('/authentication')) {
          router.replace('/authentication/login');
        }
      } else if (data?.auth == 'trusted') {
        if (pathname === '/') {
          router.replace('/instances');
        }
      }
    }
  }, [data, isLoading, isStale, pathname, router, isClient]);

  return (
    <AuthenticationContext
      value={{
        data: {
          isAuthenticated: data?.auth == 'trusted' ? true : false,
          method: data?.auth_user_method,
          identifier: data?.auth_user_name,
        },
        isLoading: !isClient || isLoading,
        isStale,
        isRefreshing: !isClient || isRefreshing,
      }}
    >
      {children}
    </AuthenticationContext>
  );
}
