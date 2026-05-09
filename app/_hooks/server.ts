import {
  useConfigurableOptionsResource,
  useServerConfigurationResource,
} from '@/app/_incus/resources/server/hooks';

export function useServerConfiguration() {
  return useServerConfigurationResource();
}
export function useConfigurableOptions() {
  return useConfigurableOptionsResource();
}
