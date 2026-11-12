/**
 * Referenz-Client für den Maschinenzugang der öffentlichen API von Lifeline Hub (ADR-0022,
 * Doku `docs/api/maschinenzugang.md`). Nur WebCrypto, keine Abhängigkeit, für Node ab 22. Die API
 * erlaubt kein CORS; Browser-Clients fremder Seiten gibt es nicht.
 *
 * Geprüft gegen `docs/api/machine-auth-testvektoren.json` (Vitest im Frontend,
 * `frontend/src/api/machineClient.vektoren.test.ts`).
 */

export const TYP_REQUEST = 'lifeline-machine+jwt';
export const TYP_RESPONSE = 'lifeline-machine-response+jwt';
export const RESPONSE_HEADER = 'Lifeline-Signature';
export const LIFETIME_S = 60;
export const CLOCK_TOLERANCE_S = 300;
export const SALT = 'lifeline-machine-client/1';

/** Bytes auf einem gewöhnlichen `ArrayBuffer`, wie WebCrypto sie nimmt. */
export type Bytes = Uint8Array<ArrayBuffer>;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const enc = new TextEncoder();

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseB64(text: string): Bytes {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function sha256B64(data: Bytes): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

/** Normalform: groß, ohne Leerzeichen und Bindestriche, O → 0, I/L → 1, genau 16 Zeichen. */
export function normalizeCode(input: string): string {
  let out = '';
  for (const roh of input.toUpperCase()) {
    if (roh === ' ' || roh === '-') continue;
    const c = roh === 'O' ? '0' : roh === 'I' || roh === 'L' ? '1' : roh;
    if (!ALPHABET.includes(c)) throw new Error('Code hat ungültige Zeichen');
    out += c;
  }
  if (out.length !== 16) throw new Error('Code hat nicht 16 Zeichen');
  return out;
}

export interface CodeDerivation {
  lookup: string;
  kRedeemer: Bytes;
  kIssuer: Bytes;
}

async function hkdf(code: string, info: string): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', enc.encode(code), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SALT), info: enc.encode(info) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveCode(code: string): Promise<CodeDerivation> {
  const n = normalizeCode(code);
  return {
    lookup: b64(await hkdf(n, 'suche')),
    kRedeemer: await hkdf(n, 'einloeser'),
    kIssuer: await hkdf(n, 'aussteller'),
  };
}

/** Kennung, dann je Teil seine Länge (u32, Big Endian) und seine UTF-8-Bytes. */
function transcript(label: string, parts: string[]): Bytes {
  const stuecke = [enc.encode(label)];
  for (const p of parts) {
    const b = enc.encode(p);
    const laenge = new Uint8Array(4);
    new DataView(laenge.buffer).setUint32(0, b.length);
    stuecke.push(laenge, b);
  }
  const out = new Uint8Array(stuecke.reduce((n, s) => n + s.length, 0));
  let i = 0;
  for (const s of stuecke) {
    out.set(s, i);
    i += s.length;
  }
  return out;
}

export function transcriptRedeemer(lookup: string, publicKeyB64: string): Bytes {
  return transcript('machine-einloeser', [lookup, publicKeyB64]);
}

export function transcriptIssuer(
  lookup: string,
  publicKeyB64: string,
  instanzId: string,
  instanzPublicKeyB64: string,
  zugangId: string,
): Bytes {
  return transcript('machine-aussteller', [
    lookup,
    publicKeyB64,
    instanzId,
    instanzPublicKeyB64,
    zugangId,
  ]);
}

async function hmacB64(key: Bytes, data: Bytes): Promise<string> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', k, data)));
}

export interface Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
}

export interface RedeemRequest {
  lookup: string;
  public_key: Jwk;
  proof: string;
}

export interface RedeemResponse {
  zugang_id: string;
  instanz_id: string;
  instanz_public_key: Jwk;
  proof: string;
}

/** Schlüsseldatei; der private Schlüssel gehört nur dem Besitzer lesbar abgelegt. */
export interface Credentials {
  zugang_id: string;
  instanz_id: string;
  base_url: string;
  private_key: string;
  public_key: string;
  instanz_public_key: string;
}

/** Neues Schlüsselpaar als Base64url (privat: 32 Bytes Seed, öffentlich: 32 Bytes). */
export async function generateKey(): Promise<{ privateKey: string; publicKey: string }> {
  const paar = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', paar.privateKey);
  return { privateKey: jwk.d!, publicKey: jwk.x! };
}

export async function prepareRedeem(
  code: string,
  publicKeyB64: string,
): Promise<{ derivation: CodeDerivation; request: RedeemRequest }> {
  const derivation = await deriveCode(code);
  const proof = await hmacB64(
    derivation.kRedeemer,
    transcriptRedeemer(derivation.lookup, publicKeyB64),
  );
  return {
    derivation,
    request: {
      lookup: derivation.lookup,
      public_key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyB64 },
      proof,
    },
  };
}

/** Prüft die Antwort aufs Einlösen; wirft, wenn die Instanz den Code nicht kennt. */
export async function finishRedeem(
  derivation: CodeDerivation,
  key: { privateKey: string; publicKey: string },
  baseUrl: string,
  response: RedeemResponse,
): Promise<Credentials> {
  const erwartet = await hmacB64(
    derivation.kIssuer,
    transcriptIssuer(
      derivation.lookup,
      key.publicKey,
      response.instanz_id,
      response.instanz_public_key.x,
      response.zugang_id,
    ),
  );
  if (erwartet !== response.proof) throw new Error('Prüfwert der Instanz passt nicht');
  return {
    zugang_id: response.zugang_id,
    instanz_id: response.instanz_id,
    base_url: baseUrl.replace(/\/+$/, ''),
    private_key: key.privateKey,
    public_key: key.publicKey,
    instanz_public_key: response.instanz_public_key.x,
  };
}

/**
 * Signiert eine Anfrage; liefert den Wert für `Authorization`. `pathAndQuery` genau so, wie er
 * gesendet wird (`/api/v1/me`).
 */
export async function signRequest(
  cred: Credentials,
  method: string,
  pathAndQuery: string,
  body: Bytes,
  now: number,
  jti: string,
): Promise<string> {
  const header = { alg: 'EdDSA', typ: TYP_REQUEST, kid: cred.zugang_id };
  const claims = {
    iss: cred.zugang_id,
    aud: cred.instanz_id,
    iat: now,
    exp: now + LIFETIME_S,
    jti,
    htm: method.toUpperCase(),
    htu: pathAndQuery,
    bh: await sha256B64(body),
  };
  const eingabe = `${b64(enc.encode(JSON.stringify(header)))}.${b64(enc.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', d: cred.private_key, x: cred.public_key },
    'Ed25519',
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, enc.encode(eingabe)));
  return `Machine ${eingabe}.${b64(sig)}`;
}

/** Prüft die Antwortsignatur (Kopf `Lifeline-Signature`); wirft mit dem Grund. */
export async function verifyResponse(
  cred: Credentials,
  token: string,
  requestJti: string,
  status: number,
  body: Bytes,
  now: number,
): Promise<void> {
  const [h, c, s] = token.split('.');
  if (!h || !c || !s) throw new Error('Antwortsignatur unlesbar');
  const header = JSON.parse(new TextDecoder().decode(parseB64(h)));
  if (header.alg !== 'EdDSA' || header.typ !== TYP_RESPONSE) throw new Error('Typ');
  const key = await crypto.subtle.importKey(
    'raw',
    parseB64(cred.instanz_public_key),
    'Ed25519',
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify('Ed25519', key, parseB64(s), enc.encode(`${h}.${c}`));
  if (!ok) throw new Error('Signatur');
  const claims = JSON.parse(new TextDecoder().decode(parseB64(c)));
  if (claims.iss !== cred.instanz_id || claims.aud !== cred.zugang_id) throw new Error('Ziel');
  if (claims.req !== requestJti) throw new Error('Bezug');
  if (claims.status !== status) throw new Error('Status');
  if (claims.bh !== (await sha256B64(body))) throw new Error('Body');
  const lebt =
    claims.exp > claims.iat &&
    claims.exp - claims.iat <= LIFETIME_S &&
    claims.iat <= now + CLOCK_TOLERANCE_S &&
    claims.exp >= now - CLOCK_TOLERANCE_S;
  if (!lebt) throw new Error('Zeit');
}
