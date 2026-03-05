import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : `${normalized}${"=".repeat(4 - pad)}`;
  return Buffer.from(padded, "base64");
}

export function decryptJsonToken(token: string): Record<string, unknown> {
  const secret = process.env.APP_ENCRYPTION_KEY;
  const raw = decodeBase64Url(token);

  if (!secret) {
    return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  }

  try {
    if (raw.length < 29) {
      throw new Error("Encrypted token payload is malformed");
    }

    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const payload = raw.subarray(28);

    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(payload), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
  } catch {
    // Backward compatibility for payloads saved before APP_ENCRYPTION_KEY was configured.
    return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  }
}

export function encryptJsonToken(payload: Record<string, unknown>): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  const plain = Buffer.from(JSON.stringify(payload), "utf8");

  if (!secret) {
    return plain.toString("base64url");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}
