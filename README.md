# Hye Ararat

**A modern, web-based UI for managing [Incus](https://linuxcontainers.org/incus/).**

Hye Ararat provides a clean, intuitive dashboard for managing your Incus deployment. Whether you are running an old iMac in your closet or building a hyperscaler, Ararat gives you the unified comprehensive control plane you need to take your infrastructure to its peak.

**Current Release:** v3.0.0-beta.1

## Roadmap

Hye Ararat is currently in public beta. Below is a high-level summary of our progress on supporting the foundational Incus primitives:

- [x] Instances (almost complete)
- [x] Operations
- [x] Projects
- [ ] Networks
- [ ] Storage
- [ ] Server
- [ ] Cluster
- [ ] Images
- [ ] Profiles

We are actively working on completing the UI implementation for all Incus primitives to provide a comprehensive management experience.

We aim to support all core primitives by July 24th. Our planned release schedule is available on our [GitHub Milestones](https://github.com/hyecompany/ararat-web/milestones).

## Some Instance Screenshots

<table>
  <tr>
    <td>
      <p align="center"><strong>Console</strong></p>
      <img alt="image" src="https://github.com/user-attachments/assets/37d5c15b-d094-4425-9d57-6585949ac851" />
    </td>
    <td>
      <p align="center"><strong>Configuration</strong></p>
      <img alt="image" src="https://github.com/user-attachments/assets/05993b1f-0b26-4394-9f42-21951ae99746" />
    </td>
  </tr>
  <tr>
    <td>
      <p align="center"><strong>Files</strong></p>
      <img alt="image" src="https://github.com/user-attachments/assets/be7ba84e-e931-4671-bd08-eac80b2e27da" />
    </td>
    <td>
      <p align="center"><strong>Devices</strong></p>
      <img alt="image" src="https://github.com/user-attachments/assets/51afb82f-fd0f-45e8-aef3-e1648d1a1c40" />
    </td>
  </tr>
</table>

## Installation

This guide is designed for the latest LTS release of Debian/Ubuntu.

### Prebuilt Archive

Use this path if you want to install a ready-made Ararat UI build.

#### Prerequisites

- A working Incus installation accessible over the network
- A copy of `ararat.tar.gz` from either the latest official release or the bleeding-edge `yerek` build artifact

#### Installation Instructions

1. Download an Ararat UI archive:
   - **Latest official release:** download `ararat.tar.gz` from the [latest GitHub Release](https://github.com/hyecompany/ararat-web/releases/latest). This is the recommended path for most users.
   - **Bleeding edge:** download the `ararat.tar.gz` artifact from a successful `yerek` branch run of the [Build UI workflow](https://github.com/hyecompany/ararat-web/actions/workflows/ui-build.yml). GitHub Actions downloads artifacts as zip files, so unzip the download first to get `ararat.tar.gz`.

2. Extract the archive into Incus's UI directory. Zabbly package users can use `/opt/incus/ui`:

   ```bash
   sudo mkdir -p /opt/incus/ui
   sudo tar -xzf ararat.tar.gz -C /opt/incus/ui
   ```

   Users of other packages can extract Ararat anywhere they prefer, then set `INCUS_UI` in the `incusd` environment to that path.

3. Restart Incus:

   ```bash
   sudo systemctl restart incus
   ```

### Accessing the UI

Simply visit `https://{host}:{port}` (default `8443`) that you set Incus to listen on in your browser, and Hye Ararat will be served! If it is not, restart Incus with `systemctl restart incus` and try visiting again.

### Building From Source

Use this Debian/Ubuntu path if you are developing Ararat or want to build the UI and SPICE console runtime locally.

#### Prerequisites

- A working Incus installation accessible over the network
- Node.js
- Bun
- Rust and Cargo
- `wasm-pack`, used to build the native SPICE console runtime

#### Installation Instructions

Install the system packages needed for the JavaScript and SPICE console builds:

```bash
sudo apt update
sudo apt install -y build-essential curl nodejs
```

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

Install Rust and Cargo:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Reload your shell so the new `bun` and `cargo` commands are available, then install `wasm-pack`:

```bash
cargo install wasm-pack
```

Install Ararat's project dependencies:

```bash
bun install
```

Build the SPICE console runtime, build the web UI, and copy Ararat to Incus's UI directory:

```bash
bun run build-install
```

## License

Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
