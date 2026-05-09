'use client';
import { use } from 'react';
import AuthenticationContext from '@/app/_context/authentication';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { AlertCircleIcon } from 'lucide-react';
import { Button } from 'ui-web/components/button';
import Link from 'next/link';
export default function AlreadyAuthenticated() {
  const { data, isRefreshing } = use(AuthenticationContext);
  return data?.isAuthenticated ? (
    <Alert
      variant="default"
      className={`${isRefreshing ? 'freshness-shimmer' : ''} mb-4`}
    >
      <AlertCircleIcon />
      <AlertTitle>You are already authenticated.</AlertTitle>
      <AlertDescription>
        You are already logged into Hye Ararat and do not need to authenticate
        again.
        <Link href="/" transitionTypes={['nav-back']}>
          <Button size="sm">Go to Dashboard</Button>
        </Link>
      </AlertDescription>
    </Alert>
  ) : null;
}
