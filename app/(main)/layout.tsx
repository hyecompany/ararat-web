import AppSidebar from '@/app/(main)/sidebar';
import { ProjectsProvider } from '@/app/(main)/_context/projects';
import { UserProvider } from '@/app/(main)/_context/user';
import { SidebarInset, SidebarProvider } from 'ui-web/components/sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        <AppSidebar variant="inset" />
        <SidebarInset>
          <ProjectsProvider>
            {children}
          </ProjectsProvider>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  );
}
