'use client';

import * as React from 'react';
import { useProfiles } from '../../_hooks/profiles';
import Devices from '../../_components/devices';
import type { Device } from '../_lib/instances.d';

/**
 * Props for the InstanceDevices component
 */
export interface InstanceDevicesProps {
  /** Profile names to fetch inherited devices from */
  profiles: string[];
  /** Instance-specific devices (overrides) */
  devices?: Record<string, Device>;
  /** Callback when devices change */
  onDevicesChange?: (devices: Record<string, Device>) => void;
  /** Instance type for device filtering */
  instanceType?: 'virtual-machine' | 'container';
  /** Optional class name passed to the shared device manager layout */
  className?: string;
  /** Project used for project-scoped child resources such as storage volumes */
  project?: string | null;
}

/**
 * Device management component for instances.
 * Fetches devices from profiles and allows overriding them.
 */
export default function InstanceDevices({
  profiles,
  devices = {},
  onDevicesChange,
  instanceType,
  className,
  project,
}: InstanceDevicesProps) {
  const { data: profilesData, isLoading, error } = useProfiles(profiles, {
    project,
  });

  // Aggregate all inherited devices from profiles
  const inheritedDevices = React.useMemo(() => {
    if (!profilesData) return {};

    const inherited: Record<string, Device> = {};

    // Profiles are applied in order, so later profiles can override earlier ones
    profilesData.forEach((profile) => {
      if (profile.devices) {
        Object.entries(profile.devices).forEach(([name, device]) => {
          inherited[name] = device;
        });
      }
    });

    return inherited;
  }, [profilesData]);

  const effectiveDevices = React.useMemo(() => {
    return { ...devices };
  }, [devices, inheritedDevices]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 max-w-md">
          <p className="text-sm text-destructive font-medium">
            Failed to load profiles
          </p>
          <p className="text-xs text-destructive/80 mt-1">
            Unable to fetch device configurations from selected profiles.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-sm text-muted-foreground">
          Loading device configurations...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <Devices
        devices={effectiveDevices}
        inheritedDevices={inheritedDevices}
        onDevicesChange={onDevicesChange}
        className={className}
        flags={instanceType ? { type: instanceType } : undefined}
        project={project}
      />
    </div>
  );
}
