import { StandardResponse } from "./response";

export interface Profile {
    name: string;
    description?: string;
    config: Record<string, string>;
    devices: Record<string, Record<string, string>>;
    project?: string;
    used_by?: string[];
}

export type ProfilesResponse = StandardResponse<Profile[]>;
