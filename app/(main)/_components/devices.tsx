'use client';

import * as React from 'react';
import { Button } from 'ui-web/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'ui-web/components/card';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import { ScrollArea } from 'ui-web/components/scroll-area';
import { Separator } from 'ui-web/components/separator';
import { Badge } from 'ui-web/components/badge';
import { Switch } from 'ui-web/components/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
} from 'ui-web/components/combobox';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from 'ui-web/components/accordion';
import {
  IconPlus,
  IconTrash,
  IconDeviceFloppy,
  IconNetwork,
  IconDeviceGamepad2,
  IconArrowsLeftRight,
  IconArrowLeft,
  IconX,
} from '@tabler/icons-react';
import { useConfigurableOptions } from '@/app/_hooks/server';
import {
  useStoragePools,
  useStoragePoolVolumes,
} from '@/app/(main)/_hooks/storagePools';
import { useNetworks } from '@/app/(main)/_hooks/networks';
import type { Device } from '@/app/(main)/instances/_lib/instances.d';
import type { ConfigOption, DeviceTypeConfig } from '@/app/_lib/server.d';
import { UnitInput } from '@/app/(main)/_components/unit-input';
import { useResources } from '@/app/(main)/_hooks/resources';
import { VerticalTabsLayout } from '@/app/_components/layout/vertical-tabs-layout';
import { ConfigDescription, collectReferenceOptions } from '@/app/(main)/_components/config-description';
import stableStringify from 'fast-json-stable-stringify';

// Utility function to validate port specifications (Issue 3)
function validatePort(portSpec: string): boolean {
  if (!portSpec || portSpec.trim() === '') return false;

  // Split by comma for comma-separated ports
  const parts = portSpec.split(',').map((p) => p.trim());

  for (const part of parts) {
    // Check if it's a range
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((p) => parseInt(p.trim(), 10));
      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 1 ||
        end > 65535 ||
        start > end
      ) {
        return false;
      }
    } else {
      // Single port
      const port = parseInt(part, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return false;
      }
    }
  }
  return true;
}

// Parse proxy connection string - supports IPv6 (Issue 1)
function parseProxyConnection(connection: string): {
  type: string;
  address: string;
  port: string;
} {
  if (!connection) return { type: 'tcp', address: '', port: '' };

  const parts = connection.split(':');
  if (parts.length < 2) return { type: 'tcp', address: '', port: '' };

  const type = parts[0];

  if (type === 'unix') {
    // Unix socket: everything after "unix:" is the path
    return { type, address: parts.slice(1).join(':'), port: '' };
  }

  // For TCP/UDP, handle IPv6 addresses in brackets [addr]:port
  const rest = parts.slice(1).join(':');

  // Check for IPv6 format with brackets: [addr]:port
  const ipv6Match = rest.match(/^\[([^\]]+)\]:(.+)$/);
  if (ipv6Match) {
    return { type, address: ipv6Match[1], port: ipv6Match[2] };
  }

  // Check for IPv6 without port (just the address)
  if (rest.includes(':')) {
    // Likely IPv6 address without port, or IPv4:port
    const lastColon = rest.lastIndexOf(':');
    const potentialPort = rest.substring(lastColon + 1);

    // If last part looks like a port (number or range), split there
    if (/^[0-9,-]+$/.test(potentialPort)) {
      return {
        type,
        address: rest.substring(0, lastColon),
        port: potentialPort,
      };
    }

    // Otherwise treat entire rest as IPv6 address
    return { type, address: rest, port: '' };
  }

  // Simple case: type:address:port
  if (parts.length === 3) {
    return { type, address: parts[1], port: parts[2] };
  }

  // Fallback
  return { type, address: rest, port: '' };
}

// Serialize proxy connection - supports IPv6 (Issue 1)
function serializeProxyConnection(
  type: string,
  address: string,
  port: string,
): string {
  if (type === 'unix') {
    return `${type}:${address}`;
  }

  // If address contains colons (IPv6), wrap in brackets when port is present
  if (address.includes(':') && port) {
    return `${type}:[${address}]:${port}`;
  }

  return port ? `${type}:${address}:${port}` : `${type}:${address}`;
}

function singularizeDeviceTypeLabel(label: string): string {
  if (label.endsWith('ies')) {
    return label.slice(0, -3) + 'y';
  }

  if (label.endsWith('s') && !label.endsWith('ss')) {
    return label.slice(0, -1);
  }

  return label;
}

function splitCsvValue(value?: string) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

type DeviceCollectionRow = {
  id: string;
  keyName: string;
  value: string;
};

function areDeviceCollectionRowsEqual(
  currentRows: DeviceCollectionRow[],
  nextRows: DeviceCollectionRow[],
) {
  if (currentRows.length !== nextRows.length) {
    return false;
  }

  return currentRows.every((row, index) => {
    const nextRow = nextRows[index];
    return (
      row.id === nextRow?.id &&
      row.keyName === nextRow?.keyName &&
      row.value === nextRow?.value
    );
  });
}

let nextDeviceCollectionRowId = 0;

function createDeviceCollectionRowId(prefix: string) {
  nextDeviceCollectionRowId += 1;
  return `${prefix}-${nextDeviceCollectionRowId}`;
}

function getInitialPropertyKey(keyName: string) {
  const trimmedKeyName = keyName.trim();
  return trimmedKeyName ? `initial.${trimmedKeyName}` : null;
}

function DeviceCsvListInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState('');
  const items = React.useMemo(() => splitCsvValue(value), [value]);

  const commitDraft = React.useCallback(() => {
    const newItems = draft
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item && !items.includes(item));

    if (newItems.length > 0) {
      onChange([...items, ...newItems].join(','));
    }
    setDraft('');
  }, [draft, items, onChange]);

  return (
    <div className="flex flex-col gap-3">
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item}
              className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
            >
              <code>{item}</code>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(items.filter((current) => current !== item).join(','))}
                aria-label={`Remove ${item}`}
              >
                <IconX className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder || 'Add value and press Enter'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commitDraft();
            }
          }}
          onBlur={commitDraft}
          className="h-9"
        />
        <Button type="button" variant="outline" size="sm" onClick={commitDraft}>
          Add
        </Button>
      </div>
    </div>
  );
}

function DeviceInitialKeyValueInput({
  properties,
  onPropertiesChange,
}: {
  properties: Record<string, string>;
  onPropertiesChange: (properties: Record<string, string>) => void;
}) {
  const [rows, setRows] = React.useState<DeviceCollectionRow[]>(() =>
    Object.entries(properties)
      .filter(([key]) => key.startsWith('initial.'))
      .map(([key, value]) => ({
        id: key,
        keyName: key.slice('initial.'.length),
        value,
      })),
  );

  React.useEffect(() => {
    setRows((currentRows) => {
      const previousRowsByKey = new Map(
        currentRows
          .map((row) => [getInitialPropertyKey(row.keyName), row] as const)
          .filter(([key]) => key !== null),
      );

      const syncedRows = Object.entries(properties)
        .filter(([key]) => key.startsWith('initial.'))
        .map(([key, value]) => ({
          id: previousRowsByKey.get(key)?.id ?? key,
          keyName: key.slice('initial.'.length),
          value,
        }));

      const existingDrafts = currentRows.filter((row) => {
        const propertyKey = getInitialPropertyKey(row.keyName);
        return !propertyKey || !Object.prototype.hasOwnProperty.call(properties, propertyKey);
      });
      const nextRows = [...syncedRows, ...existingDrafts];

      return areDeviceCollectionRowsEqual(currentRows, nextRows) ? currentRows : nextRows;
    });
  }, [properties]);

  const commitRows = React.useCallback(
    (nextRows: DeviceCollectionRow[]) => {
      const preservedEntries = Object.fromEntries(
        Object.entries(properties).filter(([key]) => !key.startsWith('initial.')),
      );
      const initialEntries = Object.fromEntries(
        nextRows
          .map((row) => [row.keyName.trim(), row.value] as const)
          .filter(([keyName, value]) => keyName.length > 0 && value !== '')
          .map(([keyName, value]) => [`initial.${keyName}`, value] as const),
      );

      onPropertiesChange({
        ...preservedEntries,
        ...initialEntries,
      });
    },
    [onPropertiesChange, properties],
  );

  return (
    <div className="space-y-3">
      {rows.length ? (
        rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.keyName}
              placeholder="Key"
              onChange={(event) => {
                const nextRows = rows.map((current) =>
                  current.id === row.id ? { ...current, keyName: event.target.value } : current,
                );
                setRows(nextRows);
                commitRows(nextRows);
              }}
              className="h-9"
            />
            <Input
              value={row.value}
              placeholder="Value"
              onChange={(event) => {
                const nextRows = rows.map((current) =>
                  current.id === row.id ? { ...current, value: event.target.value } : current,
                );
                setRows(nextRows);
                commitRows(nextRows);
              }}
              className="h-9"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                const nextRows = rows.filter((current) => current.id !== row.id);
                setRows(nextRows);
                commitRows(nextRows);
              }}
              aria-label={`Remove initial entry ${index + 1}`}
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        ))
      ) : (
        <div className="border-border/60 text-muted-foreground rounded-md border border-dashed px-4 py-4 text-sm">
          Add one key/value pair per row.
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          setRows((current) => [
            ...current,
            {
              id: createDeviceCollectionRowId('initial'),
              keyName: '',
              value: '',
            },
          ])
        }
      >
        <IconPlus className="mr-2 size-4" />
        Add entry
      </Button>
    </div>
  );
}

export interface DevicesProps {
  devices: Record<string, Device>;
  inheritedDevices?: Record<string, Device>;
  onDevicesChange?: (devices: Record<string, Device>) => void;
  readonly?: boolean;
  flags?: {
    type?: 'virtual-machine' | 'container';
  };
}

// ============================================================================
// CENTRALIZED VALIDATION SYSTEM
// ============================================================================

type ValidationError = {
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

type ValidationResult = {
  isValid: boolean;
  errors: ValidationError[];
};

const DeviceValidator = {
  validateDeviceName(
    name: string,
    existingDevices: Record<string, Device>,
    inheritedDevices: Record<string, Device>,
    editingDeviceName?: string,
  ): ValidationError | null {
    if (!name || name.trim() === '') {
      return {
        field: 'name',
        message: 'Device name is required',
        severity: 'error',
      };
    }

    const allNames = new Set([
      ...Object.keys(existingDevices),
      ...Object.keys(inheritedDevices),
    ]);

    if (editingDeviceName !== name && allNames.has(name)) {
      return {
        field: 'name',
        message: `Device "${name}" already exists`,
        severity: 'error',
      };
    }

    return null;
  },

  validateDiskPath(
    path: string,
    deviceType: string,
    existingDevices: Record<string, Device>,
    inheritedDevices: Record<string, Device>,
    editingDeviceName?: string,
  ): ValidationError | null {
    if (deviceType !== 'disk' || !path) return null;

    const allDevices = { ...inheritedDevices, ...existingDevices };
    const hasDuplicate = Object.entries(allDevices).some(
      ([deviceName, device]) => {
        if (editingDeviceName && deviceName === editingDeviceName) return false;
        return device.type === 'disk' && device.path === path;
      },
    );

    if (hasDuplicate) {
      return {
        field: 'path',
        message: `Another disk already uses path "${path}"`,
        severity: 'error',
      };
    }

    return null;
  },

  validatePort(
    portSpec: string,
    fieldName: string,
  ): ValidationError | null {
    if (!portSpec || portSpec.trim() === '') return null;

    if (!validatePort(portSpec)) {
      return {
        field: fieldName,
        message:
          'Invalid port specification. Use single port (80), range (80-90), or comma-separated (80,443)',
        severity: 'error',
      };
    }

    return null;
  },

  validateRequiredFields(
    deviceType: string,
    properties: Record<string, string>,
    deviceConfig: DeviceTypeConfig | undefined,
    isRoot: boolean,
    isNetworkDevice: boolean,
    isGPUDevice: boolean,
    instanceType: 'container' | 'virtual-machine',
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check configurable required fields
    if (deviceConfig?.keys) {
      deviceConfig.keys.forEach((keyObj) => {
        Object.entries(keyObj).forEach(([key, config]) => {
          // Use required_for if present, otherwise fall back to required === "yes"
          let isRequired = false;
          if (Array.isArray(config.required_for)) {
            isRequired = config.required_for.includes(instanceType);
          } else if (config.required === 'yes') {
            isRequired = true;
          }

          if (isRequired) {
            if (isRoot && key === 'pool' && !properties.pool) {
              errors.push({
                field: key,
                message: 'Storage pool is required',
                severity: 'error',
              });
            } else if (
              isRoot &&
              (key.startsWith('path') || key.startsWith('source'))
            ) {
              // Skip - managed automatically
            } else if (!isRoot && !properties[key]) {
              errors.push({
                field: key,
                message: `${key} is required`,
                severity: 'error',
              });
            }
          }
        });
      });
    }

    // Network device validation
    if (isNetworkDevice) {
      const hasNetwork = !!properties.network;
      const hasNictype = !!properties.nictype;
      const hasParent = !!properties.parent;

      if (!hasNetwork && (!hasNictype || !hasParent)) {
        errors.push({
          field: 'network',
          message: 'Select a network OR specify both nictype and parent',
          severity: 'error',
        });
      }
    }

    // GPU mdev validation
    if (isGPUDevice && properties.gputype === 'mdev' && !properties.mdev) {
      errors.push({
        field: 'mdev',
        message: 'MDEV field is required for GPU MDEV type',
        severity: 'error',
      });
    }

    return errors;
  },

  validateDevice(
    name: string,
    deviceType: string,
    properties: Record<string, string>,
    deviceConfig: DeviceTypeConfig | undefined,
    existingDevices: Record<string, Device>,
    inheritedDevices: Record<string, Device>,
    editingDeviceName?: string,
    isRoot?: boolean,
    isNetworkDevice?: boolean,
    isGPUDevice?: boolean,
    instanceType: 'container' | 'virtual-machine' = 'container',
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Name validation
    if (!isRoot && editingDeviceName !== name) {
      const nameError = this.validateDeviceName(
        name,
        existingDevices,
        inheritedDevices,
        editingDeviceName,
      );
      if (nameError) errors.push(nameError);
    }

    // Path validation
    const pathError = this.validateDiskPath(
      properties.path || '',
      deviceType,
      existingDevices,
      inheritedDevices,
      editingDeviceName,
    );
    if (pathError) errors.push(pathError);

    // Port validation for proxy devices
    if (deviceType === 'proxy') {
      const parsed = parseProxyConnection(properties.connect || '');
      if (parsed.type !== 'unix' && parsed.port) {
        const portError = this.validatePort(parsed.port, 'connect');
        if (portError) errors.push(portError);
      }

      const parsedListen = parseProxyConnection(properties.listen || '');
      if (parsedListen.type !== 'unix' && parsedListen.port) {
        const portError = this.validatePort(parsedListen.port, 'listen');
        if (portError) errors.push(portError);
      }
    }

    // Required fields validation
    const requiredErrors = this.validateRequiredFields(
      deviceType,
      properties,
      deviceConfig,
      isRoot || false,
      isNetworkDevice || false,
      isGPUDevice || false,
      instanceType,
    );
    errors.push(...requiredErrors);

    return {
      isValid: errors.length === 0,
      errors,
    };
  },
};

const DEVICE_TYPES = [
  {
    value: 'disk',
    label: 'Disks',
    icon: IconDeviceFloppy,
    description: 'Storage devices',
    placeholder: 'disk0',
  },
  {
    value: 'nic',
    label: 'Networks',
    icon: IconNetwork,
    description: 'Network interfaces',
    placeholder: 'eth0',
  },
  {
    value: 'proxy',
    label: 'Proxies',
    icon: IconArrowsLeftRight,
    description: 'Port forwarding',
    placeholder: 'web0',
  },
  {
    value: 'gpu',
    label: 'GPUs',
    icon: IconDeviceGamepad2,
    description: 'Graphics processors',
    placeholder: 'gpu0',
  },
];

interface DeviceListItemProps {
  name: string;
  device: Device;
  inherited: boolean;
  overridden: boolean;
  readonly?: boolean;
  selected?: boolean;
  hasIssues?: boolean;
  onRemove: (name: string) => void;
  onReset?: (name: string) => void;
  onClick?: () => void;
}

function DeviceListItem({
  name,
  device,
  inherited,
  overridden,
  readonly,
  selected,
  hasIssues,
  onRemove,
  onReset,
  onClick,
}: DeviceListItemProps) {
  const canDelete = !readonly && !inherited && !overridden && name !== 'root';
  const canReset = !readonly && overridden;

  return (
    <div
      onClick={onClick}
      className={`w-full text-left ${
        readonly && inherited && !overridden
          ? 'cursor-not-allowed'
          : 'cursor-pointer'
      }`}
      role="button"
      tabIndex={readonly && inherited && !overridden ? -1 : 0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`${name} device - ${device.type}${
        inherited ? ' (inherited)' : ''
      }${overridden ? ' (overridden)' : ''}`}
    >
      <Card
        className={`${inherited ? 'border-dashed' : ''} ${
          overridden ? 'border-orange-500/50' : ''
        } ${hasIssues ? 'border-destructive' : ''} ${
          selected ? 'ring-2 ring-primary' : 'hover:bg-muted/50'
        } ${readonly && inherited && !overridden ? 'opacity-50' : ''} transition-all`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold">{name}</CardTitle>
                {inherited && (
                  <Badge variant="outline" className="text-xs">
                    Inherited
                  </Badge>
                )}
                {overridden && (
                  <Badge
                    variant="outline"
                    className="text-xs border-orange-500"
                  >
                    Overridden
                  </Badge>
                )}
                {hasIssues && (
                  <Badge variant="destructive" className="text-xs">
                    Missing Required Fields
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs mt-1">
                {device.type}
              </CardDescription>
            </div>
            <div className="flex gap-1">
              {canReset && onReset && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReset(name);
                  }}
                >
                  Reset
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(name);
                  }}
                  aria-label={`Delete ${name} device`}
                >
                  <IconTrash className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1.5 text-xs">
            {Object.entries(device).map(([key, value]) => {
              if (key === 'type') return null;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 py-1"
                >
                  <span className="text-muted-foreground font-medium min-w-fit">
                    {key}
                  </span>
                  <span className="font-mono text-right break-all">
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface AddDeviceFormProps {
  deviceType: string;
  deviceConfig?: { keys: Array<Record<string, ConfigOption>> };
  onAdd: (name: string, device: Device) => void;
  editingDevice?: { name: string; device: Device };
  isInherited?: boolean;
  onUpdate?: (oldName: string, newName: string, device: Device) => void;
  isCreatingRootDisk?: boolean;
  existingDevices?: Record<string, Device>;
  inheritedDevices?: Record<string, Device>;
  registerFlushPendingAutoApply?: (flush: (() => void) | null) => void;
  flags?: {
    type?: 'virtual-machine' | 'container';
  };
}

function AddDeviceForm({
  deviceType,
  deviceConfig,
  onAdd,
  editingDevice,
  isInherited = false,
  onUpdate,
  isCreatingRootDisk = false,
  existingDevices = {},
  inheritedDevices = {},
  registerFlushPendingAutoApply,
  flags,
}: AddDeviceFormProps) {
  const [name, setName] = React.useState('');
  const [properties, setProperties] = React.useState<Record<string, string>>(
    {},
  );
  // Counter used to force a rerender/reset of certain controlled inputs (e.g. pool combobox)
  const [resetCounter, setResetCounter] = React.useState(0);
  const setPropertyValue = React.useCallback((key: string, value: string | undefined) => {
    setProperties((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }, []);
  // Check if a root disk already exists
  const hasRootDiskAlready = React.useMemo(() => {
    const allDevices = { ...inheritedDevices, ...existingDevices };
    return Object.values(allDevices).some(
      (device) => device.type === 'disk' && device.path === '/',
    );
  }, [existingDevices, inheritedDevices]);

  // Root disk: editing existing device named "root" OR device with path="/" that's already been added
  // OR explicitly creating root disk (but only if no root disk exists yet)
  const isRoot =
    (isCreatingRootDisk && !hasRootDiskAlready && deviceType === 'disk') ||
    editingDevice?.name === 'root' ||
    (editingDevice &&
      editingDevice.device.path === '/' &&
      deviceType === 'disk');
  // Name is readonly if it's root disk OR if it originated from inheritance (pure or overridden)
  const nameReadonly = isRoot || (isInherited && editingDevice !== undefined);

  // Detect device types early for conditional hook calls
  const isNetworkDevice = deviceType === 'nic' || deviceType.startsWith('nic_');
  const isGPUDevice = deviceType === 'gpu' || deviceType.startsWith('gpu_');

  const { data: storagePools, error: storagePoolsError } = useStoragePools();
  const { data: storageVolumes, error: storageVolumesError } =
    useStoragePoolVolumes(properties.pool);
  const { data: networks, error: networksError } = useNetworks();
  const { data: resources, error: resourcesError } = useResources();

  // Check if the selected pool is a Ceph pool
  const isCephPool = React.useMemo(() => {
    if (!properties.pool || !storagePools) return false;
    const selectedPool = storagePools.find((p) => p.name === properties.pool);
    return selectedPool?.driver === 'ceph';
  }, [properties.pool, storagePools]);

  // Memoize the selected network lookup to minimize recalculations
  const selectedNetwork = React.useMemo(() => {
    if (properties.network && networks) {
      return networks.find((n) => n.name === properties.network) || null;
    }
    return null;
  }, [properties.network, networks]);

  // Get the actual device config key for networks and GPUs
  const deviceConfigKey = React.useMemo(() => {
    if (isNetworkDevice) {
      // If network is set, infer type from the network
      if (selectedNetwork) {
        // Map network type to nictype (bridge -> bridged, others stay the same)
        const nictype =
          selectedNetwork.type === 'bridge'
            ? 'bridged'
            : selectedNetwork.type;
        return `nic_${nictype}`;
      }

      // If nictype is set, use that
      if (properties.nictype) {
        return `nic_${properties.nictype}`;
      }

      // Return null if no network or nictype is selected
      return null;
    }

    if (isGPUDevice) {
      // GPU type defaults to physical if not specified
      const gputype = properties.gputype || 'physical';
      return `gpu_${gputype}`;
    }

    return deviceType;
  }, [
    deviceType,
    isNetworkDevice,
    isGPUDevice,
    selectedNetwork,
    properties.nictype,
    properties.gputype,
  ]);

  // Get configurable options for dynamic network/GPU device config
  const { data: configurableOptions } = useConfigurableOptions();
  const referenceOptions = React.useMemo(
    () => collectReferenceOptions(configurableOptions?.configs),
    [configurableOptions],
  );

  // Use the dynamic config for network/GPU devices, otherwise use the passed deviceConfig
  const effectiveDeviceConfig = React.useMemo(() => {
    if (
      (isNetworkDevice || isGPUDevice) &&
      deviceConfigKey &&
      configurableOptions?.configs?.devices
    ) {
      const config =
        configurableOptions.configs.devices[
          deviceConfigKey as keyof typeof configurableOptions.configs.devices
        ];
      return config || null;
    }
    return deviceConfig;
  }, [
    isNetworkDevice,
    isGPUDevice,
    configurableOptions,
    deviceConfigKey,
    deviceConfig,
  ]);

  const poolConfig = React.useMemo(() => {
    if (!deviceConfig?.keys) return null;
    for (const keyObj of deviceConfig.keys) {
      if (keyObj.pool) {
        return { ...keyObj.pool, fullKey: 'pool' } as ConfigOption & {
          fullKey: string;
        };
      }
    }
    return null;
  }, [deviceConfig]);

  const sizeConfig = React.useMemo(() => {
    if (!deviceConfig?.keys) return null;
    for (const keyObj of deviceConfig.keys) {
      if (keyObj.size) {
        return { ...keyObj.size, fullKey: 'size' } as ConfigOption & {
          fullKey: string;
        };
      }
    }
    return null;
  }, [deviceConfig]);

  const parentConfig = React.useMemo(() => {
    if (!effectiveDeviceConfig?.keys) return null;
    for (const keyObj of effectiveDeviceConfig.keys) {
      if (keyObj.parent) {
        return { ...keyObj.parent, fullKey: 'parent' } as ConfigOption & {
          fullKey: string;
        };
      }
    }
    return null;
  }, [effectiveDeviceConfig]);

  const connectConfig = React.useMemo(() => {
    if (!effectiveDeviceConfig?.keys) return null;
    for (const keyObj of effectiveDeviceConfig.keys) {
      if (keyObj.connect) {
        return { ...keyObj.connect, fullKey: 'connect' } as ConfigOption & {
          fullKey: string;
        };
      }
    }
    return null;
  }, [effectiveDeviceConfig]);

  const listenConfig = React.useMemo(() => {
    if (!effectiveDeviceConfig?.keys) return null;
    for (const keyObj of effectiveDeviceConfig.keys) {
      if (keyObj.listen) {
        return { ...keyObj.listen, fullKey: 'listen' } as ConfigOption & {
          fullKey: string;
        };
      }
    }
    return null;
  }, [effectiveDeviceConfig]);

  // Populate form when editing or creating root disk
  React.useEffect(() => {
    if (editingDevice) {
      return;
    }

    if (isCreatingRootDisk && deviceType === 'disk') {
      // Use the memoized hasRootDiskAlready check to avoid duplication
      if (!hasRootDiskAlready) {
        // Only set path:"/" when actually creating a NEW root disk
        setName('root');
        setProperties({ path: '/' });
      } else {
        // Root disk already exists, create a regular disk instead
        setName('');
        setProperties({});
      }
    } else {
      // For new network devices, default name to eth{#}
      if (isNetworkDevice) {
        const allDevices = { ...inheritedDevices, ...existingDevices };
        const networkDevices = Object.entries(allDevices).filter(
          ([, device]) =>
            device.type === 'nic' || device.type.startsWith('nic_'),
        );
        const ethIndex = networkDevices.length;
        setName(`eth${ethIndex}`);
      } else if (isGPUDevice) {
        // For new GPU devices, default name to gpu{#} and gputype to physical
        const allDevices = { ...inheritedDevices, ...existingDevices };
        const gpuDevices = Object.entries(allDevices).filter(
          ([, device]) =>
            device.type === 'gpu' || device.type.startsWith('gpu_'),
        );
        const gpuIndex = gpuDevices.length;
        setName(`gpu${gpuIndex}`);
        setProperties({ gputype: 'physical' });
      } else {
        setName('');
        setProperties({});
      }
    }
  }, [
    editingDevice,
    isCreatingRootDisk,
    hasRootDiskAlready,
    isNetworkDevice,
    isGPUDevice,
    existingDevices,
    inheritedDevices,
    deviceType,
  ]);

  type FieldCategory = {
    name: string;
    fields: Array<{ key: string; config: ConfigOption }>;
  };

  // Memoize the sortCategories function to avoid recreating it on every render.
  const sortCategories = React.useCallback((
    map: Map<string, Array<{ key: string; config: ConfigOption }>>,
  ) => {
    return Array.from(map.entries())
      .sort(([a], [b]) =>
        a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b),
      )
      .map(([name, fields]) => ({
        name,
        // Store fields with their data; visibility will be checked by shouldShowField
        fields: fields.sort((a, b) => {
          // For source category, ensure pool appears first if present
          if (a.config.fullKey === 'pool') return -1;
          if (b.config.fullKey === 'pool') return 1;
          return a.key.localeCompare(b.key);
        }),
      }));
  }, []);

  const { requiredCategories, optionalCategories } = React.useMemo(() => {
    if (!effectiveDeviceConfig?.keys)
      return { requiredCategories: [], optionalCategories: [] };

    const requiredMap = new Map<
      string,
      Array<{ key: string; config: ConfigOption }>
    >();
    const optionalMap = new Map<
      string,
      Array<{ key: string; config: ConfigOption }>
    >();

    effectiveDeviceConfig.keys.forEach((keyObj) => {
      Object.entries(keyObj).forEach(([key, config]) => {
        const parts = key.split('.');
        const category = parts.length > 1 ? parts[0] : 'General';
        const fieldName = parts.length > 1 ? parts.slice(1).join('.') : key;

        // Hide ceph fields unless using ceph pool
        if (category.toLowerCase() === 'ceph' && !isCephPool) {
          return;
        }

        // For root disk: hide source & path selection (auto-managed) and remove pool/size from categorized fields (shown top-level)
        if (
          isRoot &&
          (key.startsWith('source') ||
            key.startsWith('path') ||
            key === 'pool' ||
            key === 'size')
        ) {
          return; // hide for root disk
        }
        // For non-root disks: hide size field (only allowed for root disk)
        if (deviceType === 'disk' && !isRoot && key === 'size') {
          return;
        }
        // For all disk devices: remove pool from categorized fields (shown top-level)
        if (deviceType === 'disk' && key === 'pool') {
          return;
        }
        const targetMap = config.required === 'yes' ? requiredMap : optionalMap;

        if (!targetMap.has(category)) {
          targetMap.set(category, []);
        }
        targetMap
          .get(category)!
          .push({ key: fieldName, config: { ...config, fullKey: key } });
      });
    });

    // Moved sortCategories to useCallback above, to improve performance.

    return {
      requiredCategories: sortCategories(requiredMap),
      optionalCategories: sortCategories(optionalMap),
    };
  }, [effectiveDeviceConfig, isRoot, deviceType, isCephPool, sortCategories]);

  const formatLabel = (key: string) => {
    return key
      .split(/[._]/) // Split on dot or underscore
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // ============================================================================
  // DISK DEVICE FIELDS
  // ============================================================================
  const renderDiskFields = () => {
    if (deviceType !== 'disk') return null;

    return (
      <>
        {poolConfig && (
          <div className="space-y-2">
            {renderField('pool', poolConfig, true)}
          </div>
        )}
        {isRoot && sizeConfig && (
          <div className="space-y-2">
            {renderField('size', sizeConfig, true)}
          </div>
        )}
      </>
    );
  };

  // ============================================================================
  // NETWORK DEVICE FIELDS
  // ============================================================================
  const renderNetworkFields = () => {
    if (!isNetworkDevice) return null;

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="network-parent" className="text-sm font-semibold">
            Parent Network
          </Label>
          <p className="text-xs text-muted-foreground">
            Select an existing network to automatically configure the device
            type
          </p>
          <Combobox
            value={properties.network || ''}
            onValueChange={(value) => {
              setProperties((prev) => {
                const newProps: Record<string, string> = { ...prev };
                if (value) {
                  newProps.network = value;
                  if ('nictype' in newProps) delete newProps.nictype;
                } else {
                  delete newProps.network;
                }
                return newProps;
              });
            }}
            allowDeselect
            defaultValue=""
          >
            <ComboboxTrigger className="h-9" placeholder="Select network...">
              {properties.network}
            </ComboboxTrigger>
            <ComboboxContent>
              {networks?.map((network) => (
                <ComboboxItem key={network.name} value={network.name}>
                  <div className="flex flex-col">
                    <span>{network.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {network.type}{' '}
                      {network.description && `• ${network.description}`}
                    </span>
                  </div>
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        </div>

        {!properties.network && (
          <>
            <div className="space-y-2">
              <Label htmlFor="nictype" className="text-sm font-semibold">
                Manual Network Type
              </Label>
              <p className="text-xs text-muted-foreground">
                Or manually select a network interface type
              </p>
              <Combobox
                value={properties.nictype || ''}
                onValueChange={(value) => {
                  setProperties((prev) => {
                    const newProps: Record<string, string> = { ...prev };
                    if (value) {
                      newProps.nictype = value;
                    } else {
                      delete newProps.nictype;
                    }
                    return newProps;
                  });
                }}
                allowDeselect
                defaultValue=""
              >
                <ComboboxTrigger
                  className="h-9 w-full"
                  placeholder="Select network type..."
                >
                  {properties.nictype}
                </ComboboxTrigger>
                <ComboboxContent>
                  <ComboboxItem value="bridged">Bridged</ComboboxItem>
                  <ComboboxItem value="macvlan">MACVLAN</ComboboxItem>
                  <ComboboxItem value="sriov">SR-IOV</ComboboxItem>
                  <ComboboxItem value="physical">Physical</ComboboxItem>
                  <ComboboxItem value="ovn">OVN</ComboboxItem>
                  <ComboboxItem value="ipvlan">IPVLAN</ComboboxItem>
                  <ComboboxItem value="p2p">Point-to-Point</ComboboxItem>
                  <ComboboxItem value="routed">Routed</ComboboxItem>
                </ComboboxContent>
              </Combobox>
            </div>
            {properties.nictype && parentConfig && (
              <div className="space-y-2">
                {renderField('parent', parentConfig, true)}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ============================================================================
  // GPU DEVICE FIELDS
  // ============================================================================
  const renderGPUFields = () => {
    if (!isGPUDevice) return null;

    return (
      <div className="space-y-2">
        <Label htmlFor="gputype" className="text-sm font-semibold">
          GPU Type
        </Label>
        <p className="text-xs text-muted-foreground">
          Select the type of GPU passthrough to use
        </p>
        <Select
          value={properties.gputype || 'physical'}
          onValueChange={(value) =>
            setProperties((prev) => ({ ...prev, gputype: value }))
          }
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="physical" />
          </SelectTrigger>
          <SelectContent>
            {(!flags?.type ||
              flags.type === 'virtual-machine' ||
              flags.type === 'container') && (
              <SelectItem value="physical">Physical</SelectItem>
            )}
            {(!flags?.type || flags.type === 'virtual-machine') && (
              <SelectItem value="mdev">MDEV</SelectItem>
            )}
            {(!flags?.type || flags.type === 'container') && (
              <SelectItem value="mig">MIG</SelectItem>
            )}
            {(!flags?.type || flags.type === 'virtual-machine') && (
              <SelectItem value="sriov">SR-IOV</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
    );
  };

  // ============================================================================
  // PROXY DEVICE FIELDS
  // ============================================================================
  const renderProxyFields = () => {
    if (deviceType !== 'proxy' || !connectConfig || !listenConfig) return null;

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-semibold">
            Connect To
            <span className="text-destructive ml-1">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            The address and port to connect to
          </p>
          <div className="flex gap-2">
            <Select
              value={parseProxyConnection(properties.connect || '').type}
              onValueChange={(type) => {
                const parsed = parseProxyConnection(properties.connect || '');
                setProperties((prev) => ({
                  ...prev,
                  connect: serializeProxyConnection(
                    type,
                    parsed.address,
                    parsed.port,
                  ),
                }));
              }}
            >
              <SelectTrigger className="h-9 min-w-16 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
                <SelectItem value="unix">Unix Socket</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={
                parseProxyConnection(properties.connect || '').type === 'unix'
                  ? '/path/to/socket'
                  : '127.0.0.1'
              }
              value={parseProxyConnection(properties.connect || '').address}
              onChange={(e) => {
                const parsed = parseProxyConnection(properties.connect || '');
                setProperties((prev) => ({
                  ...prev,
                  connect: serializeProxyConnection(
                    parsed.type,
                    e.target.value,
                    parsed.port,
                  ),
                }));
              }}
              className="h-9 flex-1 min-w-0"
            />
            {parseProxyConnection(properties.connect || '').type !== 'unix' && (
              <Input
                placeholder="80"
                value={parseProxyConnection(properties.connect || '').port}
                onChange={(e) => {
                  const parsed = parseProxyConnection(properties.connect || '');
                  setProperties((prev) => ({
                    ...prev,
                    connect: serializeProxyConnection(
                      parsed.type,
                      parsed.address,
                      e.target.value,
                    ),
                  }));
                }}
                className="h-9 w-24 font-mono text-xs"
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Port can be a single port (80), range (80-90), or comma-separated
            (80,443). IPv6 addresses should be in brackets: [::1]
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-semibold">
            Listen On
            <span className="text-destructive ml-1">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            The address and port to bind and listen
          </p>
          <div className="flex gap-2">
            <Select
              value={parseProxyConnection(properties.listen || '').type}
              onValueChange={(type) => {
                const parsed = parseProxyConnection(properties.listen || '');
                setProperties((prev) => ({
                  ...prev,
                  listen: serializeProxyConnection(
                    type,
                    parsed.address,
                    parsed.port,
                  ),
                }));
              }}
            >
              <SelectTrigger className="h-9 min-w-16 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
                <SelectItem value="unix">Unix Socket</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder={
                parseProxyConnection(properties.listen || '').type === 'unix'
                  ? '/path/to/socket'
                  : '0.0.0.0'
              }
              value={parseProxyConnection(properties.listen || '').address}
              onChange={(e) => {
                const parsed = parseProxyConnection(properties.listen || '');
                setProperties((prev) => ({
                  ...prev,
                  listen: serializeProxyConnection(
                    parsed.type,
                    e.target.value,
                    parsed.port,
                  ),
                }));
              }}
              className="h-9 flex-1 min-w-0"
            />
            {parseProxyConnection(properties.listen || '').type !== 'unix' && (
              <Input
                placeholder="8080"
                value={parseProxyConnection(properties.listen || '').port}
                onChange={(e) => {
                  const parsed = parseProxyConnection(properties.listen || '');
                  setProperties((prev) => ({
                    ...prev,
                    listen: serializeProxyConnection(
                      parsed.type,
                      parsed.address,
                      e.target.value,
                    ),
                  }));
                }}
                className="h-9 w-24 font-mono text-xs"
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Port can be a single port (8080), range (8080-8090), or
            comma-separated (8080,8443). IPv6 addresses should be in brackets:
            [::]
          </p>
        </div>
      </div>
    );
  };

  // Centralized validation using DeviceValidator
  const validationResult = React.useMemo(() => {
    return DeviceValidator.validateDevice(
      name,
      deviceType,
      properties,
      effectiveDeviceConfig,
      existingDevices,
      inheritedDevices,
      editingDevice?.name,
      isRoot,
      isNetworkDevice,
      isGPUDevice,
    );
  }, [
    name,
    deviceType,
    properties,
    effectiveDeviceConfig,
    existingDevices,
    inheritedDevices,
    editingDevice?.name,
    isRoot,
    isNetworkDevice,
    isGPUDevice,
  ]);

  const buildDevicePayload = React.useCallback(() => {
    const finalProps = { ...properties };
    if (isRoot) {
      finalProps.path = '/';
    }

    let finalType = deviceType;
    if (isGPUDevice) {
      const gputype = properties.gputype || 'physical';
      finalType = `gpu_${gputype}`;
      delete finalProps.gputype;
    }

    return {
      name,
      device: { type: finalType, ...finalProps } as Device,
    };
  }, [deviceType, isGPUDevice, isRoot, name, properties]);

  const lastAutoAppliedSignature = React.useRef<string | null>(null);
  const isInitializingEditState = React.useRef(false);
  const lastHydratedSignature = React.useRef<string | null>(null);
  const autoApplyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAutoApplyRef = React.useRef<{
    oldName: string;
    newName: string;
    device: Device;
    signature: string;
  } | null>(null);
  const onUpdateRef = React.useRef(onUpdate);
  const isUnmountingRef = React.useRef(false);
  const editingDeviceSignature = editingDevice
    ? stableStringify({
        name: editingDevice.name,
        device: editingDevice.device,
      })
    : null;
  const hydratedEditState = React.useMemo(() => {
    if (!editingDevice) return null;

    const { type, ...deviceProps } = editingDevice.device;
    const nextProperties = { ...deviceProps } as Record<string, string>;

    if (isRoot && deviceType === 'disk') {
      nextProperties.path = '/';
    }

    if (type.startsWith('gpu_')) {
      nextProperties.gputype = type.substring(4);
    }

    return {
      name: editingDevice.name,
      properties: nextProperties,
    };
  }, [deviceType, editingDevice, isRoot]);
  const hydratedEditStateSignature = hydratedEditState
    ? stableStringify(hydratedEditState)
    : null;

  React.useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const flushPendingAutoApply = React.useCallback(() => {
    const pendingUpdate = pendingAutoApplyRef.current;
    if (!pendingUpdate || !onUpdateRef.current) {
      return;
    }

    lastAutoAppliedSignature.current = pendingUpdate.signature;
    onUpdateRef.current(pendingUpdate.oldName, pendingUpdate.newName, pendingUpdate.device);
    pendingAutoApplyRef.current = null;
  }, []);

  React.useEffect(() => {
    registerFlushPendingAutoApply?.(flushPendingAutoApply);

    return () => {
      registerFlushPendingAutoApply?.(null);
    };
  }, [flushPendingAutoApply, registerFlushPendingAutoApply]);

  // Ensure path stays at "/" for root disk - but only if we're actually creating/editing a root disk
  React.useEffect(() => {
    // Only set path to "/" if this is explicitly a root disk creation or editing root disk
    if (isRoot && deviceType === 'disk' && properties.path !== '/') {
      setProperties((prev) => ({ ...prev, path: '/' }));
    }
  }, [isRoot, deviceType, properties.path]);

  React.useEffect(() => {
    if (!editingDevice || !editingDeviceSignature) {
      lastAutoAppliedSignature.current = null;
      lastHydratedSignature.current = null;
      isInitializingEditState.current = false;
      return;
    }

    if (editingDeviceSignature === lastHydratedSignature.current) {
      return;
    }

    if (
      lastHydratedSignature.current !== null &&
      editingDeviceSignature === lastAutoAppliedSignature.current
    ) {
      lastHydratedSignature.current = editingDeviceSignature;
      return;
    }

    lastHydratedSignature.current = editingDeviceSignature;
    lastAutoAppliedSignature.current = editingDeviceSignature;
    isInitializingEditState.current = true;
    setName(editingDevice.name);
    const { type, ...deviceProps } = editingDevice.device;
    if (type.startsWith('gpu_')) {
      const gputype = type.substring(4);
      setProperties({ ...deviceProps, gputype });
      return;
    }

    setProperties(deviceProps);
  }, [editingDevice, editingDeviceSignature]);

  React.useEffect(() => {
    if (!editingDevice || !hydratedEditStateSignature || !isInitializingEditState.current) return;

    const currentSignature = stableStringify({
      name,
      properties,
    });

    if (currentSignature === hydratedEditStateSignature) {
      isInitializingEditState.current = false;
    }
  }, [editingDevice, hydratedEditStateSignature, name, properties]);

  React.useEffect(() => {
    if (!editingDevice || !onUpdate || !validationResult.isValid) return;
    if (isInitializingEditState.current) return;

    const nextPayload = buildDevicePayload();
    const nextSignature = stableStringify(nextPayload);
    if (nextSignature === lastAutoAppliedSignature.current) {
      return;
    }

    if (autoApplyTimeoutRef.current) {
      clearTimeout(autoApplyTimeoutRef.current);
    }

    pendingAutoApplyRef.current = {
      oldName: editingDevice.name,
      newName: nextPayload.name,
      device: nextPayload.device,
      signature: nextSignature,
    };

    autoApplyTimeoutRef.current = setTimeout(() => {
      if (!pendingAutoApplyRef.current || !onUpdateRef.current) {
        autoApplyTimeoutRef.current = null;
        return;
      }

      flushPendingAutoApply();
      autoApplyTimeoutRef.current = null;
    }, 500);
  }, [
    buildDevicePayload,
    editingDevice,
    editingDevice?.name,
    flushPendingAutoApply,
    onUpdate,
    validationResult.isValid,
  ]);

  React.useEffect(() => {
    return () => {
      if (isUnmountingRef.current || !pendingAutoApplyRef.current) {
        return;
      }

      if (autoApplyTimeoutRef.current) {
        clearTimeout(autoApplyTimeoutRef.current);
        autoApplyTimeoutRef.current = null;
      }

      flushPendingAutoApply();
    };
  }, [editingDevice?.name, flushPendingAutoApply]);

  React.useEffect(
    () => () => {
      isUnmountingRef.current = true;
      if (autoApplyTimeoutRef.current) {
        clearTimeout(autoApplyTimeoutRef.current);
        autoApplyTimeoutRef.current = null;
      }
      pendingAutoApplyRef.current = null;
    },
    [],
  );

  const handleSubmit = () => {
    // Use centralized validation
    if (!validationResult.isValid) {
      return;
    }
    const nextPayload = buildDevicePayload();
    onAdd(nextPayload.name, nextPayload.device);
    setName('');
    setProperties(isRoot ? { path: '/' } : {});
    setResetCounter((c) => c + 1);
  };

  // Helper to determine if a field should be shown based on all filtering rules
  // Optimized with minimal dependencies to avoid expensive re-calculations
  const shouldShowField = React.useCallback(
    (fieldKey: string, config: ConfigOption) => {
      // Hide path/source for root disk
      if (
        isRoot &&
        (fieldKey.startsWith('path') || fieldKey.startsWith('source'))
      ) {
        return false;
      }

      // Check shortdesc for type restrictions (memoize the lowercase conversion)
      if (flags?.type && config.shortdesc) {
        const shortdesc = config.shortdesc.toLowerCase();
        const isVMOnly =
          shortdesc.includes('only for vms') || shortdesc.includes('vm only');
        const isContainerOnly =
          shortdesc.includes('only for containers') ||
          shortdesc.includes('container only');

        if (isVMOnly && flags.type !== 'virtual-machine') return false;
        if (isContainerOnly && flags.type !== 'container') return false;
      }

      // Disk-specific rules
      if (deviceType === 'disk') {
        // Only show wwn if io.bus equals virtio-scsi
        if (fieldKey === 'wwn' && properties['io.bus'] !== 'virtio-scsi') {
          return false;
        }
        // Only show size.state for VMs (or when no type flag is set)
        if (fieldKey === 'size.state' && flags?.type === 'container') {
          return false;
        }
        // Only show boot.priority for VMs (or when no type flag is set)
        if (fieldKey === 'boot.priority' && flags?.type === 'container') {
          return false;
        }

        // Limits exclusion: if limits.max is set, hide limits.read and limits.write
        if (properties['limits.max']) {
          if (fieldKey === 'limits.read' || fieldKey === 'limits.write') {
            return false;
          }
        }

        // Limits exclusion: if limits.read or limits.write is set, hide limits.max
        if (properties['limits.read'] || properties['limits.write']) {
          if (fieldKey === 'limits.max') {
            return false;
          }
        }
      }

      // Network-specific rules
      if (isNetworkDevice) {
        // Hide the network config field when parent network is selected
        if (fieldKey === 'network' && properties.network) {
          return false;
        }
        // Only show boot.priority for VMs (or when no type flag is set)
        if (fieldKey === 'boot.priority' && flags?.type === 'container') {
          return false;
        }
      }

      // Proxy-specific rules
      if (deviceType === 'proxy') {
        // Hide connect and listen fields - they're rendered with custom UI
        if (fieldKey === 'connect' || fieldKey === 'listen') {
          return false;
        }
      }

      // GPU-specific rules based on gputype
      if (isGPUDevice) {
        const gputype = properties.gputype || 'physical';

        // gputype field is shown at the top level, not in categories
        if (fieldKey === 'gputype') {
          return false;
        }

        // Fields for gpu_physical (container and VM)
        if (gputype === 'physical') {
          // All fields available: id, pci, productid, vendorid, uid, gid, mode
          return true;
        }

        // Fields for gpu_mdev (VM only)
        if (gputype === 'mdev') {
          // Available: id, mdev (required), productid, vendorid
          // Hide: pci, uid, gid, mode
          if (['pci', 'uid', 'gid', 'mode'].includes(fieldKey)) {
            return false;
          }
          // mig fields should be hidden
          if (fieldKey.startsWith('mig.')) {
            return false;
          }
          return true;
        }

        // Fields for gpu_mig (container only)
        if (gputype === 'mig') {
          // Available: id, mig.ci, mig.gi, mig.uuid, pci, productid, vendorid
          // Hide: mdev, uid, gid, mode
          if (['mdev', 'uid', 'gid', 'mode'].includes(fieldKey)) {
            return false;
          }
          return true;
        }

        // Fields for gpu_sriov (VM only)
        if (gputype === 'sriov') {
          // Available: id, pci, productid, vendorid
          // Hide: mdev, mig.*, uid, gid, mode
          if (
            ['mdev', 'uid', 'gid', 'mode'].includes(fieldKey) ||
            fieldKey.startsWith('mig.')
          ) {
            return false;
          }
          return true;
        }
      }

      return true;
    },
    [isRoot, flags, deviceType, properties, isNetworkDevice, isGPUDevice],
  );

  const renderField = (
    key: string,
    config: ConfigOption & { fullKey?: string },
    isTopLevel: boolean = false,
  ) => {
    const fieldId = `config-${config.fullKey || key}`;
    const fieldKey = config.fullKey || key;
    const isBool = config.type === 'bool';
    const hasCondition =
      config.condition && typeof config.condition === 'string';

    // Check if field should be shown using centralized logic
    if (!shouldShowField(fieldKey, config)) {
      return null;
    }

    // Mark field as required in certain conditions
    let effectiveConfig = config;
    if (isRoot && fieldKey === 'pool') {
      effectiveConfig = { ...config, required: 'yes' as const };
    } else if (
      isNetworkDevice &&
      fieldKey === 'parent' &&
      properties.nictype &&
      !properties.network
    ) {
      effectiveConfig = { ...config, required: 'yes' as const };
    } else if (
      isGPUDevice &&
      fieldKey === 'mdev' &&
      properties.gputype === 'mdev'
    ) {
      // mdev field is required for gpu_mdev type
      effectiveConfig = { ...config, required: 'yes' as const };
    }

    const hasUnitOptions =
      effectiveConfig.unit_options &&
      effectiveConfig.unit_options.length > 0 &&
      effectiveConfig.default_unit;
    const enumOptions = effectiveConfig.enum_options?.filter(Boolean) ?? [];
    const isInitialKeyValueField = fieldKey === 'initial.*';
    const isCsvListField =
      effectiveConfig.list_kind === 'csv' || fieldKey === 'vlan.tagged';

    return (
      <div key={fieldKey} className="space-y-2">
        <Label
          htmlFor={fieldId}
          className={
            isTopLevel ? 'text-sm font-semibold' : 'text-xs font-medium'
          }
        >
          {formatLabel(key)}
          {effectiveConfig.required === 'yes' && (
            <span className="text-destructive ml-1">*</span>
          )}
        </Label>
        <ConfigDescription
          text={effectiveConfig.display_shortdesc || effectiveConfig.shortdesc}
          metadata={effectiveConfig}
          referenceOptions={referenceOptions}
        />
        {isBool ? (
          <div className="flex items-center justify-between">
            <label htmlFor={fieldId} className="text-xs text-muted-foreground">
              {effectiveConfig.default === 'true'
                ? 'Enabled by default'
                : 'Disabled by default'}
            </label>
            <Switch
              id={fieldId}
              checked={properties[fieldKey] === 'true'}
              onCheckedChange={(checked) => setPropertyValue(fieldKey, checked ? 'true' : 'false')}
            />
          </div>
        ) : isInitialKeyValueField ? (
          <DeviceInitialKeyValueInput
            properties={properties}
            onPropertiesChange={setProperties}
          />
        ) : fieldKey === 'pool' && storagePools ? (
          <Combobox
            key={`pool-${resetCounter}`}
            value={properties[fieldKey] || undefined}
            onValueChange={(value) => setPropertyValue(fieldKey, value)}
            allowDeselect
          >
            <ComboboxTrigger
              placeholder={effectiveConfig.default || 'Select storage pool'}
            />
            <ComboboxContent
              searchPlaceholder="Search storage pools..."
              emptyLabel="No storage pools found."
            >
              {storagePools?.map((pool) => (
                <ComboboxItem
                  key={pool.name}
                  value={pool.name}
                  description={pool.description}
                >
                  {pool.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        ) : fieldKey === 'source' &&
          deviceType === 'disk' &&
          properties.pool &&
          storageVolumes ? (
          <Combobox
            value={(() => {
              const source = properties[fieldKey] || '';
              return source.split('/')[0];
            })()}
            onValueChange={(value) => {
              const currentSource = properties[fieldKey] || '';
              const currentPath = currentSource.split('/').slice(1).join('/');
              const newSource = currentPath ? `${value}/${currentPath}` : value;
              setPropertyValue(fieldKey, newSource);
            }}
          >
            <ComboboxTrigger
              placeholder={effectiveConfig.default || 'Select storage volume'}
            />
            <ComboboxContent
              searchPlaceholder="Search storage volumes..."
              emptyLabel="No storage volumes found."
            >
              {storageVolumes?.map((volume) => (
                <ComboboxItem
                  key={volume.name}
                  value={volume.name}
                  description={volume.description}
                >
                  {volume.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        ) : fieldKey === 'bind' ? (
          <Select
            value={properties[fieldKey] || ''}
            onValueChange={(value) =>
              setProperties((prev) => ({
                ...prev,
                [fieldKey]: value,
              }))
            }
          >
            <SelectTrigger
              className={isTopLevel ? 'h-9 w-full' : 'h-8 text-xs w-full'}
            >
              <SelectValue
                placeholder={effectiveConfig.default || 'Select bind mode'}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">Host</SelectItem>
              <SelectItem value="instance">Instance</SelectItem>
            </SelectContent>
          </Select>
        ) : isGPUDevice && fieldKey === 'pci' && resources?.gpu?.cards ? (
          <Combobox
            value={properties[fieldKey] || undefined}
            onValueChange={(value) => {
              const card = resources.gpu?.cards?.find(
                (c) => c.pci_address === value,
              );
              setProperties((prev) => {
                const next = { ...prev };
                if (value) {
                  next.pci = value;
                } else {
                  delete next.pci;
                }
                if (!next.vendorid && card?.vendor_id) {
                  next.vendorid = card.vendor_id;
                }
                if (!next.productid && card?.product_id) {
                  next.productid = card.product_id;
                }
                return next;
              });
            }}
            allowDeselect
          >
            <ComboboxTrigger placeholder="Select GPU (PCI)" />
            <ComboboxContent
              searchPlaceholder="Search GPUs..."
              emptyLabel="No GPUs detected."
            >
              {resources.gpu.cards.map((card, idx) => (
                <ComboboxItem
                  key={card.pci_address || idx}
                  value={card.pci_address || ''}
                  description={card.product || card.vendor}
                >
                  {card.pci_address} — {card.vendor} {card.product}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        ) : isGPUDevice && fieldKey === 'vendorid' && resources?.gpu?.cards ? (
          <Combobox
            value={properties[fieldKey] || undefined}
            onValueChange={(value) => setPropertyValue('vendorid', value)}
            allowDeselect
          >
            <ComboboxTrigger placeholder="Select vendor" />
            <ComboboxContent
              searchPlaceholder="Search vendors..."
              emptyLabel="No vendors"
            >
              {[
                ...new Map(
                  (resources.gpu.cards || []).map((c) => [
                    c.vendor_id || '',
                    { id: c.vendor_id, name: c.vendor },
                  ]),
                ).values(),
              ].map((v) => (
                <ComboboxItem
                  key={v.id || v.name}
                  value={v.id || ''}
                  description={v.name}
                >
                  {v.id} — {v.name}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        ) : isGPUDevice && fieldKey === 'productid' && resources?.gpu?.cards ? (
          <Combobox
            value={properties[fieldKey] || undefined}
            onValueChange={(value) => setPropertyValue('productid', value)}
            allowDeselect
          >
            <ComboboxTrigger placeholder="Select product" />
            <ComboboxContent
              searchPlaceholder="Search products..."
              emptyLabel="No products"
            >
              {(resources.gpu.cards || [])
                .filter(
                  (c) =>
                    !properties.vendorid || c.vendor_id === properties.vendorid,
                )
                .map((card, idx) => (
                  <ComboboxItem
                    key={card.product_id || idx}
                    value={card.product_id || ''}
                    description={card.product}
                  >
                    {card.product_id} — {card.product}
                  </ComboboxItem>
                ))}
            </ComboboxContent>
          </Combobox>
        ) : hasUnitOptions ? (
          <UnitInput
            id={fieldId}
            value={properties[fieldKey]}
            unitOptions={effectiveConfig.unit_options!}
            defaultUnit={effectiveConfig.default_unit!}
            onValueChange={(value) => setPropertyValue(fieldKey, value)}
            placeholder={effectiveConfig.default || fieldKey}
            inputClassName={isTopLevel ? 'h-9' : 'h-8 text-xs'}
            selectClassName={
              isTopLevel
                ? 'h-9 w-24 shrink-0'
                : 'h-8 w-24 shrink-0 text-xs'
            }
          />
        ) : enumOptions.length ? (
          <Select
            value={properties[fieldKey] || ''}
            onValueChange={(value) => setPropertyValue(fieldKey, value)}
          >
            <SelectTrigger className={isTopLevel ? 'h-9 w-full' : 'h-8 w-full text-xs'}>
              <SelectValue placeholder={effectiveConfig.default || fieldKey} />
            </SelectTrigger>
            <SelectContent>
              {enumOptions.map((option) => (
                <SelectItem key={option} value={option} className="text-xs">
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : isCsvListField ? (
          <DeviceCsvListInput
            id={fieldId}
            value={properties[fieldKey]}
            onChange={(value) => setPropertyValue(fieldKey, value)}
            placeholder={effectiveConfig.default || fieldKey}
          />
        ) : hasCondition ? (
          <Select
            value={properties[fieldKey] || ''}
            onValueChange={(value) => setPropertyValue(fieldKey, value)}
          >
            <SelectTrigger className={isTopLevel ? 'h-9' : 'h-8 text-xs'}>
              <SelectValue placeholder={effectiveConfig.default || fieldKey} />
            </SelectTrigger>
            <SelectContent>
              {effectiveConfig.condition?.split('|').map((option: string) => (
                <SelectItem
                  key={option.trim()}
                  value={option.trim()}
                  className="text-xs"
                >
                  {option.trim()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={fieldId}
            type={effectiveConfig.type === 'integer' ? 'number' : 'text'}
            placeholder={effectiveConfig.default || fieldKey}
            value={properties[fieldKey] || ''}
            onChange={(e) => setPropertyValue(fieldKey, e.target.value)}
            className={isTopLevel ? 'h-9' : 'h-8 text-xs'}
          />
        )}
        <ConfigDescription
          text={effectiveConfig.display_longdesc || effectiveConfig.longdesc}
          metadata={effectiveConfig}
          referenceOptions={referenceOptions}
        />
      </div>
    );
  };

  const renderCategory = (
    category: FieldCategory,
    isTopLevel: boolean = false,
  ) => {
    // Filter fields based on visibility rules
    const visibleFields = category.fields.filter(({ config }) =>
      shouldShowField(config.fullKey || '', config),
    );

    // Don't render empty categories
    if (visibleFields.length === 0) {
      return null;
    }

    return (
      <div key={category.name} className="space-y-3">
        {category.name !== 'General' && (
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {formatLabel(category.name)}
          </h5>
        )}
        <div className="space-y-4">
          {visibleFields.map(({ key, config }) =>
            renderField(key, config, isTopLevel),
          )}
        </div>
      </div>
    );
  };

  // Show error states if any data fetching failed
  const hasDataError =
    storagePoolsError || storageVolumesError || networksError || resourcesError;

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          {hasDataError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 mb-4">
              <p className="text-sm text-destructive font-medium">
                Failed to load configuration data
              </p>
              <p className="text-xs text-destructive/80 mt-1">
                {storagePoolsError ? 'Storage pools unavailable. ' : ''}
                {storageVolumesError ? 'Storage volumes unavailable. ' : ''}
                {networksError ? 'Networks unavailable. ' : ''}
                {resourcesError ? 'GPU resources unavailable. ' : ''}
              </p>
            </div>
          )}
          <div className="space-y-4">
            {!nameReadonly && (
              <div className="space-y-2">
                <Label htmlFor="device-name" className="text-sm font-semibold">
                  Device Name
                  <span className="text-destructive ml-1">*</span>
                </Label>
                <Input
                  id="device-name"
                  placeholder={
                    DEVICE_TYPES.find(
                      (t) =>
                        t.value === deviceType ||
                        (isNetworkDevice && t.value === 'nic'),
                    )?.placeholder || 'device0'
                  }
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9"
                />
              </div>
            )}
            {renderDiskFields()}
            {renderGPUFields()}
            {isNetworkDevice
              ? renderNetworkFields()
              : isGPUDevice
                ? null
                : deviceType === 'proxy'
                  ? renderProxyFields()
                  : null}
            {requiredCategories.length > 0 && (
              <div className="space-y-6">
                {requiredCategories.map((category) => (
                  <div key={category.name} className="space-y-4">
                    {renderCategory(category, true)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {optionalCategories.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">
                  Optional Configuration
                </h4>
                <div className="space-y-6">
                  <Accordion type="single" collapsible className="space-y-2">
                    {optionalCategories.map((category) => {
                      // Count visible fields for this category
                      const visibleFieldCount = category.fields.filter(
                        ({ config }) =>
                          shouldShowField(config.fullKey || '', config),
                      ).length;

                      // Add source path field if applicable
                      const hasSourcePath =
                        deviceType === 'disk' &&
                        properties.pool &&
                        category.name === 'General';

                      const totalVisibleFields =
                        visibleFieldCount + (hasSourcePath ? 1 : 0);

                      // Skip empty categories
                      if (totalVisibleFields === 0) {
                        return null;
                      }

                      return (
                        <AccordionItem
                          key={category.name}
                          value={category.name}
                          className="border rounded-md"
                        >
                          <AccordionTrigger className="px-3 py-2 text-xs font-medium">
                            <div className="flex w-full items-center justify-between pr-6">
                              <span>{formatLabel(category.name)}</span>
                              <span className="text-muted-foreground text-[10px] font-normal">
                                {totalVisibleFields} Option
                                {totalVisibleFields !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-3 pb-3 pt-0 space-y-4">
                            {hasSourcePath && (
                              <div className="space-y-2">
                                <Label
                                  htmlFor="source-path"
                                  className="text-xs font-medium"
                                >
                                  Source Path
                                </Label>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  Subpath within the storage volume (e.g.,
                                  /data)
                                </p>
                                <Input
                                  id="source-path"
                                  type="text"
                                  placeholder="e.g., /data"
                                  value={(() => {
                                    const source = properties.source || '';
                                    const parts = source.split('/');
                                    return parts.length > 1
                                      ? '/' + parts.slice(1).join('/')
                                      : '';
                                  })()}
                                  onChange={(e) => {
                                    const path = e.target.value;
                                    const sourceVolume = (() => {
                                      const source = properties.source || '';
                                      return source.split('/')[0];
                                    })();
                                    if (path && sourceVolume) {
                                      setProperties((prev) => ({
                                        ...prev,
                                        source: sourceVolume + path,
                                      }));
                                    } else if (sourceVolume) {
                                      setProperties((prev) => ({
                                        ...prev,
                                        source: sourceVolume,
                                      }));
                                    }
                                  }}
                                  className="h-8 text-xs"
                                />
                              </div>
                            )}
                            {category.fields.map(({ key, config }) =>
                              renderField(key, config),
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {validationResult.errors.length > 0 || !editingDevice ? (
        <div className="border-t bg-background p-4 space-y-2">
          {validationResult.errors.length > 0 && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-xs font-medium text-destructive mb-2">
                Please fix the following issues:
              </p>
              <ul className="text-xs text-destructive/90 space-y-1 list-disc list-inside">
                {validationResult.errors.map((error, index) => (
                  <li key={`${error.field}-${index}`}>{error.message}</li>
                ))}
              </ul>
            </div>
          )}
          {editingDevice ? null : (
            <Button
              onClick={handleSubmit}
              disabled={!validationResult.isValid}
              className="w-full select-none"
            >
              <IconPlus className="mr-2 h-4 w-4" />
              {`Add ${(() => {
                const deviceType_ = DEVICE_TYPES.find((t) => t.value === deviceType);
                if (!deviceType_) return 'Device';
                return singularizeDeviceTypeLabel(deviceType_.label);
              })()}`}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function Devices({
  devices,
  inheritedDevices = {},
  onDevicesChange,
  readonly = false,
  flags,
}: DevicesProps) {
  const [selectedType, setSelectedType] = React.useState('disk');
  const [localDevices, setLocalDevices] =
    React.useState<Record<string, Device>>(devices);
  const [selectedDeviceName, setSelectedDeviceName] = React.useState<string | null>(null);
  const [isCreatingRootDisk, setIsCreatingRootDisk] = React.useState(false);

  const { data: configurableOptions } = useConfigurableOptions();
  const skipSyncFromProps = React.useRef(false);

  React.useEffect(() => {
    // Only sync from props if the change came from outside (not from our own updates)
    if (!skipSyncFromProps.current) {
      setLocalDevices(devices);
    }
    skipSyncFromProps.current = false;
  }, [devices]);

  const selectedDevice = React.useMemo(() => {
    if (!selectedDeviceName) return null;

    const allDevices = { ...inheritedDevices, ...localDevices };
    const device = allDevices[selectedDeviceName];
    if (!device) return null;

    return {
      name: selectedDeviceName,
      device,
    };
  }, [inheritedDevices, localDevices, selectedDeviceName]);

  // Clear selected device when changing tabs or when device is removed
  React.useEffect(() => {
    if (selectedDevice && selectedDevice.device.type !== selectedType) {
      setSelectedDeviceName(null);
    }
  }, [selectedType, selectedDevice]);

  const filteredDevices = React.useMemo(() => {
    const allDevices = { ...inheritedDevices, ...localDevices };
    return Object.entries(allDevices).filter(([, device]) => {
      // For GPU type, match all gpu_* types
      if (selectedType === 'gpu') {
        return device.type === 'gpu' || device.type.startsWith('gpu_');
      }
      return device.type === selectedType;
    });
  }, [localDevices, inheritedDevices, selectedType]);

  const isInherited = (name: string) =>
    name in inheritedDevices && !(name in localDevices);
  const isOverridden = (name: string) =>
    name in inheritedDevices && name in localDevices;

  const hasRootDisk = React.useMemo(() => {
    const allDevices = { ...inheritedDevices, ...localDevices };
    return Object.values(allDevices).some(
      (device) => device.type === 'disk' && device.path === '/',
    );
  }, [localDevices, inheritedDevices]);

  const hasIssues = (name: string, device: Device) => {
    const isRootDisk = device.path === '/' && device.type === 'disk';

    // Special case: root disk must have a pool
    if (isRootDisk) {
      if (!device.pool || device.pool === '') {
        return true;
      }
    }

    const deviceConfig = configurableOptions?.configs?.devices?.[device.type];
    if (!deviceConfig?.keys) return false;

    for (const keyObj of deviceConfig.keys) {
      for (const [key, config] of Object.entries(keyObj)) {
        if (config.required === 'yes') {
          // For root disk, path/source are auto-managed
          if (isRootDisk) {
            if (key.startsWith('path') || key.startsWith('source')) continue;
            if (key === 'pool') continue; // already checked above
          }
          if (!device[key as keyof Device]) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const handleAdd = (name: string, device: Device) => {
    const updated = { ...localDevices, [name]: device };
    skipSyncFromProps.current = true;
    setLocalDevices(updated);
    onDevicesChange?.(updated);
    setSelectedDeviceName(null);
    setIsCreatingRootDisk(false);
  };

  const handleUpdate = (oldName: string, newName: string, device: Device) => {
    const updated = { ...localDevices };

    // If name changed, remove old entry
    if (oldName !== newName) {
      delete updated[oldName];
    }

    updated[newName] = device;
    skipSyncFromProps.current = true;
    setLocalDevices(updated);
    onDevicesChange?.(updated);
    if (!(oldName in localDevices) && !(oldName in inheritedDevices)) return;
    if (oldName !== newName) {
      setSelectedDeviceName(newName);
    }
  };

  const handleRemove = (name: string) => {
    const device = localDevices[name];
    const isRootDisk = device && device.path === '/' && device.type === 'disk';

    // Prevent removal of root disk or inherited devices
    if (isRootDisk || (name in inheritedDevices && !(name in localDevices))) {
      return;
    }
    const rest = { ...localDevices };
    delete rest[name];
    skipSyncFromProps.current = true;
    setLocalDevices(rest);
    onDevicesChange?.(rest);

    if (selectedDevice?.name === name) {
      setSelectedDeviceName(null);
    }
  };

  const handleReset = (name: string) => {
    // Remove override to revert to inherited version
    if (name in inheritedDevices && name in localDevices) {
      const rest = { ...localDevices };
      delete rest[name];
      skipSyncFromProps.current = true;
      setLocalDevices(rest);
      onDevicesChange?.(rest);

      if (selectedDevice?.name === name) {
        setSelectedDeviceName(null);
      }
    }
  };

  const [showDetailPanel, setShowDetailPanel] = React.useState(false);
  const flushPendingAutoApplyRef = React.useRef<(() => void) | null>(null);

  const handleAddClick = () => {
    setIsCreatingRootDisk(true);
    setSelectedDeviceName(null);
    setShowDetailPanel(true);
  };

  const handleDeviceClick = (name: string) => {
    if (readonly) {
      return;
    }
    setSelectedDeviceName(name);
    setShowDetailPanel(true);
  };

  const closeDetailPanel = () => {
    flushPendingAutoApplyRef.current?.();
    setSelectedDeviceName(null);
    setIsCreatingRootDisk(false);
    setShowDetailPanel(false);
  };

  const tabs = React.useMemo(() => {
    return DEVICE_TYPES.map((type) => {
      const count = Object.values({
        ...inheritedDevices,
        ...localDevices,
      }).filter(
        (d) => d.type === type.value || d.type.startsWith(`${type.value}_`),
      ).length;

      return {
        value: type.value,
        label: type.label,
        icon: type.icon,
        count,
        description: type.description,
      };
    });
  }, [inheritedDevices, localDevices]);

  const selectedDeviceType = DEVICE_TYPES.find((t) => t.value === selectedType);

  const renderDetailForm = () => (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 -ml-1 md:hidden"
          onClick={closeDetailPanel}
          aria-label="Back"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-sm select-none">
          {selectedDevice
            ? `Edit ${selectedDevice.name}`
            : isCreatingRootDisk && !hasRootDisk && selectedType === 'disk'
              ? 'Add Root Disk'
              : `Add ${(() => {
                  const deviceType = DEVICE_TYPES.find(
                    (t) => t.value === selectedType,
                  );
                  if (!deviceType) return 'Device';
                  return singularizeDeviceTypeLabel(deviceType.label);
                })()}`}
        </h3>
        <div className="ml-auto md:hidden">
          {/* Mobile close button if needed, or just rely on back */}
        </div>
        <div className="ml-auto hidden md:block">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={closeDetailPanel}
          >
            <IconX className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <AddDeviceForm
          deviceType={selectedType}
          deviceConfig={
            configurableOptions?.configs?.devices?.[
              selectedType.startsWith('nic_') ? 'nic_bridged' : selectedType
            ]
          }
          onAdd={(name, device) => {
            handleAdd(name, device);
            setShowDetailPanel(false);
          }}
          editingDevice={selectedDevice || undefined}
          isInherited={
            selectedDevice
              ? isInherited(selectedDevice.name) ||
                isOverridden(selectedDevice.name)
              : false
          }
          onUpdate={(oldName, newName, device) => {
            handleUpdate(oldName, newName, device);
          }}
          isCreatingRootDisk={isCreatingRootDisk}
          existingDevices={localDevices}
          inheritedDevices={inheritedDevices}
          registerFlushPendingAutoApply={(flush) => {
            flushPendingAutoApplyRef.current = flush;
          }}
          flags={flags}
        />
      </div>
    </div>
  );

  return (
    <VerticalTabsLayout
      tabs={tabs}
      selectedTab={selectedType}
      onTabSelect={(type) => {
        setSelectedType(type);
        setShowDetailPanel(false); // Close detail panel when switching tabs
      }}
      title="Device Types"
      detailPanel={
        !readonly && showDetailPanel ? renderDetailForm() : undefined
      }
      contentSize={readonly ? 80 : 50}
    >
      <div className="h-full flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <div className="flex items-center gap-2">
            {selectedDeviceType && (
              <>
                <selectedDeviceType.icon className="h-5 w-5" />
                <h3 className="font-semibold">{selectedDeviceType.label}</h3>
              </>
            )}
          </div>
          {!readonly && (
            <Button size="sm" onClick={handleAddClick} className="h-8 text-xs">
              <IconPlus className="h-3 w-3 mr-1" />
              Add
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {!readonly &&
              selectedType === 'disk' &&
              !hasRootDisk &&
              !isCreatingRootDisk && (
                <Card className="border-dashed border-primary/50 bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      No Root Disk
                    </CardTitle>
                    <CardDescription className="text-xs">
                      A root disk is typically required for instances. Would you
                      like to add one?
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={handleAddClick}
                    >
                      <IconPlus className="h-4 w-4 mr-2" />
                      Add Root Disk
                    </Button>
                  </CardContent>
                </Card>
              )}
            {filteredDevices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-muted p-4 mb-4">
                  {selectedDeviceType && (
                    <selectedDeviceType.icon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm font-medium">No devices configured</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add a {selectedType} device to get started
                </p>
              </div>
            ) : (
              filteredDevices.map(([name, device]) => (
                <DeviceListItem
                  key={name}
                  name={name}
                  device={device}
                  inherited={isInherited(name)}
                  overridden={isOverridden(name)}
                  readonly={readonly}
                  selected={selectedDevice?.name === name}
                  hasIssues={hasIssues(name, device)}
                  onRemove={handleRemove}
                  onReset={handleReset}
                  onClick={() => handleDeviceClick(name)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </VerticalTabsLayout>
  );
}
