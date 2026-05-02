/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export async function encryptSpiceTicket(
  publicKey: Uint8Array,
  password = '',
) {
  const publicKeyBytes = new Uint8Array(publicKey.byteLength);
  publicKeyBytes.set(publicKey);
  const key = await crypto.subtle.importKey(
    'spki',
    publicKeyBytes.buffer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-1',
    },
    false,
    ['encrypt'],
  );
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      key,
      new TextEncoder().encode(password),
    ),
  );
}
