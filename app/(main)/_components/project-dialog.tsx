'use client';

import * as React from 'react';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { mutate } from 'swr';
import z from 'zod';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { Code2Icon } from 'lucide-react';

import {
  createProject,
  ProjectRenamePartialFailureError,
  updateProject,
} from '@/app/(main)/_lib/projects';
import type { CreateProjectBody, Project, UpdateProjectBody } from '@/app/(main)/_lib/projects.d';
import { fromYaml, toYaml } from '@/app/(main)/_lib/yaml';
import ProjectsContext from '@/app/(main)/_context/projects';
import GeneralConfiguration from '@/app/(main)/_components/general-configuration';

import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Button } from 'ui-web/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'ui-web/components/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'ui-web/components/form';
import { Input } from 'ui-web/components/input';
import { Spinner } from 'ui-web/components/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'ui-web/components/tabs';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required'),
  description: z.string().optional(),
});

type ProjectFormValues = z.infer<typeof formSchema>;

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  project?: Project | null;
}

const COPY = {
  create: {
    title: 'Create Project',
    description: 'Create a new project with optional initial configuration.',
    submitLabel: 'Create Project',
    submittingLabel: 'Creating...',
    errorTitle: 'Project creation failed',
    successButtonDisabledWithoutProject: false,
  },
  edit: {
    title: 'Edit Project',
    description: 'Update the selected project and its optional configuration.',
    submitLabel: 'Save Changes',
    submittingLabel: 'Saving...',
    errorTitle: 'Project update failed',
    successButtonDisabledWithoutProject: true,
  },
} as const;

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function ProjectDialog({ open, onOpenChange, mode, project }: ProjectDialogProps) {
  const { setProject } = use(ProjectsContext);
  const { resolvedTheme } = useTheme();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentTab, setCurrentTab] = useState('properties');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const submitAbortControllerRef = React.useRef<AbortController | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const copy = COPY[mode];
  const projectName = form.watch('name');
  const isFormValid = useMemo(() => {
    if (isSubmitting) return false;
    if (copy.successButtonDisabledWithoutProject && !project) return false;
    if (yamlError) return false;
    return projectName.trim().length > 0;
  }, [copy.successButtonDisabledWithoutProject, isSubmitting, project, projectName, yamlError]);

  useEffect(() => {
    if (projectName.trim().length > 0 && form.formState.errors.name) {
      form.clearErrors('name');
    }
  }, [form, form.formState.errors.name, projectName]);

  const resetForm = useCallback(() => {
    form.reset({
      name: mode === 'edit' ? (project?.name ?? '') : '',
      description: mode === 'edit' ? (project?.description ?? '') : '',
    });
    setConfig(mode === 'edit' ? { ...(project?.config ?? {}) } : {});
    setCurrentTab('properties');
    setSubmitError(null);
    setShowYamlEditor(false);
    setYamlContent('');
    setYamlError(null);
  }, [form, mode, project]);

  useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, resetForm]);

  useEffect(
    () => () => {
      submitAbortControllerRef.current?.abort();
      submitAbortControllerRef.current = null;
    },
    [],
  );

  const buildPayload = useCallback(() => {
    const values = form.getValues();
    const payload: Record<string, unknown> = {
      name: values.name.trim(),
      config,
    };

    const description = values.description?.trim();
    if (description) {
      payload.description = description;
    }

    return payload;
  }, [config, form]);

  const generateYamlContent = useCallback(() => {
    return toYaml(buildPayload());
  }, [buildPayload]);

  const toggleYamlEditor = useCallback(() => {
    if (!showYamlEditor) {
      setYamlContent(generateYamlContent());
      setYamlError(null);
    }
    setShowYamlEditor((current) => !current);
  }, [generateYamlContent, showYamlEditor]);

  const handleYamlChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      setYamlContent(value);
      setYamlError(null);

      try {
        const parsed = fromYaml(value);

        form.setValue('name', typeof parsed.name === 'string' ? parsed.name : '', {
          shouldValidate: true,
        });
        form.setValue(
          'description',
          typeof parsed.description === 'string' ? parsed.description : '',
        );

        const parsedConfig =
          parsed.config && typeof parsed.config === 'object'
            ? Object.fromEntries(
                Object.entries(parsed.config as Record<string, unknown>).flatMap(
                  ([key, rawValue]) =>
                    rawValue === undefined || rawValue === null ? [] : [[key, String(rawValue)]],
                ),
              )
            : {};
        setConfig(parsedConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid YAML syntax';
        setYamlError(message);
      }
    },
    [form],
  );

  const handleCreate = async (values: ProjectFormValues, signal?: AbortSignal) => {
    const payload: CreateProjectBody = {
      name: values.name.trim(),
    };

    const description = values.description?.trim();
    if (description) {
      payload.description = description;
    }

    if (Object.keys(config).length > 0) {
      payload.config = config;
    }

    const result = await createProject(payload, signal);
    if (result.error) {
      if (result.error === 'Request was cancelled.') {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      throw new Error(result.error);
    }

    const seededProject: Project = {
      name: payload.name,
      description: payload.description,
      config: payload.config ?? {},
    };

    mutate(`/1.0/projects/${payload.name}`, seededProject, {
      revalidate: false,
    });
    await mutate('/1.0/projects?recursion=1');
    setProject(payload.name);
  };

  const handleEdit = async (values: ProjectFormValues, signal?: AbortSignal) => {
    if (!project) {
      throw new Error('No project selected for editing.');
    }

    const payload: UpdateProjectBody = {
      currentName: project.name,
      name: values.name.trim(),
      description: values.description?.trim(),
      config,
    };

    const result = await updateProject(payload, signal);
    const nextName = result.project.name;

    if (result.renamedFrom) {
      mutate(`/1.0/projects/${result.renamedFrom}`, undefined, {
        revalidate: false,
      });
    }

    mutate(`/1.0/projects/${nextName}`, result.project, {
      revalidate: false,
    });
    await mutate('/1.0/projects?recursion=1');
    setProject(nextName);
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    const valid = await form.trigger();
    if (!valid) return;

    const values = form.getValues();
    submitAbortControllerRef.current?.abort();
    const controller = new AbortController();
    submitAbortControllerRef.current = controller;

    setIsSubmitting(true);
    try {
      if (mode === 'create') {
        await handleCreate(values, controller.signal);
      } else {
        await handleEdit(values, controller.signal);
      }

      onOpenChange(false);
    } catch (error) {
      if (error instanceof ProjectRenamePartialFailureError && project) {
        mutate(`/1.0/projects/${project.name}`, error.project, {
          revalidate: false,
        });
        await mutate('/1.0/projects?recursion=1');
        setProject(project.name);
      }
      if (!isAbortError(error)) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to save project');
      }
    } finally {
      if (submitAbortControllerRef.current === controller) {
        submitAbortControllerRef.current = null;
      }
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          submitAbortControllerRef.current?.abort();
          submitAbortControllerRef.current = null;
          onOpenChange(false);
          return;
        }
        if (!isSubmitting) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent
        className={`flex min-h-0 flex-col overflow-hidden ${
          showYamlEditor || currentTab === 'configuration'
            ? 'h-[90vh] max-h-[90vh] sm:max-w-5xl'
            : 'max-h-[32rem] sm:max-w-4xl'
        }`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInputRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="select-none">{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit();
            }}
          >
            {submitError ? (
              <Alert variant="destructive" className="mb-4 shrink-0">
                <AlertTitle>{copy.errorTitle}</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div
                className={`flex min-h-0 flex-1 flex-col ${
                  showYamlEditor ? '' : 'absolute inset-0 pointer-events-none invisible'
                }`}
                aria-hidden={!showYamlEditor}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-muted-foreground text-sm">
                    Edit the raw YAML configuration. Changes will be synced with the form.
                  </p>
                </div>
                {yamlError ? <p className="text-destructive mb-2 text-sm">{yamlError}</p> : null}
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                  <Editor
                    height="100%"
                    defaultLanguage="yaml"
                    value={yamlContent}
                    onChange={handleYamlChange}
                    theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                    }}
                  />
                </div>
              </div>
              <Tabs
                className={`flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden ${
                  showYamlEditor ? 'absolute inset-0 pointer-events-none invisible' : ''
                }`}
                value={currentTab}
                onValueChange={setCurrentTab}
                aria-hidden={showYamlEditor}
              >
                <TabsList className="mb-4 w-full shrink-0">
                  <TabsTrigger type="button" value="properties">
                    Properties
                  </TabsTrigger>
                  <TabsTrigger type="button" value="configuration">
                    Configuration
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value="properties"
                  className="mt-0 min-h-0 flex-1 overflow-auto px-1 pt-1 data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:min-h-0 data-[state=active]:flex-1 data-[state=active]:flex-col"
                >
                  <div className="flex flex-col gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input
                              id="project-name"
                              placeholder="my-project"
                              {...field}
                              ref={(node) => {
                                field.ref(node);
                                nameInputRef.current = node;
                              }}
                              className="h-10 px-4 leading-normal"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Input
                              id="project-description"
                              placeholder="Optional description"
                              {...field}
                              value={field.value || ''}
                              className="h-10 px-4 leading-normal"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>
                <TabsContent
                  value="configuration"
                  className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:min-h-0 data-[state=active]:flex-1 data-[state=active]:flex-col"
                >
                  <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
                    <GeneralConfiguration
                      config={config}
                      onConfigChange={setConfig}
                      configTarget="project"
                      projectMode={mode}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
              <DialogFooter className="mt-4 shrink-0 border-t pt-4">
              <Button type="button" variant="outline" onClick={toggleYamlEditor}>
                <Code2Icon className="mr-2 h-4 w-4" />
                {showYamlEditor ? 'Back to form' : 'Edit YAML'}
              </Button>
              <Button type="submit" disabled={!isFormValid}>
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    {copy.submittingLabel}
                  </>
                ) : (
                  copy.submitLabel
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
