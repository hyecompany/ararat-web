import { useCertificateResource } from '@/app/_incus/resources/certificates/hooks';

export function useClientCertificate(id: string | undefined) {
  return useCertificateResource(id);
}
