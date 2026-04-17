'use client';

import * as React from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from 'ui-web/components/resizable';
import { ScrollArea } from 'ui-web/components/scroll-area';
import { Badge } from 'ui-web/components/badge';
import { useMobile } from 'ui-web/hooks/use-mobile';
import { cn } from 'ui-web/lib/utils';
import { toPanelSize, type PanelSize } from '@/app/_components/layout/resizable-size';

export interface TabItem {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
  description?: string;
}

interface VerticalTabsLayoutProps {
  tabs: TabItem[];
  selectedTab: string;
  onTabSelect: (value: string) => void;
  children: React.ReactNode;

  // Sidebar/Header content
  title?: string;
  header?: React.ReactNode;
  controls?: React.ReactNode; // e.g. Search bar

  // Desktop specific
  detailPanel?: React.ReactNode;

  // Sizing
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

export function VerticalTabsLayout({
  tabs,
  selectedTab,
  onTabSelect,
  children,
  title,
  header,
  controls,
  detailPanel,
  sidebarSize = 20,
  sidebarMinSize = 15,
  sidebarMaxSize = 30,
  contentSize = 50,
  contentMinSize = 30,
  detailSize = 30,
  detailMinSize = 25,
  detailMaxSize = 40,
  className = '',
}: VerticalTabsLayoutProps) {
  const { isMobile, containerRef } = useMobile();

  const [isMobileDetailOpen, setIsMobileDetailOpen] = React.useState(false);

  // Reset mobile detail view when switching to desktop
  React.useEffect(() => {
    if (!isMobile) {
      setIsMobileDetailOpen(false);
    }
  }, [isMobile]);

  const handleTabClick = (value: string) => {
    onTabSelect(value);
    if (isMobile) {
      setIsMobileDetailOpen(true);
    }
  };

  const renderTabs = (orientation: 'vertical' | 'horizontal') => (
    <div className={cn('flex', 'flex-col space-y-1 p-2')}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isSelected = selectedTab === tab.value;

        return (
          <button
            type="button"
            key={tab.value}
            onClick={() => handleTabClick(tab.value)}
            className={cn(
              'flex select-none items-center gap-3 rounded-md text-left transition-colors',
              'w-full p-3',
              isSelected && !isMobile ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {Icon && <Icon className={cn('h-5 w-5 shrink-0')} />}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tab.label}</span>
              </div>
              {tab.description && (
                <p
                  className={cn(
                    'mt-0.5 truncate text-xs',
                    isSelected && !isMobile
                      ? 'text-primary-foreground/80'
                      : 'text-muted-foreground',
                  )}
                >
                  {tab.description}
                </p>
              )}
            </div>
            {tab.count !== undefined && tab.count > 0 && (
              <Badge
                variant={isSelected && !isMobile ? 'secondary' : 'outline'}
                className={cn(
                  'justify-center px-1.5',
                  orientation === 'vertical' ? 'h-5 text-xs' : 'h-4 text-[10px]',
                )}
              >
                {tab.count}
              </Badge>
            )}
            {isMobile && (
              <div className="text-muted-foreground">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 15 15"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                >
                  <path
                    d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.6498 10.6151 7.84212L6.86514 11.8421C6.67627 12.0436 6.35985 12.0538 6.1584 11.8649C5.95694 11.676 5.94673 11.3596 6.1356 11.1581L9.5915 7.50002L6.1356 3.84194C5.94673 3.64048 5.95694 3.32406 6.1584 3.13508Z"
                    fill="currentColor"
                    fillRule="evenodd"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );

  if (isMobile) {
    if (isMobileDetailOpen) {
      return (
        <div
          ref={containerRef}
          className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', className)}
        >
          <div className="bg-muted/30 flex shrink-0 items-center gap-2 border-b p-3">
            <button
              type="button"
              onClick={() => setIsMobileDetailOpen(false)}
              className="focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground -ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:ring-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
              >
                <path
                  d="M8.84182 3.13514C9.04327 3.32401 9.05348 3.64042 8.86462 3.84188L5.43521 7.49991L8.86462 11.1579C9.05348 11.3594 9.04327 11.6758 8.84182 11.8647C8.64036 12.0535 8.32394 12.0433 8.13508 11.8419L4.38508 7.84188C4.20477 7.64955 4.20477 7.35027 4.38508 7.15794L8.13508 3.15794C8.32394 2.95648 8.64036 2.94628 8.84182 3.13514Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </svg>
              <span className="sr-only">Back</span>
            </button>
            <h3 className="text-sm font-semibold">
              {tabs.find((t) => t.value === selectedTab)?.label}
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          {/* Mobile Detail Panel Overlay - if detailPanel is active (e.g. adding a device) */}
          {detailPanel && (
            <div className="bg-background absolute inset-0 z-10 flex flex-col">{detailPanel}</div>
          )}
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', className)}
      >
        <div className="w-full shrink-0">
          {(title || header) && (
            <div className="border-b p-3">
              {title && <h3 className="text-sm font-semibold">{title}</h3>}
              {header}
            </div>
          )}
          {controls && <div className="border-b p-2">{controls}</div>}
        </div>
        <ScrollArea className="min-h-0 flex-1">{renderTabs('vertical')}</ScrollArea>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('h-full min-h-0 w-full overflow-hidden rounded-lg border', className)}
    >
      <ResizablePanelGroup orientation="horizontal" className="flex h-full min-h-0">
        <ResizablePanel
          defaultSize={toPanelSize(sidebarSize)}
          minSize={toPanelSize(sidebarMinSize)}
          maxSize={toPanelSize(sidebarMaxSize)}
        >
          <div className="bg-muted/30 flex h-full min-h-0 flex-col">
            {(title || header) && (
              <div className="shrink-0 border-b p-3">
                {title && <h3 className="text-sm font-semibold">{title}</h3>}
                {header}
              </div>
            )}
            {controls && <div className="shrink-0 border-b p-2">{controls}</div>}
            <ScrollArea className="min-h-0 flex-1">{renderTabs('vertical')}</ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Content Panel */}
        <ResizablePanel
          defaultSize={toPanelSize(contentSize)}
          minSize={toPanelSize(contentMinSize)}
        >
          <div className="h-full min-h-0">{children}</div>
        </ResizablePanel>

        {detailPanel && (
          <>
            <ResizableHandle />
            <ResizablePanel
              defaultSize={toPanelSize(detailSize)}
              minSize={toPanelSize(detailMinSize)}
              maxSize={toPanelSize(detailMaxSize)}
            >
              <div className="h-full min-h-0">{detailPanel}</div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
