"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { use, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import ImageSelector, { SelectableImage } from "./imageSelector";
import { ConfigurableOptionsContext } from "@/components/context/server";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useProfiles } from "@/lib/swr/incus/profiles";
import { ProjectsContext } from "@/components/context/projects";
import { Spinner } from "@/components/ui/spinner";
import { InfoIcon, Pencil, Trash2 } from "lucide-react";

type DeviceCategoryId = "disk" | "network" | "gpu" | "proxy" | "other";
type DeviceDialogType = "disk" | "network" | "gpu" | "proxy" | "custom";
type DeviceEntry = {
  name: string;
  config: Record<string, string>;
  sources: string[];
  origin: "profile" | "instance";
  overridden?: boolean;
  inheritedConfig?: Record<string, string>;
};
type CategorizedDevices = Record<DeviceCategoryId, DeviceEntry[]>;

const DEVICE_CATEGORIES: {
  id: DeviceCategoryId;
  label: string;
  attachLabel: string;
  infoText?: string;
  infoLink?: { href: string; label: string };
}[] = [
  {
    id: "disk",
    label: "Disk",
    attachLabel: "Attach disk device",
  },
  {
    id: "network",
    label: "Network",
    attachLabel: "Attach network",
  },
  {
    id: "gpu",
    label: "GPU",
    attachLabel: "Attach GPU",
    infoText:
      "GPU passthrough requires compatible hardware and host configuration.",
    infoLink: {
      href: "https://linuxcontainers.org/incus/docs/main/instances/#type-gpu",
      label: "Learn more in the Incus documentation",
    },
  },
  {
    id: "proxy",
    label: "Proxy",
    attachLabel: "New proxy device",
  },
  {
    id: "other",
    label: "Other",
    attachLabel: "Attach custom device",
  },
];

const sourceSchema = z
  .object({
    type: z.enum(["image", "none"]),
    fingerprint: z.string().optional(),
    alias: z.string().optional(),
    server: z.string().optional(),
    mode: z.literal("pull").optional(),
    protocol: z.enum(["simplestreams", "oci"]).optional(),
  })
  .refine(
    (data) => {
      if (data.type === "none") {
        return true;
      }
      if (data.fingerprint) {
        return true;
      }
      return Boolean(data.mode && data.server && data.alias && data.protocol);
    },
    {
      message: "Select an image to continue",
      path: ["alias"],
    }
  );

const deviceDefinitionSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  config: z.record(z.string(), z.string()),
});
type DeviceFormValue = z.infer<typeof deviceDefinitionSchema>;

const configOverrideSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.string().optional(),
});

const formSchema = z.object({
  // only letters, numbers, and ashes. cannot start with digit or dash. name must not end with dash
  name: z
    .string()
    .min(3, "Instance name must be at least 3 characters long")
    .max(50, "Instance name must be at most 50 characters long")
    .regex(
      /^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/,
      "Instance name must start with a letter and can only contain letters, numbers, and dashes. It cannot end with a dash."
    ),
  description: z.string().optional(),
  ephemeral: z.boolean().optional(),
  source: sourceSchema,
  profiles: z.array(z.string()).default([]).optional(),
  configOverrides: z.array(configOverrideSchema).default([]).optional(),
  devices: z.array(deviceDefinitionSchema).default([]).optional(),
});
export default function CreateInstance({ className }: { className?: string }) {
  const { currentProject } = use(ProjectsContext);
  const { data } = use(ConfigurableOptionsContext);
  const { data: profilesData, isLoading: profilesLoading } =
    useProfiles(currentProject);
  const defaultProfileName = useMemo(() => {
    if (!profilesData?.length) return null;
    const defaultProfile = profilesData.find(
      (profile) => profile.name === "default"
    );
    return defaultProfile?.name ?? profilesData[0]?.name ?? null;
  }, [profilesData]);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: undefined,
      ephemeral: undefined,
      source: {
        type: "image",
        fingerprint: undefined,
        alias: undefined,
        server: undefined,
        mode: undefined,
        protocol: undefined,
      },
      profiles: [],
      configOverrides: [],
      devices: [],
    },
  });

  const [currentTab, setCurrentTab] = useState("properties");
  const sourceType = useWatch({
    control: form.control,
    name: "source.type",
  });
  const selectingImage = sourceType === "image" && currentTab === "source";
  const [selectedImage, setSelectedImage] = useState<SelectableImage | null>(
    null
  );
  const selectedProfileNamesRaw = useWatch({
    control: form.control,
    name: "profiles",
  });
  const selectedProfileNames = useMemo(
    () => selectedProfileNamesRaw ?? [],
    [selectedProfileNamesRaw]
  );
  const configOverridesRaw = useWatch({
    control: form.control,
    name: "configOverrides",
  });
  const configOverrides = useMemo(
    () => configOverridesRaw ?? [],
    [configOverridesRaw]
  );
  const deviceDefinitionsRaw = useWatch({
    control: form.control,
    name: "devices",
  });
  const deviceDefinitions = useMemo(
    () => deviceDefinitionsRaw ?? [],
    [deviceDefinitionsRaw]
  );
  const [deviceDialog, setDeviceDialog] =
    useState<{
      type: DeviceDialogType;
      mode: "add" | "edit";
      initial?: DeviceFormValue;
      originalName?: string;
    } | null>(null);

  const handleSaveDevice = (
    device: DeviceFormValue,
    previousName?: string
  ) => {
    const current = deviceDefinitions ?? [];
    let next: DeviceFormValue[];
    if (previousName) {
      let replaced = false;
      next = current.map((entry) => {
        if (entry.name === previousName) {
          replaced = true;
          return device;
        }
        return entry;
      });
      if (!replaced) {
        next = [...next, device];
      }
    } else {
      next = [...current, device];
    }
    form.setValue("devices", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleDeleteDevice = (deviceName: string) => {
    const current = deviceDefinitions ?? [];
    const next = current.filter((device) => device.name !== deviceName);
    form.setValue("devices", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "configOverrides",
  });
  useEffect(() => {
    if (!defaultProfileName) return;
    const currentProfiles = form.getValues("profiles");
    if (!currentProfiles || currentProfiles.length === 0) {
      form.setValue("profiles", [defaultProfileName], {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [defaultProfileName, form]);
  const selectedProfiles = useMemo(() => {
    if (!profilesData?.length) return [];
    return profilesData.filter((profile) =>
      selectedProfileNames.includes(profile.name)
    );
  }, [profilesData, selectedProfileNames]);

  const inheritedConfigEntries = useMemo(() => {
    const map = new Map<
      string,
      { value: string; sources: string[] }
    >();
    selectedProfiles.forEach((profile) => {
      Object.entries(profile.config ?? {}).forEach(([key, value]) => {
        if (!value) return;
        const existing = map.get(key);
        if (existing) {
          existing.sources.push(profile.name);
        } else {
          map.set(key, { value, sources: [profile.name] });
        }
      });
    });
    return Array.from(map.entries()).map(([key, meta]) => ({
      key,
      ...meta,
    }));
  }, [selectedProfiles]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, string | undefined>();
    configOverrides.forEach((entry) => {
      if (!entry?.key) return;
      map.set(entry.key, entry.value);
    });
    return map;
  }, [configOverrides]);

  const mergedConfigEntries = useMemo(() => {
    const inherited = inheritedConfigEntries.map((entry) => ({
      key: entry.key,
      value: overrideMap.has(entry.key)
        ? overrideMap.get(entry.key)
        : entry.value,
      inheritedValue: entry.value,
      sources: entry.sources,
      overridden: overrideMap.has(entry.key),
    }));
    const customOverrides = configOverrides
      .filter((entry) => entry?.key && !inheritedConfigEntries.find((e) => e.key === entry.key))
      .map((entry) => ({
        key: entry.key,
        value: entry.value,
        inheritedValue: null,
        sources: [],
        overridden: false,
      }));
    return [...inherited, ...customOverrides];
  }, [configOverrides, inheritedConfigEntries, overrideMap]);

  const inheritedDevices = useMemo<DeviceEntry[]>(() => {
    const deviceMap = new Map<
      string,
      { config: Record<string, string>; sources: string[] }
    >();
    selectedProfiles.forEach((profile) => {
      Object.entries(profile.devices ?? {}).forEach(([deviceName, config]) => {
        const existing = deviceMap.get(deviceName);
        if (existing) {
          existing.sources.push(profile.name);
        } else {
          deviceMap.set(deviceName, {
            config,
            sources: [profile.name],
          });
        }
      });
    });
    return Array.from(deviceMap.entries()).map(([name, meta]) => ({
      name,
      ...meta,
      origin: "profile" as const,
    }));
  }, [selectedProfiles]);

  const instanceDevices = useMemo<DeviceEntry[]>(() => {
    return deviceDefinitions.map((device) => ({
      name: device.name,
      config: device.config,
      sources: [],
      origin: "instance" as const,
    }));
  }, [deviceDefinitions]);

  const categorizedDevices = useMemo<CategorizedDevices>(() => {
    const base: CategorizedDevices = {
      disk: [],
      network: [],
      gpu: [],
      proxy: [],
      other: [],
    };
    const combinedMap = new Map<string, DeviceEntry>();
    inheritedDevices.forEach((device) => {
      combinedMap.set(device.name, device);
    });
    instanceDevices.forEach((device) => {
      const inherited = combinedMap.get(device.name);
      if (inherited) {
        combinedMap.set(device.name, {
          ...device,
          inheritedConfig: inherited.config,
          sources: inherited.sources,
          overridden: true,
        });
      } else {
        combinedMap.set(device.name, device);
      }
    });
    combinedMap.forEach((device) => {
      const type = device.config?.type?.toLowerCase();
      if (type === "disk") {
        base.disk.push(device);
      } else if (type === "nic" || type === "network") {
        base.network.push(device);
      } else if (type === "gpu") {
        base.gpu.push(device);
      } else if (type === "proxy") {
        base.proxy.push(device);
      } else {
        base.other.push(device);
      }
    });
    return base;
  }, [inheritedDevices, instanceDevices]);

  const [activeDeviceCategory, setActiveDeviceCategory] =
    useState<DeviceCategoryId>("disk");
  const dialogTypeFromCategory = (
    category: DeviceCategoryId
  ): DeviceDialogType => (category === "other" ? "custom" : category);
  const dialogTypeFromDevice = (device: DeviceEntry): DeviceDialogType => {
    const type = device.config?.type?.toLowerCase();
    if (type === "disk") return "disk";
    if (type === "nic") return "network";
    if (type === "gpu") return "gpu";
    if (type === "proxy") return "proxy";
    return "custom";
  };
  const toDeviceFormValue = (device: DeviceEntry): DeviceFormValue => ({
    name: device.name,
    config: device.config,
  });
  const handleAttachClick = (category: DeviceCategoryId) => {
    setDeviceDialog({
      type: dialogTypeFromCategory(category),
      mode: "add",
    });
  };
  const handleEditDevice = (device: DeviceEntry) => {
    if (device.origin !== "instance") return;
    setDeviceDialog({
      type: dialogTypeFromDevice(device),
      mode: "edit",
      initial: toDeviceFormValue(device),
      originalName: device.name,
    });
  };
  const handleOverrideDevice = (device: DeviceEntry) => {
    const baseConfig =
      device.origin === "profile" && device.inheritedConfig
        ? device.inheritedConfig
        : device.config;
    setDeviceDialog({
      type: dialogTypeFromDevice(device),
      mode: "edit",
      initial: { name: device.name, config: baseConfig },
      originalName: device.name,
    });
  };

  const renderDeviceCategoryContent = (
    categoryId: DeviceCategoryId,
    categories: CategorizedDevices
  ) => {
    const category = DEVICE_CATEGORIES.find((entry) => entry.id === categoryId);
    if (!category) return null;
    const entries = categories[categoryId] ?? [];

    if (categoryId === "gpu") {
      return (
        <div className="space-y-4 rounded-xl border border-white/5 bg-zinc-900/30 p-6">
          <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
            <InfoIcon className="h-5 w-5 text-blue-200" />
            <div>
              <p className="font-semibold text-white">GPU passthrough</p>
              <p className="mt-1">{category.infoText}</p>
              {category.infoLink ? (
                <a
                  href={category.infoLink.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-xs text-blue-300 hover:text-blue-200"
                >
                  {category.infoLink.label}
                </a>
              ) : null}
            </div>
          </div>
          {entries.length ? (
            <DeviceCategoryTable
              entries={entries}
              onEdit={handleEditDevice}
              onDelete={(device) => handleDeleteDevice(device.name)}
              onOverride={handleOverrideDevice}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No GPU devices inherited yet.
            </p>
          )}
          <Button
            variant="outline"
            className="border-blue-500/30 text-blue-200"
            onClick={() => handleAttachClick(categoryId)}
          >
            {category.attachLabel}
          </Button>
        </div>
      );
    }

    if (categoryId === "proxy" || categoryId === "other") {
      return (
        <div className="space-y-4 rounded-xl border border-white/5 bg-zinc-900/30 p-6">
          {entries.length ? (
            <DeviceCategoryTable
              entries={entries}
              onEdit={handleEditDevice}
              onDelete={(device) => handleDeleteDevice(device.name)}
              onOverride={handleOverrideDevice}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No {category.label.toLowerCase()} devices attached yet.
            </p>
          )}
          <Button variant="outline" onClick={() => handleAttachClick(categoryId)}>
            {category.attachLabel}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4 rounded-xl border border-white/5 bg-zinc-900/30 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-lg font-semibold text-white">
              {category.label} devices
            </p>
            <p className="text-xs text-muted-foreground">
              {categoryId === "disk"
                ? "Root storage and additional disk attachments from selected profiles."
                : "Networks inherited from profiles or attached manually."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAttachClick(categoryId)}
          >
            {category.attachLabel}
          </Button>
        </div>
        {entries.length ? (
          <DeviceCategoryTable
            entries={entries}
            onEdit={handleEditDevice}
            onDelete={(device) => handleDeleteDevice(device.name)}
            onOverride={handleOverrideDevice}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No {category.label.toLowerCase()} devices inherited yet.
          </p>
        )}
      </div>
    );
  };

  const resetSourceFields = () => {
    form.setValue("source.fingerprint", undefined, { shouldDirty: true });
    form.setValue("source.mode", undefined, { shouldDirty: true });
    form.setValue("source.server", undefined, { shouldDirty: true });
    form.setValue("source.alias", undefined, { shouldDirty: true });
    form.setValue("source.protocol", undefined, { shouldDirty: true });
  };

  const handleImageSelect = (image: SelectableImage) => {
    setSelectedImage(image);
    resetSourceFields();
    if (image.local && image.fingerprint) {
      form.setValue("source.fingerprint", image.fingerprint, {
        shouldDirty: true,
        shouldValidate: true,
      });
    } else if (image.remote) {
      form.setValue("source.mode", "pull", { shouldDirty: true });
      form.setValue("source.server", image.remote.server, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue("source.alias", image.remote.alias, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue("source.protocol", image.remote.protocol, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    form.trigger("source");
  };
  return (
    <div className={className}>
      <Dialog>
        <Form {...form}>
          <form>
            <DialogTrigger asChild>
              <Button
                className={className}
                onClick={() => {
                  console.log(data);
                }}
              >
                Create Instance
              </Button>
            </DialogTrigger>
            <DialogContent
              className={`flex min-h-0 flex-col transition-all duration-200 ${
                selectingImage
                  ? "max-h-screen w-full sm:max-w-5xl"
                  : "w-full sm:max-w-4xl"
              }`}
            >
              <DialogHeader className="flex-shrink-0">
                <DialogTitle>Create Instance</DialogTitle>
                <DialogDescription>Create a new instance</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <Tabs
                  className="w-full flex flex-col flex-1 min-h-0"
                  value={currentTab}
                  onValueChange={setCurrentTab}
                >
                    <TabsList
                      className="w-full flex-shrink-0"
                      defaultValue="properties"
                    >
                      <TabsTrigger value="properties">Properties</TabsTrigger>
                      <TabsTrigger value="devices">Devices</TabsTrigger>
                      <TabsTrigger value="source">Source</TabsTrigger>
                    </TabsList>
                  <TabsContent
                    value="properties"
                    className="overflow-auto flex-1 min-h-0"
                  >
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                      <div className="space-y-6">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Instance Name</FormLabel>
                              <FormControl>
                                <Input
                                  required={true}
                                  placeholder="example-instance"
                                  {...field}
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
                              <FormLabel>Instance Description</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="My incredible instance"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="profiles"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Instance Profiles</FormLabel>
                              <FormControl>
                                <div className="space-y-2 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                                  {profilesLoading ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <Spinner className="h-4 w-4" />
                                      Loading profiles…
                                    </div>
                                  ) : profilesData?.length ? (
                                    profilesData.map((profile) => {
                                      const checked =
                                        field.value?.includes(profile.name);
                                      return (
                                        <label
                                          key={profile.name}
                                          className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-2 transition hover:border-white/10"
                                        >
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={(isChecked) => {
                                              const next = new Set(
                                                field.value ?? []
                                              );
                                              if (isChecked) {
                                                next.add(profile.name);
                                              } else {
                                                next.delete(profile.name);
                                              }
                                              field.onChange(Array.from(next));
                                            }}
                                          />
                                          <div>
                                            <p className="font-medium text-sm">
                                              {profile.name}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                              {profile.description || "No description"}
                                            </p>
                                          </div>
                                        </label>
                                      );
                                    })
                                  ) : (
                                    <p className="text-sm text-muted-foreground">
                                      No profiles available in this project.
                                    </p>
                                  )}
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-4 rounded-xl border border-white/5 bg-zinc-900/30 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-white">
                                Configuration preview
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Inherited values can be overridden by custom entries.
                              </p>
                            </div>
                            {selectedProfiles.length ? (
                              <Badge variant="outline">
                                {selectedProfiles.length} profile
                                {selectedProfiles.length === 1 ? "" : "s"} selected
                              </Badge>
                            ) : null}
                          </div>
                          {mergedConfigEntries.length ? (
                            <div className="space-y-2">
                              {mergedConfigEntries.map((entry) => (
                                <div
                                  key={entry.key}
                                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/5 bg-black/20 p-3"
                                >
                                  <div>
                                    <p className="font-mono text-sm text-white">
                                      {entry.key}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {entry.sources.length
                                        ? `Inherited from ${entry.sources.join(", ")}`
                                        : "Custom configuration"}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-mono text-sm text-white">
                                      {entry.value ?? entry.inheritedValue ?? "—"}
                                    </p>
                                    <Badge
                                      variant="outline"
                                      className={
                                        entry.overridden
                                          ? "border-amber-400/40 text-amber-200"
                                          : entry.sources.length
                                          ? "border-sky-400/40 text-sky-100"
                                          : "border-white/20 text-white"
                                      }
                                    >
                                      {entry.overridden
                                        ? "Overridden"
                                        : entry.sources.length
                                        ? "Inherited"
                                        : "Custom"}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Select a profile or add overrides to preview configuration values.
                            </p>
                          )}
                        </div>
                        <div className="space-y-3 rounded-xl border border-white/5 bg-zinc-900/30 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-white">
                                Configuration overrides
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Overrides replace inherited values or introduce new keys.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              type="button"
                              onClick={() => append({ key: "", value: "" })}
                            >
                              Add override
                            </Button>
                          </div>
                          {fields.length ? (
                            fields.map((fieldItem, index) => (
                              <div
                                key={fieldItem.id}
                                className="grid gap-3 rounded-lg border border-white/5 bg-black/20 p-3 sm:grid-cols-8"
                              >
                                <div className="sm:col-span-3">
                                  <FormField
                                    control={form.control}
                                    name={`configOverrides.${index}.key`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs uppercase text-muted-foreground">
                                          Key
                                        </FormLabel>
                                        <FormControl>
                                          <Input placeholder="limits.memory" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>
                                <div className="sm:col-span-4">
                                  <FormField
                                    control={form.control}
                                    name={`configOverrides.${index}.value`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs uppercase text-muted-foreground">
                                          Value
                                        </FormLabel>
                                        <FormControl>
                                          <Input placeholder="2GB" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>
                                <div className="flex items-end justify-end">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-red-400"
                                    onClick={() => remove(index)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No overrides defined yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent
                    value="devices"
                    className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto"
                  >
                    <div className="flex flex-1 flex-col gap-4 lg:flex-row">
                      <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-3 lg:w-56">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Devices
                        </p>
                        <div className="space-y-1">
                          {DEVICE_CATEGORIES.map((category) => {
                            const isActive = activeDeviceCategory === category.id;
                            return (
                              <button
                                key={category.id}
                                type="button"
                                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                                  isActive
                                    ? "bg-white/10 text-white"
                                    : "text-muted-foreground hover:bg-white/5"
                                }`}
                                onClick={() => setActiveDeviceCategory(category.id)}
                              >
                                {category.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex-1 space-y-6">
                        {renderDeviceCategoryContent(
                          activeDeviceCategory,
                          categorizedDevices
                        )}
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent
                    value="source"
                    className="overflow-auto flex-1 min-h-0"
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
                                if (value === "none") {
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
                      />
                    ) : null}
                  </TabsContent>
                </Tabs>
              </div>
              <DialogFooter className="flex-shrink-0">
                <Button type="submit" disabled={true}>
                  Create Instance
                </Button>
              </DialogFooter>
            </DialogContent>
          </form>
        </Form>
      </Dialog>
      {deviceDialog ? (
        <DeviceDialogRouter
          state={deviceDialog}
          onClose={() => setDeviceDialog(null)}
          onSubmit={(value) => {
            handleSaveDevice(value, deviceDialog.originalName);
            setDeviceDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DeviceCategoryTable({
  entries,
  onEdit,
  onDelete,
  onOverride,
}: {
  entries: DeviceEntry[];
  onEdit?: (device: DeviceEntry) => void;
  onDelete?: (device: DeviceEntry) => void;
  onOverride?: (device: DeviceEntry) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/5">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Configuration</span>
        <span>Inherited</span>
        <span>Override</span>
      </div>
      {entries.map((device) => (
        <div
          key={device.name}
          className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] border-t border-white/5 px-4 py-4 text-sm"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{device.name}</p>
                <p className="text-xs text-muted-foreground">
                  Type: {device.config.type ?? "custom"}
                </p>
              </div>
              {device.origin === "instance" ? (
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => onEdit?.(device)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-red-400"
                    onClick={() => onDelete?.(device)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              {Object.entries(device.config)
                .filter(([key]) => key !== "type")
                .map(([key, value]) => (
                  <div key={`${device.name}-${key}`}>
                    <p className="text-[10px] uppercase tracking-wide">
                      {key}
                    </p>
                    <p className="font-mono text-sm text-white">{value}</p>
                  </div>
                ))}
            </div>
          </div>
          <div className="text-sm">
            {device.sources.length ? (
              <>
                <p className="font-medium text-white">
                  {device.sources.join(", ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Inherited from profile
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Instance configuration</p>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {device.origin === "instance" && !device.overridden ? (
              <span>Instance defined</span>
            ) : device.overridden ? (
              <Badge variant="outline" className="border-amber-400/40 text-amber-200">
                Overridden
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOverride?.(device)}
              >
                Override
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface DeviceDialogRouterProps {
  state: {
    type: DeviceDialogType;
    mode: "add" | "edit";
    initial?: DeviceFormValue;
    originalName?: string;
  };
  onClose: () => void;
  onSubmit: (value: DeviceFormValue) => void;
}

function DeviceDialogRouter({
  state,
  onClose,
  onSubmit,
}: DeviceDialogRouterProps) {
  const commonProps = {
    open: true,
    mode: state.mode,
    initial: state.initial,
    onClose,
    onSubmit,
  };
  switch (state.type) {
    case "disk":
      return <DiskDeviceDialog {...commonProps} />;
    case "network":
      return <NetworkDeviceDialog {...commonProps} />;
    case "gpu":
      return <GpuDeviceDialog {...commonProps} />;
    case "proxy":
      return <ProxyDeviceDialog {...commonProps} />;
    case "custom":
    default:
      return <CustomDeviceDialog {...commonProps} />;
  }
}

type BaseDeviceDialogProps = {
  open: boolean;
  mode: "add" | "edit";
  initial?: DeviceFormValue;
  onClose: () => void;
  onSubmit: (value: DeviceFormValue) => void;
};

const diskDeviceSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  source: z.string().default(""),
  pool: z.string().optional(),
  path: z.string().min(1, "Mount path is required"),
  readonly: z.boolean().default(false),
  size: z.string().optional(),
  bootPriority: z.string().optional(),
});
type DiskDeviceFormValues = z.input<typeof diskDeviceSchema>;

function DiskDeviceDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: BaseDeviceDialogProps) {
  const form = useForm<DiskDeviceFormValues>({
    resolver: zodResolver(diskDeviceSchema),
    defaultValues: getDiskDefaults(initial),
  });
  useEffect(() => {
    form.reset(getDiskDefaults(initial));
  }, [initial, form]);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Attach disk device" : "Edit disk device"}
          </DialogTitle>
          <DialogDescription>
            Configure a disk device that will be attached when the instance is
            created.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              onSubmit({
                name: values.name,
                config: buildDeviceConfig({
                  type: "disk",
                  source: values.source,
                  pool: values.pool,
                  path: values.path,
                  readonly: values.readonly,
                  size: values.size,
                  "boot.priority": values.bootPriority,
                }),
              });
            })}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="root" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="/var/lib/disks/root.img" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pool"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pool</FormLabel>
                  <FormControl>
                    <Input placeholder="default" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mount path</FormLabel>
                  <FormControl>
                    <Input placeholder="/var/lib/data" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="readonly"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                    <div>
                      <FormLabel className="text-sm">Read-only</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Prevent writes to this disk
                      </p>
                    </div>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(!!checked)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="20GB" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="bootPriority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Boot priority</FormLabel>
                  <FormControl>
                    <Input placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                {mode === "add" ? "Attach disk" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const nicDeviceSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  nictype: z.enum(["bridged", "macvlan", "ovn", "physical"]),
  parent: z.string().min(1, "Parent bridge/device required"),
  hwaddr: z.string().optional(),
  nat: z.boolean().default(false),
  ipv4: z.string().min(1, "IPv4 address or auto required"),
  ipv6: z.string().min(1, "IPv6 address or auto required"),
  macFiltering: z.boolean().default(false),
});
type NicDeviceFormValues = z.input<typeof nicDeviceSchema>;

function NetworkDeviceDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: BaseDeviceDialogProps) {
  const form = useForm<NicDeviceFormValues>({
    resolver: zodResolver(nicDeviceSchema),
    defaultValues: getNicDefaults(initial),
  });
  useEffect(() => {
    form.reset(getNicDefaults(initial));
  }, [initial, form]);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Attach network interface" : "Edit network device"}
          </DialogTitle>
          <DialogDescription>
            Configure a network interface for this instance.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              onSubmit({
                name: values.name,
                config: buildDeviceConfig({
                  type: "nic",
                  nictype: values.nictype,
                  parent: values.parent,
                  hwaddr: values.hwaddr,
                  "ipv4.address": values.ipv4,
                  "ipv6.address": values.ipv6,
                  "ipv4.nat": values.nat,
                  "ipv6.nat": values.nat,
                  "security.mac_filtering": values.macFiltering,
                }),
              });
            })}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="eth0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nictype"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>NIC type</FormLabel>
                  <FormControl>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bridged">Bridged</SelectItem>
                        <SelectItem value="macvlan">MACVLAN</SelectItem>
                        <SelectItem value="ovn">OVN</SelectItem>
                        <SelectItem value="physical">Physical</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent bridge</FormLabel>
                  <FormControl>
                    <Input placeholder="incusbr0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hwaddr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>MAC address (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="00:16:3e:xx:xx:xx" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="ipv4"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IPv4 address</FormLabel>
                    <FormControl>
                      <Input placeholder="auto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ipv6"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IPv6 address</FormLabel>
                    <FormControl>
                      <Input placeholder="auto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="nat"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                    <div>
                      <FormLabel className="text-sm">Enable NAT</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Provide outbound connectivity
                      </p>
                    </div>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(!!checked)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="macFiltering"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                    <div>
                      <FormLabel className="text-sm">
                        MAC filtering
                      </FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Restrict traffic to this MAC
                      </p>
                    </div>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(!!checked)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                {mode === "add" ? "Attach network" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

interface GpuOption {
  address: string;
  vendorid: string;
  productid: string;
  description?: string;
}

const gpuDeviceSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  pci: z.string().min(1, "PCI address is required"),
  vendorid: z.string().min(1, "Vendor ID is required"),
  productid: z.string().min(1, "Product ID is required"),
  mode: z.enum(["physical", "mig"]),
  sriov: z.boolean().default(false),
});
type GpuDeviceFormValues = z.input<typeof gpuDeviceSchema>;

interface IncusGpuResource {
  pci?: {
    address?: string;
    vendor_id?: string;
    product_id?: string;
  };
  product?: { name?: string };
  vendor?: { name?: string };
}

function GpuDeviceDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: BaseDeviceDialogProps) {
  const [options, setOptions] = useState<GpuOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const form = useForm<GpuDeviceFormValues>({
    resolver: zodResolver(gpuDeviceSchema),
    defaultValues: getGpuDefaults(initial),
  });
  useEffect(() => {
    form.reset(getGpuDefaults(initial));
  }, [initial, form]);

  useEffect(() => {
    let cancelled = false;
    fetch("/1.0/resources")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const entries: GpuOption[] =
          (data?.metadata?.gpus as IncusGpuResource[] | undefined)?.map(
            (gpu) => ({
              address: gpu?.pci?.address ?? "",
              vendorid: gpu?.pci?.vendor_id ?? "",
              productid: gpu?.pci?.product_id ?? "",
              description: gpu?.product?.name ?? gpu?.vendor?.name,
            })
          ) ?? [];
        setOptions(entries.filter((option) => !!option.address));
        setOptionsError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setOptionsError("Unable to load GPU inventory.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePciChange = (value: string) => {
    form.setValue("pci", value);
    const selected = options.find((option) => option.address === value);
    if (selected) {
      form.setValue("vendorid", selected.vendorid);
      form.setValue("productid", selected.productid);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Attach GPU" : "Edit GPU device"}
          </DialogTitle>
          <DialogDescription>
            Select a GPU from the host resources or specify the PCI address
            manually.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              onSubmit({
                name: values.name,
                config: buildDeviceConfig({
                  type: "gpu",
                  pci: values.pci,
                  vendorid: values.vendorid,
                  productid: values.productid,
                  mode: values.mode,
                  "sriov.vf": values.sriov,
                }),
              });
            })}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="gpu0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>PCI device</FormLabel>
              <Select onValueChange={handlePciChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select PCI address" />
                </SelectTrigger>
                <SelectContent>
                  {loadingOptions ? (
                    <SelectItem value="loading" disabled>
                      Loading...
                    </SelectItem>
                  ) : options.length ? (
                    options.map((option) => (
                      <SelectItem key={option.address} value={option.address}>
                        {option.address}{" "}
                        {option.description ? `· ${option.description}` : ""}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>
                      {optionsError ?? "No GPUs detected"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FormItem>
            <FormField
              control={form.control}
              name="pci"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PCI address</FormLabel>
                  <FormControl>
                    <Input placeholder="0000:01:00.0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="vendorid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor ID</FormLabel>
                    <FormControl>
                      <Input placeholder="10de" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="productid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product ID</FormLabel>
                    <FormControl>
                      <Input placeholder="1b80" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mode</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="physical">Physical</SelectItem>
                        <SelectItem value="mig">MIG</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sriov"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                  <div>
                    <FormLabel className="text-sm">SR-IOV VF</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Passthrough a virtual function
                    </p>
                  </div>
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                {mode === "add" ? "Attach GPU" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const proxyDeviceSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  listen: z.string().min(1, "Listen address is required"),
  connect: z.string().min(1, "Connect address is required"),
  bind: z.enum(["host", "instance"]),
  nat: z.boolean().default(false),
});
type ProxyDeviceFormValues = z.input<typeof proxyDeviceSchema>;

function ProxyDeviceDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: BaseDeviceDialogProps) {
  const form = useForm<ProxyDeviceFormValues>({
    resolver: zodResolver(proxyDeviceSchema),
    defaultValues: getProxyDefaults(initial),
  });
  useEffect(() => {
    form.reset(getProxyDefaults(initial));
  }, [initial, form]);

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Attach proxy device" : "Edit proxy device"}
          </DialogTitle>
          <DialogDescription>
            Forward connections between host and instance addresses.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              onSubmit({
                name: values.name,
                config: buildDeviceConfig({
                  type: "proxy",
                  listen: values.listen,
                  connect: values.connect,
                  bind: values.bind,
                  nat: values.nat,
                }),
              });
            })}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="http-proxy" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="listen"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Listen address</FormLabel>
                  <FormControl>
                    <Input placeholder="tcp:0.0.0.0:8080" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="connect"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Connect address</FormLabel>
                  <FormControl>
                    <Input placeholder="tcp:127.0.0.1:80" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bind type</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="host">Host</SelectItem>
                        <SelectItem value="instance">Instance</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nat"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                  <div>
                    <FormLabel className="text-sm">Enable NAT</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Forward original source address
                    </p>
                  </div>
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                {mode === "add" ? "Attach proxy" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const customDeviceSchema = z.object({
  name: z.string().min(1, "Device name is required"),
  type: z.string().min(1, "Device type is required"),
  entries: z
    .array(
      z.object({
        key: z.string().min(1, "Key is required"),
        value: z.string().optional(),
      })
    )
    .default([]),
});
type CustomDeviceFormValues = z.input<typeof customDeviceSchema>;

function CustomDeviceDialog({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: BaseDeviceDialogProps) {
  const form = useForm<CustomDeviceFormValues>({
    resolver: zodResolver(customDeviceSchema),
    defaultValues: getCustomDefaults(initial),
  });
  useEffect(() => {
    form.reset(getCustomDefaults(initial));
  }, [initial, form]);
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "entries",
  });

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Attach custom device" : "Edit custom device"}
          </DialogTitle>
          <DialogDescription>
            Define any additional Incus device by specifying its key/value
            pairs.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              const config = buildDeviceConfig({
                type: values.type,
                ...Object.fromEntries(
                  (values.entries ?? [])
                    .filter((entry) => entry.key)
                    .map((entry) => [entry.key, entry.value ?? ""])
                ),
              });
              onSubmit({
                name: values.name,
                config,
              });
            })}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="custom0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <Input placeholder="none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">Fields</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ key: "", value: "" })}
                >
                  Add pair
                </Button>
              </div>
              {fields.length ? (
                fields.map((fieldItem, index) => (
                  <div
                    key={fieldItem.id}
                    className="grid gap-3 rounded-lg border border-white/5 bg-black/20 p-3 sm:grid-cols-[2fr_3fr_auto]"
                  >
                    <FormField
                      control={form.control}
                      name={`entries.${index}.key`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Key</FormLabel>
                          <FormControl>
                            <Input placeholder="my.key" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`entries.${index}.value`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Value</FormLabel>
                          <FormControl>
                            <Input placeholder="value" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex items-end justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-400"
                        onClick={() => remove(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No custom fields defined yet.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                {mode === "add" ? "Attach device" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function buildDeviceConfig(
  entries: Record<string, string | number | boolean | undefined>
) {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [
        key,
        typeof value === "boolean"
          ? value
            ? "true"
            : "false"
          : String(value),
      ])
  );
}

function parseBoolean(value?: string) {
  if (!value) return false;
  return ["1", "true", "on", "yes"].includes(value.toLowerCase());
}

function getDiskDefaults(initial?: DeviceFormValue): DiskDeviceFormValues {
  return {
    name: initial?.name ?? "",
    source: initial?.config?.source ?? "",
    pool: initial?.config?.pool ?? "",
    path: initial?.config?.path ?? "",
    readonly: parseBoolean(initial?.config?.readonly),
    size: initial?.config?.size ?? "",
    bootPriority: initial?.config?.["boot.priority"] ?? "",
  };
}

function getNicDefaults(initial?: DeviceFormValue): NicDeviceFormValues {
  return {
    name: initial?.name ?? "",
    nictype:
      (initial?.config?.nictype as NicDeviceFormValues["nictype"]) ??
      "bridged",
    parent: initial?.config?.parent ?? "",
    hwaddr: initial?.config?.hwaddr ?? "",
    nat:
      parseBoolean(initial?.config?.["ipv4.nat"]) ||
      parseBoolean(initial?.config?.["ipv6.nat"]),
    ipv4: initial?.config?.["ipv4.address"] ?? "auto",
    ipv6: initial?.config?.["ipv6.address"] ?? "auto",
    macFiltering: parseBoolean(initial?.config?.["security.mac_filtering"]),
  };
}

function getGpuDefaults(initial?: DeviceFormValue): GpuDeviceFormValues {
  return {
    name: initial?.name ?? "",
    pci: initial?.config?.pci ?? "",
    vendorid: initial?.config?.vendorid ?? "",
    productid: initial?.config?.productid ?? "",
    mode:
      (initial?.config?.mode as GpuDeviceFormValues["mode"]) ?? "physical",
    sriov: parseBoolean(initial?.config?.["sriov.vf"]),
  };
}

function getProxyDefaults(initial?: DeviceFormValue): ProxyDeviceFormValues {
  return {
    name: initial?.name ?? "",
    listen: initial?.config?.listen ?? "",
    connect: initial?.config?.connect ?? "",
    bind:
      (initial?.config?.bind as ProxyDeviceFormValues["bind"]) ?? "host",
    nat: parseBoolean(initial?.config?.nat),
  };
}

function getCustomDefaults(initial?: DeviceFormValue): CustomDeviceFormValues {
  const entries =
    initial?.config
      ? Object.entries(initial.config)
          .filter(([key]) => key !== "type")
          .map(([key, value]) => ({ key, value }))
      : [{ key: "", value: "" }];
  return {
    name: initial?.name ?? "",
    type: initial?.config?.type ?? "none",
    entries,
  };
}
