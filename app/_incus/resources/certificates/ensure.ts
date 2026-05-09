import { debugIncusData } from '../../debug';
import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestIncusJson, requestJson } from '../../transport';
import type { Certificate } from '../../types';
import type { StandardResponse } from '@/app/_lib/response.d';

export async function ensureCertificate(
  store: IncusStore,
  requests: RequestRegistry,
  fingerprint: string,
) {
  const item = store.ensureCertificate(fingerprint);
  if (!shouldFetchStoredStatus(item.metadata.status)) return;

  await requests.run(
    `certificates:${fingerprint}:metadata`,
    [resourceKeys.certificateMetadata(fingerprint)],
    async () => {
      try {
        const response = await requestJson<Certificate>(
          `/1.0/certificates/${encodeURIComponent(fingerprint)}`,
        );
        store.update((state) => {
          const certificate = state.certificates.items[fingerprint] ??
            store.ensureCertificate(fingerprint);
          certificate.metadata = { status: 'ready', data: response.metadata };
        }, [resourceKeys.certificateMetadata(fingerprint)]);
      } catch (error) {
        store.update((state) => {
          const certificate = state.certificates.items[fingerprint] ??
            store.ensureCertificate(fingerprint);
          certificate.metadata = {
            ...certificate.metadata,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load certificate.',
          };
        }, [resourceKeys.certificateMetadata(fingerprint)]);
        debugIncusData('certificates.metadata:error', { fingerprint, error });
      }
    },
  );
}

export function createCertificatesResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: (fingerprint: string) => ensureCertificate(store, requests, fingerprint),
    add: async (token: string, publicRequest: boolean) => {
      const response = await requestIncusJson<StandardResponse<undefined>>(
        '/1.0/certificates',
        {
          params: publicRequest ? { public: true } : undefined,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'client',
              trust_token: token,
            }),
          },
        },
      );
      store.update((state) => {
        for (const item of Object.values(state.certificates.items)) {
          if (item.metadata.data) item.metadata.status = 'stale';
        }
      }, Object.keys(store.getSnapshot().state.certificates.items).map(
        resourceKeys.certificateMetadata,
      ));
      return response;
    },
  };
}
