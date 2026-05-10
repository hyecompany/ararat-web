import {
  useProfilesResource,
  type UseProfilesOptions,
} from '@/app/_incus/resources/profiles/hooks';

export function useProfiles(
  profiles?: string[],
  options: UseProfilesOptions = {},
) {
  return useProfilesResource(profiles, options);
}
