import { createHmac } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

/** TOTP nach RFC 6238 wie `src/auth/totp/mod.rs`: SHA-1, sechs Stellen, 30 s. */
export function totpCode(base32: string, zeitMs = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const zeichen of base32.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(zeichen).toString(2).padStart(5, '0');
  }
  const schluessel = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(Math.floor(zeitMs / 1000 / 30)));
  const hmac = createHmac('sha1', schluessel).update(zaehler).digest();
  const versatz = hmac[hmac.length - 1] & 0x0f;
  const wert = hmac.readUInt32BE(versatz) & 0x7fffffff;
  return String(wert % 1_000_000).padStart(6, '0');
}

/**
 * Richtet für die angemeldete Person des Kontexts `api` den zweiten Faktor über die API ein
 * (`POST /api/auth/totp/enroll/start` und `…/finish`), ohne die Oberfläche des Profils.
 */
export async function zweitenFaktorEinrichten(
  api: APIRequestContext,
  passwort: string,
): Promise<void> {
  const start = await api.post('/api/auth/totp/enroll/start', { data: { passwort } });
  expect(start.ok(), `TOTP-Einrichtung beginnen: ${start.status()}`).toBe(true);
  const { secret_base32 } = (await start.json()) as { secret_base32: string };
  const ende = await api.post('/api/auth/totp/enroll/finish', {
    data: { code: totpCode(secret_base32) },
  });
  expect(ende.ok(), `TOTP-Einrichtung abschließen: ${ende.status()}`).toBe(true);
}
