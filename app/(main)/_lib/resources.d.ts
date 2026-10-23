export interface GPUCardDRM {
  id?: number;
  card_name?: string;
  card_device?: string;
  control_name?: string;
  control_device?: string;
  render_name?: string;
  render_device?: string;
}

export interface GPUCard {
  driver?: string;
  driver_version?: string;
  drm?: GPUCardDRM;
  numa_node?: number;
  pci_address?: string;
  vendor?: string;
  vendor_id?: string;
  product?: string;
  product_id?: string;
}

export interface ResourcesGPU {
  cards?: GPUCard[];
  total?: number;
}

export interface ResourcesCPU {
  total?: number;
}

export interface ResourcesMetadata {
  gpu?: ResourcesGPU;
  cpu?: ResourcesCPU;
  // Other sections intentionally partial; extend as needed.
}

export interface ResourcesResponse {
  gpu?: ResourcesGPU;
  // Convenience flatten; original endpoint nests under metadata.
}
