export interface Server {
  config: ServerConfig;
  api_extensions: string[];
  api_status: string;
  api_version: string;
  auth: "trusted" | "untrusted";
  auth_user_method?: string;
  auth_user_name?: string;
  public: boolean;
  auth_methods: string[];
}

export interface ServerConfig {
  "user.ui.theme"?: string;
  "user.ui_theme"?: string;
  [key: string]: unknown;
}

export interface ConfigOption {
  key: string;
  type: string;
  scope?: string;
  defaultdesc?: string;
  liveupdate?: boolean;
  shortdesc?: string;
  longdesc?: string;
  condition?: string;
}

export interface ConfigurableOptions {
  configs: {
    cluster: Record<string, ConfigOption>;
    cluster_group: Record<string, ConfigOption>;
    devices: Record<string, ConfigOption>;
    image: Record<string, ConfigOption>;
    instance: Record<string, ConfigOption>;
    kernel: Record<string, ConfigOption>;
    network_address_set: Record<string, ConfigOption>;
    network_bridge: Record<string, ConfigOption>;
    network_forward: Record<string, ConfigOption>;
    network_integration: Record<string, ConfigOption>;
    network_load_balancer: Record<string, ConfigOption>;
    network_macvlan: Record<string, ConfigOption>;
    network_ovn: Record<string, ConfigOption>;
    network_physical: Record<string, ConfigOption>;
    network_sriov: Record<string, ConfigOption>;
    network_zone: Record<string, ConfigOption>;
    project: Record<string, ConfigOption>;
    server: Record<string, ConfigOption>;
    storage_btrfs: Record<string, ConfigOption>;
    storage_bucket_btrfs: Record<string, ConfigOption>;
    storage_bucket_cephobject: Record<string, ConfigOption>;
    storage_bucket_lvm: Record<string, ConfigOption>;
    storage_bucket_zfs: Record<string, ConfigOption>;
    storage_ceph: Record<string, ConfigOption>;
    storage_cephfs: Record<string, ConfigOption>;
    storage_cephobject: Record<string, ConfigOption>;
    storage_dir: Record<string, ConfigOption>;
    storage_linstor: Record<string, ConfigOption>;
    storage_lvm: Record<string, ConfigOption>;
    storage_truenas: Record<string, ConfigOption>;
    storage_volume_btrfs: Record<string, ConfigOption>;
    storage_volume_ceph: Record<string, ConfigOption>;
    storage_volume_cephfs: Record<string, ConfigOption>;
    storage_volume_dir: Record<string, ConfigOption>;
    storage_volume_linstor: Record<string, ConfigOption>;
    storage_volume_lvm: Record<string, ConfigOption>;
    storage_volume_truenas: Record<string, ConfigOption>;
    storage_volume_zfs: Record<string, ConfigOption>;
    storage_zfs: Record<string, ConfigOption>;
  };
}
