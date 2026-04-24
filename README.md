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
      <img alt="image" src="https://github.com/user-attachments/assets/70ae8d74-6f6b-443f-b71e-0406051804cd" />
    </td>
    <td>
      <p align="center"><strong>Devices</strong></p>
      <img alt="image" src="https://github.com/user-attachments/assets/a139e383-4362-461b-a97c-6a798a6d63b5" />
    </td>
  </tr>
</table>

## Installation

This guide is designed for the latest LTS release of Debian/Ubuntu.

### Prerequisites
- A working Incus installation accessible over the network
- Node.JS
- Bun
- A local clone of the repository

### Installation Instructions
1. Install Ararat's core dependencies: `bun install`
2. Build and copy Ararat to Incus's UI directory: `bun run build-install`


### Accessing the UI
Simply visit `https://{host}:{port}` (default `8443`) that you set Incus to listen on in your browser, and Hye Ararat will be served! If it is not, restart Incus with `systemctl restart incus` and try visiting again.

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
