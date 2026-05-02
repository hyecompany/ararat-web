/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ConsoleWindowContent from './console-window-content';
import {
  parseBooleanFlag,
  sharedMemoryFastPathFromSearchParams,
} from '../_lib/spice-client/runtime/shared-memory-policy';

const WEBUSB_REDIRECTION_QUERY = 'spice_webusb';
const WEBUSB_REDIRECTION_ALIAS_QUERY = 'webusb';
const DIAGNOSTICS_OVERLAY_QUERY = 'spice_diagnostics';

export default function ConsoleWindowClient() {
  const searchParams = useSearchParams();
  const takeover = searchParams.get('takeover');
  const force = searchParams.get('force');
  const sharedMemoryFastPath =
    sharedMemoryFastPathFromSearchParams(searchParams) ?? false;
  const webUsbRedirection =
    parseBooleanFlag(
      searchParams.get(WEBUSB_REDIRECTION_QUERY) ??
        searchParams.get(WEBUSB_REDIRECTION_ALIAS_QUERY),
    ) ?? false;
  const diagnosticsOverlay =
    parseBooleanFlag(searchParams.get(DIAGNOSTICS_OVERLAY_QUERY)) ?? false;
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsMounted(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  if (!isMounted) {
    return <main className="fixed inset-0 bg-black" />;
  }

  return (
    <ConsoleWindowContent
      autoResize={searchParams.get('resize') !== '0'}
      instanceName={searchParams.get('name')}
      project={searchParams.get('project')}
      sharedMemoryFastPath={sharedMemoryFastPath}
      webUsbRedirection={webUsbRedirection}
      diagnosticsOverlay={diagnosticsOverlay}
      shouldAutoTakeover={takeover === '1' || force === '1'}
    />
  );
}
