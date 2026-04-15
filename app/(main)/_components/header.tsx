'use client';

import { Separator } from 'ui-web/components/separator';
import { SidebarTrigger } from 'ui-web/components/sidebar';
import { CheckIcon, ChevronDownIcon, GlobeIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { use, useMemo, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'ui-web/components/dropdown-menu';
import { Button } from 'ui-web/components/button';
import ProjectsContext from '@/app/(main)/_context/projects';
import ProjectDialog from '@/app/(main)/_components/project-dialog';
import { ALL_PROJECTS_VALUE } from '@/app/(main)/_context/projects';

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const { projects, currentProject, setProject, isLoading } = use(ProjectsContext);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const currentProjectLabel = useMemo(
    () => (currentProject === 'all' ? 'All Projects' : currentProject),
    [currentProject],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.name === currentProject) ?? null,
    [currentProject, projects],
  );
  const currentProjectIcon =
    currentProject === 'all' ? <GlobeIcon className="size-4 shrink-0" /> : null;

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />

        {children}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="min-w-48 justify-between gap-2"
                disabled={isLoading}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {currentProjectIcon}
                  <span className="truncate">{currentProjectLabel}</span>
                </span>
                <ChevronDownIcon className="size-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Projects</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className="select-none" onClick={() => setProject('all')}>
                  <GlobeIcon className="size-4" />
                  <span>All Projects</span>
                  {currentProject === 'all' ? <CheckIcon className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
                {projects.map((project) => (
                  <DropdownMenuItem key={project.name} onClick={() => setProject(project.name)}>
                    <span>{project.name}</span>
                    {currentProject === project.name ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              {currentProject !== ALL_PROJECTS_VALUE ? (
                <DropdownMenuItem onSelect={() => setIsEditProjectOpen(true)}>
                  <PencilIcon className="size-4" />
                  <span>Edit Project</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setIsCreateProjectOpen(true)}>
                <PlusIcon className="size-4" />
                <span>Create Project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ProjectDialog
            open={isCreateProjectOpen}
            onOpenChange={setIsCreateProjectOpen}
            mode="create"
          />
          <ProjectDialog
            open={isEditProjectOpen}
            onOpenChange={setIsEditProjectOpen}
            mode="edit"
            project={selectedProject}
          />
        </div>
      </div>
    </header>
  );
}
