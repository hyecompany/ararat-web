'use client';

import * as React from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { toPanelSize, type PanelSize } from '@/app/_components/layout/resizable-size';

interface ResizableLayoutProps {
  sidebar: React.ReactNode;
  content: React.ReactNode;
  detail?: React.ReactNode;
  sidebarSize?: PanelSize;
  sidebarMinSize?: PanelSize;
  sidebarMaxSize?: PanelSize;
  contentSize?: PanelSize;
  contentMinSize?: PanelSize;
  detailSize?: PanelSize;
  detailMinSize?: PanelSize;
  detailMaxSize?: PanelSize;
  className?: string;
}

export function ResizableLayout({
  sidebar,
  content,
  detail,
  sidebarSize = 20,
  sidebarMinSize = 15,
  sidebarMaxSize = 30,
  contentSize = 50,
  contentMinSize = 30,
  detailSize = 30,
  detailMinSize = 25,
  detailMaxSize = 40,
  className = '',
}: ResizableLayoutProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className={`flex h-full ${className}`}
    >
      {/* Sidebar Panel */}
      <ResizablePanel
        defaultSize={toPanelSize(sidebarSize)}
        minSize={toPanelSize(sidebarMinSize)}
        maxSize={toPanelSize(sidebarMaxSize)}
      >
        {sidebar}
      </ResizablePanel>

      <ResizableHandle />

      {/* Content Panel */}
      <ResizablePanel
        defaultSize={toPanelSize(contentSize)}
        minSize={toPanelSize(contentMinSize)}
      >
        {content}
      </ResizablePanel>

      {/* Detail Panel (Optional) */}
      {detail && (
        <>
          <ResizableHandle />
          <ResizablePanel
            defaultSize={toPanelSize(detailSize)}
            minSize={toPanelSize(detailMinSize)}
            maxSize={toPanelSize(detailMaxSize)}
          >
            {detail}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
