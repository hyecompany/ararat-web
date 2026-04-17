'use client';

import * as React from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from 'ui-web/components/resizable';
import { useMobile } from 'ui-web/hooks/use-mobile';
import { toPanelSize, type PanelSize } from '@/app/_components/layout/resizable-size';

interface MasterDetailLayoutProps {
  // Desktop Props
  sidebar: React.ReactNode;
  content: React.ReactNode;
  detail?: React.ReactNode;

  // Mobile Props
  mobileMaster: React.ReactNode;
  mobileDetail: React.ReactNode;
  showMobileDetail: boolean;

  // Sizing Props
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

export function MasterDetailLayout({
  sidebar,
  content,
  detail,
  mobileMaster,
  mobileDetail,
  showMobileDetail,
  sidebarSize = 20,
  sidebarMinSize = 15,
  sidebarMaxSize = 30,
  contentSize = 50,
  contentMinSize = 30,
  detailSize = 30,
  detailMinSize = 25,
  detailMaxSize = 40,
  className = '',
}: MasterDetailLayoutProps) {
  const { isMobile, containerRef } = useMobile();

  return (
    <div
      ref={containerRef}
      className={`h-full w-full border rounded-lg overflow-hidden ${className}`}
    >
      {isMobile ? (
        <div className="flex flex-col h-full overflow-hidden">
          {showMobileDetail ? mobileDetail : mobileMaster}
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="flex h-full">
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
      )}
    </div>
  );
}
