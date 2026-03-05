import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function secretCandidates(secret: string | undefined): string[] {
  if (!secret) {
    return [];
  }
  const trimmed = secret.trim();
  if (!trimmed) {
    return [];
  }
  const candidates: string[] = [];
  for (const candidate of [trimmed, secret, `${trimmed}\n`]) {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

export function encryptJson(payload: Record<string, unknown>): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const [normalizedSecret] = secretCandidates(secret);

  if (!normalizedSecret) {
    return Buffer.from(plain).toString("base64url");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(normalizedSecret), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptJson(token: string): Record<string, unknown> {
  const secret = process.env.APP_ENCRYPTION_KEY;
  const buf = Buffer.from(token, "base64url");
  const candidates = secretCandidates(secret);

  if (!candidates.length) {
    return JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  }

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);

  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(candidate), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]);
      return JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
    } catch {
      // Try alternate secret candidates for backward compatibility.
    }
  }

  return JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
}
