"use client";
import { Separator } from "@/app/_components/ui/separator";
import { SidebarTrigger } from "@/app/_components/ui/sidebar";
import { GlobeIcon, PencilIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../_components/ui/select";
import { use, useState } from "react";
import ProjectsContext from "@/app/(main)/_context/projects";
import { Button } from "@/app/_components/ui/button";
import EditProject from "./editProject";
import { ALL_PROJECTS_VALUE } from "@/app/(main)/_context/projects";

export function SiteHeader() {
  const { projects, currentProject, setProject, isLoading } =
    use(ProjectsContext);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const canEditCurrentProject =
    !isLoading && currentProject !== ALL_PROJECTS_VALUE;

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />

        <h1 className="text-base font-medium">Instances</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={currentProject}
            onValueChange={setProject}
            disabled={isLoading}
          >
            <SelectTrigger size="sm" className="min-w-48 justify-between">
              <SelectValue placeholder="Select Project" />
            </SelectTrigger>
            <SelectContent className="max-h-96">
              <SelectItem value="all">
                <div className="flex items-center gap-2">
                  <GlobeIcon className="size-4" />
                  <span>All Projects</span>
                </div>
              </SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Projects</SelectLabel>
                {!isLoading
                  ? projects.map((project) => (
                      <SelectItem key={project.name} value={project.name}>
                        {project.name}
                      </SelectItem>
                    ))
                  : null}
              </SelectGroup>
            </SelectContent>
          </Select>
          {canEditCurrentProject && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditDialogOpen(true)}
              aria-label={`Edit project ${currentProject}`}
            >
              <PencilIcon className="size-4" />
              <span className="ml-2">Edit Project</span>
            </Button>
          )}
        </div>
      </div>
      {currentProject !== ALL_PROJECTS_VALUE && (
        <EditProject
          projectName={currentProject}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
        />
      )}
    </header>
  );
}
