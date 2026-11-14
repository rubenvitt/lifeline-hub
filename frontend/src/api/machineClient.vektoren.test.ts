/**
 * Prüft den TypeScript-Referenz-Client (`docs/api/clients/typescript/machineClient.ts`) gegen die
 * Testvektoren des Maschinenzugangs (LLH-1652, design.md D9). Dieselbe Datei prüfen Server,
 * Rust-Client und Python-Beispiel; ein abweichendes JWS heißt, dass die Doku nicht reicht.
 */
import { describe, expect, it } from 'vitest';
import vektoren from '../../../docs/api/machine-auth-testvektoren.json';
import {
  b64,
  deriveCode,
  finishRedeem,
  parseB64,
  prepareRedeem,
  signRequest,
  verifyResponse,
  verifyWebhook,
  type Credentials,
} from '../../../docs/api/clients/typescript/machineClient';

const enc = new TextEncoder();
const schluessel = {
  privateKey: vektoren.client_private_key,
  publicKey: vektoren.client_public_key,
};

describe('Maschinenzugang: TypeScript-Client gegen die Testvektoren', () => {
  it('leitet aus dem Code dieselben Werte ab und baut dieselbe Einlöse-Anfrage', async () => {
    const d = await deriveCode(vektoren.code);
    expect(d.lookup).toBe(vektoren.redeem_request.lookup);
    const { request } = await prepareRedeem(vektoren.code, vektoren.client_public_key);
    expect(request).toEqual(vektoren.redeem_request);
  });

  it('prüft die Antwort aufs Einlösen und lehnt eine fremde ab', async () => {
    const d = await deriveCode(vektoren.code);
    const antwort = vektoren.redeem_response as Parameters<typeof finishRedeem>[3];
    const cred = await finishRedeem(d, schluessel, 'https://hub.example/', antwort);
    expect(cred.zugang_id).toBe(vektoren.zugang_id);
    expect(cred.base_url).toBe('https://hub.example');
    await expect(
      finishRedeem(d, schluessel, 'https://x', { ...antwort, zugang_id: 'anderer' }),
    ).rejects.toThrow('Prüfwert');
  });

  it('signiert jede Anfrage bytegleich', async () => {
    const cred: Credentials = {
      zugang_id: vektoren.zugang_id,
      instanz_id: vektoren.instanz_id,
      base_url: 'https://hub.example',
      private_key: vektoren.client_private_key,
      public_key: vektoren.client_public_key,
      instanz_public_key: vektoren.instanz_public_key,
    };
    for (const a of vektoren.requests) {
      const auth = await signRequest(cred, a.method, a.path, enc.encode(a.body), a.iat, a.jti);
      expect(auth).toBe(`Machine ${a.jws}`);
    }
  });

  it('prüft die Antwortsignatur der Instanz', async () => {
    const cred: Credentials = {
      zugang_id: vektoren.zugang_id,
      instanz_id: vektoren.instanz_id,
      base_url: 'https://hub.example',
      private_key: vektoren.client_private_key,
      public_key: vektoren.client_public_key,
      instanz_public_key: vektoren.instanz_public_key,
    };
    const r = vektoren.response;
    await verifyResponse(cred, r.jws, r.req, r.status, enc.encode(r.body), r.iat);
    await expect(
      verifyResponse(cred, r.jws, 'andere', r.status, enc.encode(r.body), r.iat),
    ).rejects.toThrow('Bezug');
    expect(b64(parseB64(vektoren.client_public_key))).toBe(vektoren.client_public_key);
  });

  it('prüft Webhook-Zustellungen und meldet je ungültigem Fall den Grund (LLH-1656)', async () => {
    const w = vektoren.webhooks;
    for (const f of w.faelle) {
      const pruefung = verifyWebhook(
        vektoren.instanz_public_key,
        vektoren.instanz_id,
        f.webhook_id,
        f.jws,
        enc.encode(f.body),
        f.now,
      );
      if (f.fehler == null)
        await expect(pruefung, f.name).resolves.toMatchObject({ aud: w.webhook_id });
      else await expect(pruefung, f.name).rejects.toThrow(f.fehler);
    }
  });
});
