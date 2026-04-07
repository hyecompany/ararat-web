export interface Server {
  config: ServerConfig;
  api_extensions: string[];
  api_status: string;
  api_version: string;
  auth: 'trusted' | 'untrusted';
  auth_user_method?: string;
  auth_user_name?: string;
  public: boolean;
  auth_methods: string[];
}

export interface ServerConfig {
  'user.ui.theme'?: string;
  'user.ui_theme'?: string;
  [key: string]: unknown;
}

export interface ConfigOption {
  type: string;
  required?: string;
  default?: string;
  shortdesc?: string;
  longdesc?: string;
  condition?: string;
  name?: string;
  key?: string;
  fullKey?: string;
  supported_types?: ('container' | 'virtual-machine')[];
  required_for?: ('container' | 'virtual-machine')[];
  unit_options?: string[];
  default_unit?: string;
}

export interface DeviceTypeConfig {
  keys: Array<Record<string, ConfigOption>>;
}

export interface ConfigurableOptions {
  configs: {
    cluster: object;
    cluster_group: object;
    devices: {
      [key: string]: DeviceTypeConfig;
    };
    image: object;
    instance: object;
    kernel: object;
    network_address_set: object;
    network_bridge: object;
    network_forward: object;
    network_integration: object;
    network_load_balancer: object;
    network_macvlan: object;
    network_ovn: object;
    network_physical: object;
    network_sriov: object;
    network_zone: object;
    project: object;
    server: object;
    storage_btrfs: object;
    storage_bucket_btrfs: object;
    storage_bucket_cephobject: object;
    storage_bucket_lvm: object;
    storage_bucket_zfs: object;
    storage_ceph: object;
    storage_cephfs: object;
    storage_cephobject: object;
    storage_dir: object;
    storage_linstor: object;
    storage_lvm: object;
    storage_truenas: object;
    storage_volume_btrfs: object;
    storage_volume_ceph: object;
    storage_volume_cephfs: object;
    storage_volume_dir: object;
    storage_volume_linstor: object;
    storage_volume_lvm: object;
    storage_volume_truenas: object;
    storage_volume_zfs: object;
    storage_zfs: object;
  };
}
