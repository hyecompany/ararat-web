/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

export interface ClientWebUsbDevice {
  vendorId: number;
  productId: number;
  productName?: string | null;
  manufacturerName?: string | null;
  serialNumber?: string | null;
}

interface ClientWebUsbNavigator {
  usb?: {
    requestDevice(options: {
      filters: Array<Record<string, number>>;
    }): Promise<ClientWebUsbDevice>;
  };
}

export function clientWebUsbAvailable(
  scope: Pick<typeof globalThis, 'navigator'> = globalThis,
) {
  return typeof (scope.navigator as ClientWebUsbNavigator | undefined)?.usb
    ?.requestDevice === 'function';
}

export async function requestClientWebUsbDevice(
  navigatorLike: ClientWebUsbNavigator,
  filters: Array<Record<string, number>> = [],
) {
  if (typeof navigatorLike.usb?.requestDevice !== 'function') {
    throw new Error('WebUSB is not available in this browser context.');
  }
  return navigatorLike.usb.requestDevice({ filters });
}
