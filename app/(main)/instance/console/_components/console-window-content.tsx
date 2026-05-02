/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import { use, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Spinner } from 'ui-web/components/spinner';
import { InstanceContext, InstanceProviderForName } from '../../_context/instance';
import {
  getSpiceStreamingTuningStatus,
  instanceHasQxlGraphics,
} from '../_lib/qxl-graphics';

const GraphicalConsoleView = dynamic(
  () => import('./graphical-console-view'),
  { ssr: false },
);

export default function ConsoleWindowContent({
  autoResize,
  instanceName,
  sharedMemoryFastPath,
  webUsbRedirection,
  diagnosticsOverlay,
  shouldAutoTakeover,
}: {
  autoResize: boolean;
  instanceName: string | null;
  sharedMemoryFastPath: boolean;
  webUsbRedirection: boolean;
  diagnosticsOverlay: boolean;
  shouldAutoTakeover: boolean;
}) {
  return (
    <InstanceProviderForName name={instanceName}>
      <ConsoleWindowInner
        autoResize={autoResize}
        sharedMemoryFastPath={sharedMemoryFastPath}
        webUsbRedirection={webUsbRedirection}
        diagnosticsOverlay={diagnosticsOverlay}
        shouldAutoTakeover={shouldAutoTakeover}
      />
    </InstanceProviderForName>
  );
}

function ConsoleWindowInner({
  autoResize,
  sharedMemoryFastPath,
  webUsbRedirection,
  diagnosticsOverlay,
  shouldAutoTakeover,
}: {
  autoResize: boolean;
  sharedMemoryFastPath: boolean;
  webUsbRedirection: boolean;
  diagnosticsOverlay: boolean;
  shouldAutoTakeover: boolean;
}) {
  const { name, instance, instanceClass, isLoading, isError } =
    use(InstanceContext);
  const [forceTakeoverToken, setForceTakeoverToken] = useState(0);
  const [consoleInUseMessage, setConsoleInUseMessage] = useState<string | null>(
    null,
  );
  const ignoreControllerChange = useCallback(() => {}, []);
  const isVirtualMachine = instance?.type === 'virtual-machine';
  const qxlFrameBandsAllowed = instanceHasQxlGraphics(instance);
  const spiceStreamingTuning = getSpiceStreamingTuningStatus(instance);

  const handleConsoleInUse = useCallback(
    (message: string) => {
      if (shouldAutoTakeover) {
        setForceTakeoverToken((current) => current + 1);
        return;
      }
      setConsoleInUseMessage(message);
    },
    [shouldAutoTakeover],
  );

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <style jsx global>{`
        [data-sonner-toaster] {
          display: none !important;
        }
      `}</style>
      {!name ? (
        <ConsoleWindowMessage
          title="Missing instance"
          message="The name query parameter is required."
        />
      ) : isLoading && !instance ? (
        <div className="flex h-svh items-center justify-center">
          <Spinner className="size-8" />
        </div>
      ) : isError || !instance ? (
        <ConsoleWindowMessage
          title="Instance unavailable"
          message={isError?.message ?? 'Instance not found.'}
        />
      ) : !isVirtualMachine ? (
        <ConsoleWindowMessage
          title="Graphical console unavailable"
          message="Only virtual machines expose the graphical SPICE console."
        />
      ) : (
        <>
          <GraphicalConsoleView
            enabled
            forceTakeoverToken={forceTakeoverToken}
            instanceClass={instanceClass}
            onConsoleInUse={handleConsoleInUse}
            onControllerChange={ignoreControllerChange}
            autoResize={autoResize}
            sharedMemoryFastPath={sharedMemoryFastPath}
            webUsbRedirection={webUsbRedirection}
            qxlFrameBands={qxlFrameBandsAllowed}
            spiceStreamingTuning={spiceStreamingTuning}
            showDiagnosticsOverlay={diagnosticsOverlay}
            showStatusOverlay={false}
            variant="standalone"
          />
          {consoleInUseMessage && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
              <div className="max-w-md rounded-md border border-white/20 bg-black p-4 text-sm shadow-lg">
                <p className="font-medium">Console already in use</p>
                <p className="mt-2 text-white/70">{consoleInUseMessage}</p>
                <button
                  type="button"
                  className="mt-4 rounded bg-white px-3 py-2 font-medium text-black"
                  onClick={() => {
                    setConsoleInUseMessage(null);
                    setForceTakeoverToken((current) => current + 1);
                  }}
                >
                  Take over console
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function ConsoleWindowMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="flex h-svh items-start p-4">
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}
