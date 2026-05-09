import { useProfilesResource } from '@/app/_incus/resources/profiles/hooks';

export function useProfiles(profiles?: string[]) {
  return useProfilesResource(profiles);
}
