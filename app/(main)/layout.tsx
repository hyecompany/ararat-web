import AppSidebar from '@/app/(main)/sidebar';
import { ProjectsProvider } from '@/app/(main)/_context/projects';
import { UserProvider } from '@/app/(main)/_context/user';
import { SidebarInset, SidebarProvider } from 'ui-web/components/sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const variant = 'inset';
  return (
    <UserProvider>
      <SidebarProvider
        defaultOpen={false}
        style={
          {
            '--sidebar-width': 'calc(var(--spacing) * 72)',
            '--header-height': 'calc(var(--spacing) * 12)',
          } as React.CSSProperties
        }
      >
        <AppSidebar variant={variant} />
        {variant != 'inset' ? (
          <>
            <div className="w-full h-full">
              <div className="flex flex-1 flex-col">
                <div className="@container/main flex flex-1 flex-col gap-2">
                  {children}
                </div>
              </div>
            </div>
          </>
        ) : (
          <SidebarInset className="min-h-0 overflow-hidden">
            <ProjectsProvider>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
            </ProjectsProvider>
          </SidebarInset>
        )}
      </SidebarProvider>
    </UserProvider>
  );
}
