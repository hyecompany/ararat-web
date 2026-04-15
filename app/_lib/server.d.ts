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
  defaultdesc?: string;
  initialvaluedesc?: string;
  shortdesc?: string;
  longdesc?: string;
  display_shortdesc?: string;
  display_longdesc?: string;
  condition?: string;
  name?: string;
  key?: string;
  fullKey?: string;
  scoped_defaults?: Partial<Record<'container' | 'virtual-machine', string | undefined>>;
  supported_types?: ('container' | 'virtual-machine')[];
  required_for?: ('container' | 'virtual-machine')[];
  unit_options?: string[];
  default_unit?: string;
  disable_unit_input?: boolean;
  reset_value?: string;
  enum_options?: string[];
  list_kind?: 'csv';
  editor_kind?:
    | 'monaco'
    | 'newline_list'
    | 'resource_selector'
    | 'schedule_autocomplete'
    | 'hugepages_group';
  editor_language?: string;
  selector_source?:
    | 'cluster_groups'
    | 'networks'
    | 'network_integrations'
    | 'network_zones';
  suggestions?: string[];
  group_members?: Array<{
    key: string;
    label: string;
    metadata: ConfigOption;
  }>;
  disabled_reason?: string;
  depends_on?: Array<{
    key: string;
    operator: 'truthy' | 'equals';
    value?: string;
  }>;
  reference_tokens?: Array<{
    raw: string;
    kind: 'config_option' | 'doc_ref';
    namespace?: string;
    key: string;
    label: string;
    placeholder: string;
  }>;
}

export interface ConfigOptionCategory {
  keys: Array<Record<string, ConfigOption>>;
}

export type ConfigOptionCollection = Record<string, ConfigOptionCategory>;

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
    instance: ConfigOptionCollection;
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
    project: ConfigOptionCollection;
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
