'use client';

import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { cn } from 'ui-web/lib/utils';

export function ManagementShell({
  children,
  footer,
  error,
  className,
  fillHeight = true,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  error?: string | null;
  className?: string;
  fillHeight?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden',
        fillHeight && 'h-full flex-1',
        className,
      )}
    >
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className={cn('min-h-0', fillHeight && 'flex-1 overflow-hidden')}>
        {children}
      </div>
      {footer}
    </div>
  );
}
