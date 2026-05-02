'use client';

import type { ReactNode } from 'react';
import type { ConsoleMode } from '../_lib/shortcuts';
import { Tabs, TabsList, TabsTrigger } from 'ui-web/components/tabs';

interface ConsoleShellProps {
  activeMode: ConsoleMode;
  isVirtualMachine: boolean;
  onModeChange: (mode: ConsoleMode) => void;
  toolbar: ReactNode;
  children: ReactNode;
}

export default function ConsoleShell({
  activeMode,
  isVirtualMachine,
  onModeChange,
  toolbar,
  children,
}: ConsoleShellProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Console</h2>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        {isVirtualMachine ? (
          <Tabs value={activeMode} onValueChange={(value) => onModeChange(value as ConsoleMode)}>
            <TabsList>
              <TabsTrigger value="text">Text</TabsTrigger>
              <TabsTrigger value="graphical">Graphical</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <div />
        )}
        {toolbar}
      </div>
      {children}
    </div>
  );
}
