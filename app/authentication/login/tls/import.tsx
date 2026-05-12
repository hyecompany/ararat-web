'use client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircleIcon, CircleCheck, InfoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { addCertificate } from '@/app/_lib/certificate';

export default function ImportCertificate() {
  const [trustToken, setTrustToken] = useState('');
  const [addingCertificate, setAddingCertificate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  return (
    <>
      <Alert>
        {success ? (
          <>
            <CircleCheck color="lime" />
            <AlertTitle>Certificate Imported Successfully</AlertTitle>
            <AlertDescription>
              You can now use TLS authentication to log in.
            </AlertDescription>
          </>
        ) : null}
        {!error && !success ? (
          <>
            <InfoIcon />
            <AlertTitle>Certificate Selection Required</AlertTitle>
            <AlertDescription>
              Make sure a client certificate is already selected in your browser
            </AlertDescription>
          </>
        ) : (
          <>
            <AlertCircleIcon color="red" />
            <AlertTitle>Failed to Import Certificate</AlertTitle>
            <AlertDescription>Error: {error}</AlertDescription>
          </>
        )}
      </Alert>
      <p>Generate a trust token to authenticate your client:</p>
      <pre className="bg-gray-800 text-white p-2 rounded-md overflow-x-auto">
        <code>incus config trust add ararat</code>
      </pre>
      <p className="mt-2">Then, paste the trust token here:</p>
      <Input
        placeholder="Trust Token"
        value={trustToken}
        onChange={(e) => setTrustToken(e.target.value)}
      />
      <Button
        className="mt-4"
        disabled={!trustToken}
        loading={addingCertificate}
        onClick={async () => {
          setAddingCertificate(true);
          setError(null);
          try {
            await addCertificate(
              trustToken
                .trim()
                .split(/\r?\n|\r|\n/g)
                .at(-1) || '',
              true,
            );
          } catch (error) {
            if (error instanceof Error) {
              setError(error.message);
            } else {
              setError('An unknown error occurred');
            }
            return;
          } finally {
            setAddingCertificate(false);
          }
          setSuccess(true);
        }}
      >
        Import Certificate
      </Button>
    </>
  );
}
