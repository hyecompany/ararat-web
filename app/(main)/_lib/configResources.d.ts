export interface ClusterGroup {
  name: string;
  description?: string;
  members?: string[];
}

export interface NetworkIntegration {
  name: string;
  description?: string;
  type?: string;
}

export interface NetworkZone {
  name: string;
  description?: string;
}
