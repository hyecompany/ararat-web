'use client';

import {
  createContext,
  useEffect,
  useCallback,
  useMemo,
  useState,
  use,
} from 'react';
import type { ReactNode } from 'react';
import { useProjects } from '@/app/(main)/_hooks/projects';
import type { Project } from '@/app/(main)/_lib/projects.d';
import IsClientContext from '@/app/_context/isClient';
import { IncusProjectScopeSync } from '@/app/_incus/provider';
import type { ResourceStatus } from '@/app/_incus/types';

export const ALL_PROJECTS_VALUE = 'all';
const STORAGE_KEY = 'ararat-selected-project';

interface ProjectsContextValue {
  projects: Project[];
  currentProject: string;
  effectiveProject: string | null;
  setProject: (projectName: string) => void;
  status: ResourceStatus;
  isLoading: boolean;
  isStale: boolean;
  isRefreshing: boolean;
  error: Error | null;
}

const ProjectsContext = createContext<ProjectsContextValue>({
  projects: [],
  currentProject: ALL_PROJECTS_VALUE,
  effectiveProject: null,
  setProject: () => {},
  status: 'loading',
  isLoading: true,
  isStale: false,
  isRefreshing: false,
  error: null,
});
export default ProjectsContext;
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const isClient = use(IsClientContext);
  const { data, status, isLoading, isStale, isRefreshing, error } =
    useProjects();
  const [storedProject, setStoredProject] = useState<string>(() => {
    if (typeof window === 'undefined') return ALL_PROJECTS_VALUE;
    return window.localStorage.getItem(STORAGE_KEY) ?? ALL_PROJECTS_VALUE;
  });

  const currentProject = useMemo(() => {
    if (
      storedProject === ALL_PROJECTS_VALUE ||
      data?.some((project) => project.name === storedProject)
    ) {
      return storedProject;
    }
    return data?.[0]?.name ?? ALL_PROJECTS_VALUE;
  }, [data, storedProject]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, currentProject);
  }, [currentProject]);

  const setProject = useCallback((projectName: string) => {
    setStoredProject(projectName);
  }, []);

  const value = useMemo(() => {
    const effectiveProject =
      currentProject === ALL_PROJECTS_VALUE ? null : currentProject;
    return {
      projects: data ?? [],
      currentProject,
      effectiveProject,
      setProject,
      status: !isClient ? 'loading' : status,
      isLoading: !isClient || isLoading,
      isStale,
      isRefreshing,
      error: error ?? null,
    };
  }, [
    currentProject,
    data,
    error,
    isLoading,
    isRefreshing,
    isStale,
    status,
    setProject,
    isClient,
  ]);

  return (
    <ProjectsContext value={value}>
      <IncusProjectScopeSync project={currentProject} />
      {children}
    </ProjectsContext>
  );
}
