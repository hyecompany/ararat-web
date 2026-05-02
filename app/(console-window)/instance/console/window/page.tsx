import { Suspense } from 'react';
import ConsoleWindowClient from '@/app/(main)/instance/console/_components/console-window-client';

export default function ConsoleWindowPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 bg-black" />}>
      <ConsoleWindowClient />
    </Suspense>
  );
}
