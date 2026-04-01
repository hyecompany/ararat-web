'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from 'ui-web/components/accordion';
import { Button } from 'ui-web/components/button';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from 'ui-web/components/dialog';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'ui-web/components/tabs';
import { useEffect, useRef, useState } from 'react';

export default function CreateCertificate() {
  const workerRef = useRef<Worker | null>(null);
  const [generating, setGenerating] = useState(false);
  const [createStep, setCreateStep] = useState('download');
  const [settingPassword, setSettingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordsMatch, setPasswordsMatch] = useState(true);

  useEffect(() => {
    setPasswordsMatch(password === confirmPassword);
  }, [password, confirmPassword]);
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  function download(filename: string, content: string) {
    const blob = new Blob([content], { type: 'application/x-pem-file' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function generateCertificate() {
    // If already generating, do nothing
    if (generating) return;
    setGenerating(true);

    // Lazily create worker
    if (!workerRef.current) {
      // Create a module worker from the local worker file. This uses the bundler to include the worker.
      // The relative path must match the worker file added alongside this component.
      // The `type: 'module'` option lets the worker use ES module imports (node-forge in our case).
      // Note: Next.js / bundlers that support the `new URL(..., import.meta.url)` pattern will bundle this.
      // If your bundler doesn't support it, consider using an inline blob worker or configure worker handling.
      workerRef.current = new Worker(new URL('./certWorker.ts', import.meta.url), {
        type: 'module',
      });
    }

    const worker = workerRef.current;

    const id = Date.now();
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data || {};
      if (data.id !== id) return; // ignore messages from other requests (if any)
      if (data.error) {
        console.error('Certificate generation error:', data.error);
        setGenerating(false);
        return;
      }
      const { pemCert } = data;
      // i want .crt
      if (pemCert) {
        download(`ararat.crt`, pemCert);
      }
      // If worker returned a base64 PFX, download it. Worker generates PFX using the password provided.
      if (data.pfxBase64) {
        try {
          const base64 = data.pfxBase64 as string;
          const binaryString = atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
          const pfxBlob = new Blob([bytes.buffer], {
            type: 'application/x-pkcs12',
          });
          const pfxUrl = URL.createObjectURL(pfxBlob);
          const a = document.createElement('a');
          a.href = pfxUrl;
          a.download = `ararat.pfx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(pfxUrl);
        } catch (err) {
          console.error('Error creating PFX file from worker base64:', err);
        }
      } else if (data.pfxError) {
        console.warn('Worker failed to create PFX:', data.pfxError);
      }
      setGenerating(false);
      // detach this one-time listener
      worker?.removeEventListener('message', onMessage);
      setCreateStep('trust');
    };

    worker.addEventListener('message', onMessage);
    // send the password (may be empty string) so worker can create the PFX with it
    worker.postMessage({ id, password });
  }
  return (
    <>
      <Dialog open={settingPassword} onOpenChange={setSettingPassword}>
        <form>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set a password</DialogTitle>
              <DialogDescription>
                Make your certificate more secure by setting a password.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-3">
                <Label htmlFor="password">Password</Label>
                <Input
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  id="password"
                  name="password"
                  type="password"
                  value={password}
                />
                <div className="text-sm text-gray-400">Password is required for macOS clients</div>
              </div>
              <div className="grid gap-3">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  value={confirmPassword}
                />
                {!passwordsMatch ? (
                  <div className="text-sm text-gray-400">Passwords do not match.</div>
                ) : null}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setSettingPassword(false);
                  generateCertificate();
                }}
                disabled={!!(password || confirmPassword)}
                type="button"
              >
                Skip & Generate
              </Button>
              <Button
                type="submit"
                disabled={!passwordsMatch || !password || !confirmPassword}
                onClick={() => {
                  setSettingPassword(false);
                  generateCertificate();
                }}
              >
                Set Password & Generate
              </Button>
            </DialogFooter>
          </DialogContent>
        </form>
      </Dialog>
      <Accordion type="single" value={createStep} onValueChange={(val) => setCreateStep(val)}>
        <AccordionItem value="download">
          <AccordionTrigger>Generate & Download</AccordionTrigger>
          <AccordionContent>
            <p>Generate & download .crt and .pfx:</p>
            <Button
              className="mt-2"
              onClick={() => setSettingPassword(true)}
              loading={generating}
              disabled={generating}
            >
              Generate & Download Certificate
            </Button>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="trust">
          <AccordionTrigger>Trust</AccordionTrigger>
          <AccordionContent>
            <p>Add the .crt to Incus&apos;s trust store:</p>
            <pre className="overflow-x-auto rounded-md bg-gray-800 p-2 text-white">
              <code>incus config trust add-certificate Downloads/ararat.crt</code>
            </pre>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="import">
          <AccordionTrigger>Import to Browser</AccordionTrigger>
          <AccordionContent>
            <Tabs defaultValue="chrome" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="chrome">Chrome</TabsTrigger>
                <TabsTrigger value="firefox">Firefox</TabsTrigger>
                <TabsTrigger value="edge">Edge</TabsTrigger>
                <TabsTrigger value="macOS">macOS</TabsTrigger>
              </TabsList>
              <TabsContent value="chrome">
                <Accordion type="single" collapsible className="px-4" defaultValue="windows">
                  <AccordionItem value="windows">
                    <AccordionTrigger>Windows</AccordionTrigger>
                    <AccordionContent>
                      <p>1. Go to the following address:</p>
                      <pre className="overflow-x-auto rounded-md bg-gray-800 p-2 text-white">
                        <code>chrome://settings/security</code>
                      </pre>
                      <p>
                        2. Under &quot;Advanced&quot;, press &quot;Manage
                        certificates&quot;
                      </p>
                      <p>
                        3. Click &quot;Import...&quot; then &quot;Next&quot; and select the
                        &quot;ararat.pfx&quot; file previously downloaded.
                      </p>
                      <p>
                        4. Restart Chrome and navigate to Hye Ararat. Select the Ararat certificate.
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="linux">
                    <AccordionTrigger>Linux</AccordionTrigger>
                    <AccordionContent>
                      <p>1. Go to the following address:</p>
                      <pre className="overflow-x-auto rounded-md bg-gray-800 p-2 text-white">
                        <code>chrome://settings/security</code>
                      </pre>
                      <p>
                        2. Click &quot;Import&quot; and select the &quot;ararat.pfx&quot; file
                        previously downloaded. Enter your password, or leave blank if one has not
                        been set.
                      </p>
                      <p>
                        3. Restart Chrome and navigate to Hye Ararat. Select the Ararat certificate.
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </TabsContent>
              <TabsContent value="firefox">
                <p>1. Navigate to:</p>
                <pre className="overflow-x-auto rounded-md bg-gray-800 p-2 text-white">
                  <code>about:preferences#privacy</code>
                </pre>
                <p>
                  2. Scroll down to &quot;Certificates&quot; and click &quot;View
                  Certificates&quot;.
                </p>
                <p>
                  3. Under the &quot;Your Certificates&quot; tab, click &quot;Import...&quot; and
                  select the previously downloaded &quot;ararat.pfx&quot; file. Enter your password
                  when prompted, or leave blank if one has not been set.
                </p>
                <p>4. Restart Firefox and navigate to Hye Ararat. Select the Ararat certificate.</p>
              </TabsContent>
              <TabsContent value="edge">
                <p>1. Go to the following address:</p>
                <pre className="overflow-x-auto rounded-md bg-gray-800 p-2 text-white">
                  <code>edge://certificate-manager/clientcerts</code>
                </pre>
                <p>
                  2. Under &quot;Windows&quot;, press &quot;Manage imported certificates from
                  Windows&quot;.
                </p>
                <p>
                  3. Click &quot;Import...&quot; then &quot;Next&quot;, then &quot;Browse&quot;,
                  then change the file type to &quot;Personal Information Exchange (*.pfx;
                  *.p12)&quot; and select the &quot;ararat.pfx&quot;, then click &quot;Next&quot;.
                </p>
                <p>
                  4. Click &quot;Next&quot;, then enter the password you previously set, then click
                  &quot;Next&quot;
                </p>
                <p>
                  5. Click &quot;Finish&quot;, &quot;Close&quot;, navigate back to Hye Ararat, click
                  the lock or &quot;Not Secure&quot; icon in the address bar, then &quot;Your
                  certificate choices&quot;, then &quot;Change certificate&quot;, then click
                  &quot;Change&quot;, and select the Hye Ararat certificate you just imported.
                </p>
              </TabsContent>
              <TabsContent value="macOS">
                <p>1. Open &quot;Keychain Access&quot; from Applications &gt; Utilities.</p>
                <p>
                  2. Select the &quot;login&quot; keychain, and drag and drop the downloaded
                  &quot;ararat.pfx&quot; file.
                </p>
                <p>
                  3. Restart your browser and navigate to Hye Ararat. Select the Ararat certificate.
                </p>
              </TabsContent>
            </Tabs>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
