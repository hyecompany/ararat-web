'use client';

import type { RefCallback, RefObject } from 'react';

interface TextConsoleViewProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefCallback<HTMLDivElement | null>;
  onFocus: () => void;
}

export default function TextConsoleView({
  viewportRef,
  terminalRef,
  onFocus,
}: TextConsoleViewProps) {
  return (
    <div
      ref={viewportRef}
      className="w-full flex flex-col"
      style={{ height: '60vh', minHeight: '300px' }}
    >
      <div className="flex-1 min-h-0 rounded-lg border bg-card shadow-sm font-mono p-3 box-border overflow-hidden">
        <div
          ref={terminalRef}
          className="h-full w-full"
          tabIndex={0}
          role="application"
          aria-label="Instance Console"
          onClick={onFocus}
        />
      </div>
    </div>
  );
}
