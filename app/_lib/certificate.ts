import { getBrowserIncusClient } from '../_incus/client';
import type { StandardResponse } from './response.d';

export async function addCertificate(
  token: string,
  publicRequest: boolean,
): Promise<StandardResponse<undefined>> {
  return getBrowserIncusClient().certificates.add(token, publicRequest);
}
