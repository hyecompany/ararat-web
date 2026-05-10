'use client';

import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Button } from 'ui-web/components/button';
import { Progress } from 'ui-web/components/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'ui-web/components/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'ui-web/components/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'ui-web/components/tabs';
import { Input } from 'ui-web/components/input';
import { useState, useMemo, use, useCallback, useRef, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import z from 'zod';
import ImageSelector, {
  type SelectableImage,
} from '@/app/(main)/_components/image-selector';
import InstanceProperties from '@/app/(main)/instances/_components/properties';
import InstanceDevices from './devices';
import type { Device } from '@/app/(main)/instances/_lib/instances.d';
import {
  hasValidRootDisk,
  isRootDiskScaffold,
} from '@/app/(main)/_components/device-rules';
import {
  createInstance,
  importInstanceFromBackup,
} from '@/app/(main)/instances/_lib/instances';
import { toYaml, fromYaml } from '@/app/(main)/_lib/yaml';

import GeneralConfiguration from '@/app/(main)/_components/general-configuration';
import { useProfiles } from '@/app/(main)/_hooks/profiles';
import { useStoragePools } from '@/app/_incus/resources/storage-pools/hooks';
import type { StoragePool } from '@/app/_incus/types';
import ProjectsContext, {
  ALL_PROJECTS_VALUE,
} from '@/app/(main)/_context/projects';
import { useServerConfiguration } from '@/app/_hooks/server';
import { Spinner } from 'ui-web/components/spinner';
import { toast } from 'sonner';
import Editor, { OnMount } from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import type * as Monaco from 'monaco-editor';
import { AlertCircleIcon, CodeXmlIcon, UploadIcon } from 'lucide-react';
import {
  cn,
  dashboardMonacoOptions,
  dashboardMonacoTheme,
  defineDashboardMonacoThemes,
} from 'ui-web/lib/utils';

const sourceSchema = z
  .object({
    type: z.enum(['image', 'none', 'backup']),
    fingerprint: z.string().optional(),
    alias: z.string().optional(),
    server: z.string().optional(),
    mode: z.literal('pull').optional(),
    protocol: z.enum(['simplestreams', 'oci']).optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'none') {
        return true;
      }
      if (data.type === 'backup') {
        return true;
      }
      if (data.fingerprint) {
        return true;
      }
      return Boolean(data.mode && data.server && data.alias && data.protocol);
    },
    {
      message: 'Select an image to continue',
      path: ['alias'],
    },
  );

const formSchema = z.object({
  // only letters, numbers, and dashes. cannot start with digit or dash. name must not end with dash
  name: z
    .string()
    .min(3, 'Instance name must be at least 3 characters long')
    .max(50, 'Instance name must be at most 50 characters long')
    .regex(
      /^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/,
      'Instance name must start with a letter and can only contain letters, numbers, and dashes. It cannot end with a dash.',
    ),
  description: z.string().optional(),
  ephemeral: z.boolean().optional(),
  source: sourceSchema,
});
export default function CreateInstance({ className }: { className?: string }) {
  const { currentProject, effectiveProject, projects } = use(ProjectsContext);
  const { resolvedTheme } = useTheme();
  const { data: server, isLoading: isLoadingServerConfiguration } =
    useServerConfiguration();
  const {
    rows: storagePoolRows,
    status: storagePoolsStatus,
  } = useStoragePools({ include: { metadata: true } });
  const storagePools = useMemo(
    () =>
      storagePoolRows
        .map((row) => row.metadata)
        .filter((pool): pool is StoragePool => Boolean(pool)),
    [storagePoolRows],
  );
  const isLoadingStoragePools =
    storagePoolsStatus === 'missing' ||
    storagePoolsStatus === 'loading' ||
    storagePoolsStatus === 'refreshing';
  const [profilesSelected, setProfilesSelected] = useState<string[]>(['default']);
  const [instanceType, setInstanceType] = useState<'virtual-machine' | 'container'>('container');
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupFileInputKey, setBackupFileInputKey] = useState(0);
  const [backupPoolName, setBackupPoolName] = useState('');
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [yamlContent, setYamlContent] = useState<string>('');
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const resolvedTargetProject = useMemo(() => {
    if (effectiveProject) {
      return effectiveProject;
    }

    if (currentProject !== ALL_PROJECTS_VALUE) {
      return '';
    }

    const defaultProject = projects.find((project) => project.name === 'default');
    return defaultProject?.name ?? projects[0]?.name ?? '';
  }, [currentProject, effectiveProject, projects]);

  const { data: profiles } = useProfiles(undefined, {
    project: resolvedTargetProject,
  });

  // Aggregate inherited devices from profiles
  const inheritedDevices = useMemo(() => {
    if (!profiles) return {};
    const inherited: Record<string, Device> = {};
    const profileMap = new Map(profiles.map((p) => [p.name, p]));

    for (const profileName of profilesSelected) {
      const profile = profileMap.get(profileName);
      if (profile?.devices) {
        Object.entries(profile.devices).forEach(([name, device]) => {
          inherited[name] = device;
        });
      }
    }
    return inherited;
  }, [profiles, profilesSelected]);

  useEffect(() => {
    if (!profiles) return;

    setDevices((currentDevices) => {
      if (inheritedDevices.root && isRootDiskScaffold(currentDevices.root)) {
        const { root, ...rest } = currentDevices;
        return rest;
      }

      if (!inheritedDevices.root && !currentDevices.root) {
        return {
          ...currentDevices,
          root: { type: 'disk', path: '/' },
        };
      }

      return currentDevices;
    });
  }, [inheritedDevices, profiles]);

  // Correct implementation using useMemo
  const memoizedExpandedConfig = useMemo(() => {
    let result: Record<string, string> = {};
    if (!profiles || profiles.length === 0) return result;

    const profileMap = new Map(profiles.map((p) => [p.name, p]));

    for (const profileName of profilesSelected) {
      const profile = profileMap.get(profileName);
      if (profile?.config) {
        result = { ...result, ...profile.config };
      }
    }

    return result;
  }, [profiles, profilesSelected]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: undefined,
      ephemeral: undefined,
      source: {
        type: 'image',
        fingerprint: undefined,
        alias: undefined,
        server: undefined,
        mode: undefined,
        protocol: undefined,
      },
    },
  });

  const [currentTab, setCurrentTab] = useState('properties');
  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const sourceType = useWatch({
    control: form.control,
    name: 'source.type',
  });
  const isBackupMode = sourceType === 'backup';
  const selectingImage = sourceType === 'image' && currentTab === 'source';
  const [selectedImage, setSelectedImage] = useState<SelectableImage | null>(null);
  const missingBackupExtensions = useMemo(() => {
    const requiredExtensions = [
      'container_backup',
      'container_backup_override_pool',
      'backup_override_name',
    ];

    if (!server?.api_extensions) {
      return [];
    }

    return requiredExtensions.filter(
      (extension) => !server.api_extensions.includes(extension),
    );
  }, [server?.api_extensions]);
  const isBackupSupported =
    !isLoadingServerConfiguration && missingBackupExtensions.length === 0;

  const resetSourceFields = () => {
    form.setValue('source.fingerprint', undefined, { shouldDirty: true });
    form.setValue('source.mode', undefined, { shouldDirty: true });
    form.setValue('source.server', undefined, { shouldDirty: true });
    form.setValue('source.alias', undefined, { shouldDirty: true });
    form.setValue('source.protocol', undefined, { shouldDirty: true });
  };
  const resetBackupFields = () => {
    setBackupFile(null);
    setBackupFileInputKey((current) => current + 1);
    setBackupPoolName('');
    setImportProgress(null);
  };

  const handleImageSelect = (image: SelectableImage) => {
    setSelectedImage(image);
    resetSourceFields();
    if (image.local && image.fingerprint) {
      form.setValue('source.fingerprint', image.fingerprint, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } else if (image.remote) {
      form.setValue('source.mode', 'pull', { shouldDirty: true });
      form.setValue('source.server', image.remote.server, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue('source.alias', image.remote.alias, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue('source.protocol', image.remote.protocol, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    form.trigger('source');
  };

  // Check if form is valid for submission
  // Watch form changes to re-evaluate validity
  useWatch({ control: form.control });
  const rootDiskValid = useMemo(
    () =>
      isBackupMode
        ? backupPoolName.trim().length > 0
        : hasValidRootDisk(devices, inheritedDevices),
    [backupPoolName, devices, inheritedDevices, isBackupMode],
  );

  const isFormValid = useMemo(() => {
    // Check form validation state
    const formState = form.formState;
    if (!formState.isValid) return false;

    if (!resolvedTargetProject) return false;

    // Check root disk
    if (!rootDiskValid) return false;

    // Check YAML error
    if (yamlError) return false;

    if (isBackupMode) {
      if (!backupFile) return false;
      if (!backupPoolName.trim()) return false;
      if (isLoadingServerConfiguration) return false;
      if (!isBackupSupported) return false;
    }

    return true;
  }, [
    backupFile,
    backupPoolName,
    form.formState,
    isBackupMode,
    isBackupSupported,
    resolvedTargetProject,
    rootDiskValid,
    yamlError,
    isLoadingServerConfiguration,
  ]);

  // Build the instance payload
  const buildPayload = useCallback(() => {
    const values = form.getValues();
    const source: Record<string, unknown> = { type: values.source.type };

    if (values.source.type === 'image') {
      if (values.source.fingerprint) {
        source.fingerprint = values.source.fingerprint;
      } else if (values.source.alias) {
        source.alias = values.source.alias;
        source.server = values.source.server;
        source.mode = values.source.mode;
        source.protocol = values.source.protocol;
      }
    }

    const payload: Record<string, unknown> = {
      name: values.name,
      type: instanceType,
      profiles: profilesSelected,
      source,
      devices,
    };

    if (values.description) {
      payload.description = values.description;
    }

    if (values.ephemeral !== undefined) {
      payload.ephemeral = values.ephemeral;
    }

    if (Object.keys(config).length > 0) {
      payload.config = config;
    }

    return payload;
  }, [form, instanceType, profilesSelected, devices, config]);

  // Generate YAML only when opening the YAML editor
  const generateYamlContent = useCallback(() => {
    const payload = buildPayload();
    return toYaml(payload);
  }, [buildPayload]);

  // Handle tab change (for main tabs, not YAML)
  const handleTabChange = useCallback((tab: string) => {
    setCurrentTab(tab);
  }, []);

  // Toggle YAML editor visibility
  const toggleYamlEditor = useCallback(() => {
    if (!showYamlEditor) {
      // Opening YAML editor - generate fresh content
      setYamlContent(generateYamlContent());
      setYamlError(null);
    }
    setShowYamlEditor(!showYamlEditor);
  }, [showYamlEditor, generateYamlContent]);

  const getDialogContentClassName = useCallback(() => {
    return cn(
      'flex max-h-[90vh] w-full flex-col transition-all duration-200',
      isBackupMode
        ? 'sm:max-w-xl'
        : selectingImage
        ? 'h-[90vh] sm:max-w-5xl'
        : currentTab === 'devices' || currentTab === 'general' || showYamlEditor
          ? 'h-[90vh] sm:max-w-6xl'
          : 'sm:max-w-xl',
    );
  }, [currentTab, isBackupMode, selectingImage, showYamlEditor]);

  // Handle Monaco editor mount
  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  // Handle YAML changes - updates form state from editor changes
  const handleYamlChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      setYamlContent(value);
      setYamlError(null);

      try {
        const parsed = fromYaml(value);

        // Update form values from YAML
        if (typeof parsed.name === 'string') {
          form.setValue('name', parsed.name, { shouldValidate: true });
        }
        if (typeof parsed.description === 'string') {
          form.setValue('description', parsed.description);
        }
        if (typeof parsed.ephemeral === 'boolean') {
          form.setValue('ephemeral', parsed.ephemeral);
        }
        if (parsed.type === 'container' || parsed.type === 'virtual-machine') {
          setInstanceType(parsed.type);
        }
        if (Array.isArray(parsed.profiles)) {
          setProfilesSelected(parsed.profiles as string[]);
        }
        if (parsed.devices && typeof parsed.devices === 'object') {
          setDevices(parsed.devices as Record<string, Device>);
        }
        if (parsed.config && typeof parsed.config === 'object') {
          setConfig(parsed.config as Record<string, string>);
        }
        if (parsed.source && typeof parsed.source === 'object') {
          const source = parsed.source as Record<string, unknown>;
          if (
            source.type === 'none' ||
            source.type === 'image' ||
            source.type === 'backup'
          ) {
            form.setValue('source.type', source.type, { shouldValidate: true });
            if (source.type === 'backup') {
              setShowYamlEditor(false);
            }
            if (source.type === 'image') {
              if (typeof source.fingerprint === 'string') {
                form.setValue('source.fingerprint', source.fingerprint, {
                  shouldValidate: true,
                });
              }
              if (typeof source.alias === 'string') {
                form.setValue('source.alias', source.alias, {
                  shouldValidate: true,
                });
              }
              if (typeof source.server === 'string') {
                form.setValue('source.server', source.server);
              }
              if (source.mode === 'pull') {
                form.setValue('source.mode', source.mode);
              }
              if (source.protocol === 'simplestreams' || source.protocol === 'oci') {
                form.setValue('source.protocol', source.protocol);
              }
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid YAML syntax';
        setYamlError(message);
        console.error('YAML parsing error:', error);
      }
    },
    [form, setInstanceType, setProfilesSelected, setDevices, setConfig],
  );

  // Handle form submission
  const handleSubmit = async () => {
    const valid = await form.trigger();
    if (!valid) {
      toast.error('Please fix the form errors before submitting');
      return;
    }

    if (!resolvedTargetProject) {
      toast.error('Select a target project before creating or importing an instance');
      return;
    }

    if (isBackupMode) {
      if (!backupFile) {
        toast.error('Select a backup archive to continue');
        return;
      }

      if (!backupPoolName.trim()) {
        toast.error('Select a storage pool to continue');
        return;
      }

      if (isLoadingServerConfiguration) {
        toast.error('Checking server backup import support');
        return;
      }

      if (!isBackupSupported) {
        toast.error('Backup import is not supported by this server');
        return;
      }
    }

    const selectedBackupFile = backupFile;

    if (!rootDiskValid) {
      toast.error(
        isBackupMode
          ? 'A target storage pool is required'
          : 'A valid root disk with a storage pool is required',
      );
      if (!isBackupMode) {
        setCurrentTab('devices');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const result = isBackupMode
        ? await importInstanceFromBackup(selectedBackupFile as File, {
            name: form.getValues().name,
            pool: backupPoolName,
            project: resolvedTargetProject,
            onProgress: setImportProgress,
          })
        : await createInstance(buildPayload(), resolvedTargetProject);

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(
          isBackupMode
            ? `Backup import for "${form.getValues().name}" started`
            : `Instance "${form.getValues().name}" creation started`,
        );
        setDialogOpen(false);
        // Reset form
        form.reset();
        setDevices({});
        setConfig({});
        setSelectedImage(null);
        resetBackupFields();
        setProfilesSelected(['default']);
        setInstanceType('container');
        setYamlContent('');
        setCurrentTab('properties');
        setYamlError(null);
        setShowYamlEditor(false);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isBackupMode
            ? 'Failed to import backup archive'
            : 'Failed to create instance',
      );
    } finally {
      setIsSubmitting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className={className}>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!isSubmitting) {
            if (!open) {
              resetBackupFields();
            }
            setDialogOpen(open);
          }
        }}
      >
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <DialogTrigger asChild>
              <Button className={className} onClick={() => setDialogOpen(true)}>
                Create Instance
              </Button>
            </DialogTrigger>
            <DialogContent className={getDialogContentClassName()}>
              <DialogHeader className="shrink-0">
                <DialogTitle>Create Instance</DialogTitle>
                <DialogDescription>Create a new instance</DialogDescription>
              </DialogHeader>
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <div
                  className={`flex min-h-0 flex-1 flex-col ${
                    showYamlEditor ? '' : 'absolute inset-0 pointer-events-none invisible'
                  }`}
                  aria-hidden={!showYamlEditor}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-muted-foreground text-sm">
                      Edit the raw YAML configuration. Changes will be synced with the wizard.
                    </p>
                  </div>
                  {yamlError && <p className="text-destructive mb-2 text-sm">{yamlError}</p>}
                  <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                    <Editor
                      height="100%"
                      defaultLanguage="yaml"
                      value={yamlContent}
                      onChange={handleYamlChange}
                      beforeMount={defineDashboardMonacoThemes}
                      onMount={handleEditorMount}
                      theme={dashboardMonacoTheme(resolvedTheme)}
                      options={{
                        ...dashboardMonacoOptions,
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
                {isBackupMode ? (
                  <div
                    className={`flex min-h-0 w-full flex-1 flex-col gap-4 overflow-auto ${
                      showYamlEditor ? 'absolute inset-0 pointer-events-none invisible' : ''
                    }`}
                    aria-hidden={showYamlEditor}
                  >
                    <FormField
                      control={form.control}
                      name="source.type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Source Type</FormLabel>
                          <FormControl>
                            <Select
                              onValueChange={(value) => {
                                field.onChange(value);
                                if (value === 'backup') {
                                  setSelectedImage(null);
                                  resetSourceFields();
                                  setShowYamlEditor(false);
                                  setCurrentTab('source');
                                  return;
                                }

                                resetBackupFields();
                                if (value === 'none') {
                                  setSelectedImage(null);
                                  resetSourceFields();
                                }
                              }}
                              value={field.value}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select source type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="image">Image</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="backup">Backup Archive</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {!isLoadingServerConfiguration && !isBackupSupported ? (
                      <Alert variant="destructive">
                        <AlertCircleIcon className="size-4" />
                        <AlertTitle>Backup import is unavailable</AlertTitle>
                        <AlertDescription>
                          This server is missing the required Incus API extensions:{' '}
                          {missingBackupExtensions.join(', ')}.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Instance Name</FormLabel>
                          <FormControl>
                            <Input placeholder="my-instance" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-2">
                      <FormLabel htmlFor="backup-file">Backup Archive</FormLabel>
                      <Input
                        key={backupFileInputKey}
                        id="backup-file"
                        type="file"
                        accept=".tar.gz,.tgz,.tar,.tar.xz,.tar.zst,.tar.bz2,application/gzip,application/x-gzip,application/x-tar"
                        onChange={(event) => {
                          setBackupFile(event.target.files?.[0] ?? null);
                        }}
                      />
                      <p className="text-muted-foreground text-sm">
                        Upload an exported backup archive to restore it as a new
                        instance.
                      </p>
                      {backupFile ? (
                        <p className="text-sm font-medium">{backupFile.name}</p>
                      ) : null}
                      {isSubmitting && backupFile ? (
                        <div className="mt-2 grid gap-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              Uploading backup archive
                            </span>
                            <span className="font-medium">
                              {importProgress !== null ? `${importProgress}%` : 'Starting...'}
                            </span>
                          </div>
                          <Progress value={importProgress ?? 0} />
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <FormLabel>Root Storage Pool</FormLabel>
                      <Select
                        value={backupPoolName}
                        onValueChange={setBackupPoolName}
                        disabled={isLoadingStoragePools || !storagePools?.length}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={
                              isLoadingStoragePools
                                ? 'Loading storage pools...'
                                : 'Select a storage pool'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {storagePools?.map((pool) => (
                            <SelectItem key={pool.name} value={pool.name}>
                              {pool.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-muted-foreground text-sm">
                        Choose the target pool for the restored instance root disk.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Tabs
                    className={`flex min-h-0 w-full flex-1 flex-col ${
                      showYamlEditor ? 'absolute inset-0 pointer-events-none invisible' : ''
                    }`}
                    value={currentTab}
                    onValueChange={handleTabChange}
                    aria-hidden={showYamlEditor}
                  >
                    <TabsList className="w-full shrink-0" defaultValue="properties">
                      <TabsTrigger type="button" value="properties">
                        Properties
                      </TabsTrigger>
                      <TabsTrigger type="button" value="source">
                        Source
                      </TabsTrigger>
                      <TabsTrigger type="button" value="devices">
                        Devices
                      </TabsTrigger>
                      <TabsTrigger type="button" value="general">
                        Configuration
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent
                      value="properties"
                      className="mt-0 min-h-0 flex-1 overflow-auto px-1 data-[state=active]:flex data-[state=active]:flex-col"
                    >
                      <InstanceProperties
                        form={form}
                        profilesSelected={profilesSelected}
                        setProfilesSelected={setProfilesSelected}
                        instanceType={instanceType}
                        setInstanceType={setInstanceType}
                        project={resolvedTargetProject}
                      />
                    </TabsContent>
                    <TabsContent
                      value="source"
                      className={cn(
                        'mt-0 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col',
                        selectingImage ? 'overflow-hidden' : 'overflow-auto',
                      )}
                    >
                      <FormField
                        control={form.control}
                        name="source.type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Source Type</FormLabel>
                            <FormControl>
                              <Select
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  if (value === 'none') {
                                    setSelectedImage(null);
                                    resetSourceFields();
                                    resetBackupFields();
                                  } else if (value === 'backup') {
                                    setSelectedImage(null);
                                    resetSourceFields();
                                    setShowYamlEditor(false);
                                    setCurrentTab('source');
                                  } else {
                                    resetBackupFields();
                                  }
                                }}
                                value={field.value}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select source type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="image">Image</SelectItem>
                                  <SelectItem value="none">None</SelectItem>
                                  <SelectItem value="backup">Backup Archive</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {selectingImage ? (
                        <ImageSelector
                          selectedImage={selectedImage}
                          onSelect={handleImageSelect}
                          instanceType={instanceType}
                        />
                      ) : null}
                    </TabsContent>
                    <TabsContent
                      value="devices"
                      className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
                    >
                      <InstanceDevices
                        profiles={profilesSelected}
                        devices={devices}
                        onDevicesChange={setDevices}
                        instanceType={instanceType}
                        project={resolvedTargetProject}
                      />
                    </TabsContent>
                    <TabsContent
                      value="general"
                      className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
                    >
                      <div className="min-h-0 min-w-0 flex-1">
                        <GeneralConfiguration
                          config={config}
                          expandedConfig={memoizedExpandedConfig}
                          onConfigChange={setConfig}
                          instanceType={instanceType}
                        />
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </div>
              <DialogFooter className="shrink-0">
                <div className="flex w-full items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={toggleYamlEditor}
                    disabled={isBackupMode}
                  >
                    <CodeXmlIcon className="mr-2 size-4" />
                    {showYamlEditor ? 'Back to Wizard' : 'Edit YAML'}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!isFormValid || isSubmitting}
                    onClick={handleSubmit}
                  >
                    {isSubmitting ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" />
                        {isBackupMode ? 'Importing...' : 'Creating...'}
                      </>
                    ) : (
                      <>
                        {isBackupMode ? <UploadIcon className="mr-2 size-4" /> : null}
                        {isBackupMode ? 'Import Backup' : 'Create Instance'}
                      </>
                    )}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </form>
        </Form>
      </Dialog>
    </div>
  );
}
