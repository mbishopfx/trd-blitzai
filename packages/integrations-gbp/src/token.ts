import type { GbpApiConfig, GbpTokenSet } from "./types";
import { refreshAccessToken } from "./oauth";

export interface EnsureFreshTokenInput {
  config: GbpApiConfig;
  tokenSet: GbpTokenSet;
  skewSeconds?: number;
}

export async function ensureFreshAccessToken(input: EnsureFreshTokenInput): Promise<GbpTokenSet> {
  const skewSeconds = input.skewSeconds ?? 120;
  const expiresAt = new Date(input.tokenSet.expiresAt).getTime();
  const refreshBefore = Date.now() + skewSeconds * 1000;

  if (Number.isNaN(expiresAt) || expiresAt <= refreshBefore) {
    return refreshAccessToken(input.config, input.tokenSet.refreshToken);
  }

  return input.tokenSet;
}
