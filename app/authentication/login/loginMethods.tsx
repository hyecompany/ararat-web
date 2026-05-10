
'use client';
import { Button } from 'ui-web/components/button';
import { Skeleton } from 'ui-web/components/skeleton';
import { useServerConfiguration } from '@/app/_hooks/server';
import { useRouter, usePathname } from 'next/navigation';
import React, { startTransition, useEffect } from 'react';

// Timeout duration for resetting authenticating state (in milliseconds)
const AUTHENTICATING_RESET_TIMEOUT = 5000; // 5 seconds

function TLSButton(props: React.ComponentProps<typeof Button>) {
  return <Button {...props}>TLS</Button>;
}

function OIDCButton(props: React.ComponentProps<typeof Button>) {
  return <Button {...props}>OpenID Connect</Button>;
}

export default function LoginMethodsComponent() {
  const { isLoading, isStale, data } = useServerConfiguration();
  const [authenticating, setAuthenticating] = React.useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Refs for checking timeouts to prevent memory leaks if component unmounts
  const autoRedirectTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const clickTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (autoRedirectTimerRef.current) {
        clearTimeout(autoRedirectTimerRef.current);
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  // Reset authenticating state if the user navigates back
  useEffect(() => {
    if (authenticating) {
      const timeout = setTimeout(() => {
        setAuthenticating(false);
      }, AUTHENTICATING_RESET_TIMEOUT);
      return () => clearTimeout(timeout);
    }
  }, [authenticating]);

  // Auto-redirect when only one auth method is available
  // Uses replace() to prevent user from navigating back to this intermediate state
  useEffect(() => {
    if (!isLoading && !isStale) {
      if (data?.auth_methods.length === 1) {
        startTransition(() => {
          setAuthenticating(true);
        });
        if (data.auth_methods[0] === "tls") {
          console.log("Redirecting to TLS auth");
          // Defer navigation to next tick to ensure loading state is visible
          // Clear any existing timer first
          if (autoRedirectTimerRef.current) clearTimeout(autoRedirectTimerRef.current);
          autoRedirectTimerRef.current = setTimeout(() => {
            router.replace("/authentication/login/tls", {
              transitionTypes: ['nav-forward'],
            });
          }, 1);
        } else if (data.auth_methods[0] === "oidc") {
          console.log("Redirecting to OIDC auth");
          // Defer navigation to next tick to ensure loading state is visible
          // Clear any existing timer first
          if (autoRedirectTimerRef.current) clearTimeout(autoRedirectTimerRef.current);
          autoRedirectTimerRef.current = setTimeout(() => {
            router.replace("/authentication/login/oidc", {
              transitionTypes: ['nav-forward'],
            });
          }, 1);
        }
      }
    }
    // Cleanup timer on effect re-run
    return () => {
      if (autoRedirectTimerRef.current) {
        clearTimeout(autoRedirectTimerRef.current);
      }
    };
  }, [data, isLoading, isStale, router]);

  // Reset loading state if user navigates back to this page (e.g., after a failed navigation)
  useEffect(() => {
    setAuthenticating(false);
  }, [pathname]);
  return (
    <div className="flex flex-wrap gap-2">
      {!isLoading ? (
        data?.auth_methods.map((method) => {
          const props = {
            // Manual selection uses push() to allow users to return to this page
            onClick: () => {
              setAuthenticating(true);
              // Defer navigation to next tick to ensure loading state is visible
              if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
              clickTimerRef.current = setTimeout(() => {
                if (method === "tls") {
                  router.push("/authentication/login/tls", {
                    transitionTypes: ['nav-forward'],
                  });
                } else if (method === "oidc") {
                  router.push("/authentication/login/oidc", {
                    transitionTypes: ['nav-forward'],
                  });
                }
              }, 1);
            },
            loading: authenticating,
          };
          if (method === "tls")
            return (
              <TLSButton
                className={isStale ? 'freshness-shimmer' : ''}
                key={method}
                {...props}
              />
            );
          if (method === "oidc")
            return (
              <OIDCButton
                className={isStale ? "freshness-shimmer" : ""}
                key={method}
                {...props}
              />
            );
          return (
            <Button
              className={isStale ? 'freshness-shimmer' : ''}
              key={method}
              {...props}
            >
              {method}
            </Button>
          );
        })
      ) : (
        <>
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-32" />
        </>
      )}
    </div>
  );
}
