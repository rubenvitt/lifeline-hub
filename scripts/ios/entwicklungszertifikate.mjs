#!/usr/bin/env node
/**
 * Räumt die Entwicklungszertifikate („Apple Development“) des Teams auf, damit TestFlight-Läufe
 * nicht an Apples Höchstzahl scheitern (LLH-2149). Xcode legt beim Archivieren über den
 * API-Schlüssel (`-allowProvisioningUpdates`, scripts/ios/testflight.sh) auf jedem frischen Runner
 * ein neues Entwicklungszertifikat an und lässt es liegen; nach einigen Läufen bricht das Archiv
 * mit „Your account has reached the maximum number of certificates“ ab.
 *
 *   node scripts/ios/entwicklungszertifikate.mjs vorher --merke <datei>
 *   node scripts/ios/entwicklungszertifikate.mjs nachher --merke <datei>
 *
 * - `vorher` (vor dem Archivieren): widerruft jedes Entwicklungszertifikat, das älter als
 *   ALTER_STUNDEN (Vorgabe 2) ist, und merkt sich die übrigen Kennungen in <datei>. Ein jüngeres
 *   gehört womöglich einem parallelen Lauf (Hülle und Helfer-App laufen getrennt) und bleibt.
 *   Auch Entwicklungszertifikate von einem Mac des Teams sind darunter; Xcode legt dort mit
 *   automatischer Signierung bei Bedarf ein neues an.
 * - `nachher` (nach dem Lauf, auch bei Rot): widerruft jedes Entwicklungszertifikat, das nicht
 *   in <datei> steht, also das im Lauf neu angelegte. Fehlt die Datei, tut es nichts.
 *
 * Verteilungszertifikate und alle anderen Arten bleiben unangetastet: abgefragt werden nur
 * `DEVELOPMENT` und `IOS_DEVELOPMENT`.
 *
 * Umgebung (Secrets wie testflight.sh):
 *   APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_KEY_P8   Pflicht
 *   ALTER_STUNDEN   optional, Mindestalter für `vorher`; Vorgabe 2
 * Selbsttest: entwicklungszertifikate.test.mjs daneben.
 */
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { client } from './testflight-verteilen.mjs';

/** Arten, die Xcode für „Apple Development“ anlegt; Verteilung ist nie darunter. */
export const ARTEN = ['DEVELOPMENT', 'IOS_DEVELOPMENT'];

/** Ausstellungszeit eines Zertifikats aus `certificateContent` (DER, Base64); null, wenn unlesbar. */
export function ausstellung(inhalt) {
  if (!inhalt) return null;
  try {
    return new Date(new X509Certificate(Buffer.from(inhalt, 'base64')).validFrom);
  } catch {
    return null;
  }
}

/** Alle Entwicklungszertifikate mit Kennung, Name und Ausstellungszeit (aus dem Zertifikat). */
export async function entwicklungszertifikate(request, lies = ausstellung) {
  const liste = [];
  let pfad = `/v1/certificates?filter[certificateType]=${ARTEN.join(',')}&limit=200`;
  while (pfad) {
    const antwort = await request('GET', pfad);
    for (const z of antwort.data ?? []) {
      const ausgestellt = lies(z.attributes?.certificateContent);
      liste.push({ id: z.id, name: z.attributes?.displayName || z.attributes?.name || z.id, ausgestellt });
    }
    const weiter = antwort.links?.next;
    pfad = weiter ? weiter.replace(/^https:\/\/api\.appstoreconnect\.apple\.com/, '') : null;
  }
  return liste;
}

async function widerrufe(request, zertifikate, log) {
  for (const z of zertifikate) {
    await request('DELETE', `/v1/certificates/${z.id}`);
    log(`widerrufen: ${z.name} (${z.id})`);
  }
  return zertifikate.map((z) => z.id);
}

/**
 * Vor dem Archivieren: ältere widerrufen, die übrigen merken. Ein Zertifikat ohne lesbare
 * Ausstellungszeit gilt als alt (Apple liefert den Inhalt immer; fehlt er, ist es kein frisches).
 */
export async function vorher({ request, merke, altMs = 2 * 3_600_000, jetzt = Date.now(), lies, log = console.log }) {
  const alle = await entwicklungszertifikate(request, lies);
  const alt = alle.filter((z) => !z.ausgestellt || jetzt - z.ausgestellt.getTime() >= altMs);
  const bleiben = alle.filter((z) => !alt.includes(z));
  const widerrufen = await widerrufe(request, alt, log);
  writeFileSync(merke, JSON.stringify(bleiben.map((z) => z.id)));
  log(`vorher: ${widerrufen.length} widerrufen, ${bleiben.length} jünger als ${altMs / 3_600_000} h behalten`);
  return { widerrufen, behalten: bleiben.map((z) => z.id) };
}

/** Nach dem Lauf: was nicht gemerkt ist, hat dieser Lauf angelegt. Ohne Merkdatei nichts. */
export async function nachher({ request, merke, lies, log = console.log }) {
  if (!existsSync(merke)) {
    log('nachher: keine Merkdatei (Vorlauf fehlte), nichts widerrufen');
    return { widerrufen: [] };
  }
  const bekannt = new Set(JSON.parse(readFileSync(merke, 'utf8')));
  const neu = (await entwicklungszertifikate(request, lies)).filter((z) => !bekannt.has(z.id));
  const widerrufen = await widerrufe(request, neu, log);
  log(`nachher: ${widerrufen.length} im Lauf angelegte widerrufen`);
  return { widerrufen };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const [schritt, schalter, merke] = process.argv.slice(2);
  try {
    if (!['vorher', 'nachher'].includes(schritt) || schalter !== '--merke' || !merke) {
      throw new Error('Aufruf: entwicklungszertifikate.mjs vorher|nachher --merke <datei>');
    }
    for (const name of ['APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_KEY_P8']) {
      if (!env[name]) throw new Error(`${name} fehlt`);
    }
    const request = client({
      keyId: env.APP_STORE_CONNECT_KEY_ID,
      issuerId: env.APP_STORE_CONNECT_ISSUER_ID,
      privateKey: env.APP_STORE_CONNECT_KEY_P8,
    });
    if (schritt === 'vorher') {
      await vorher({ request, merke, altMs: Number(env.ALTER_STUNDEN || 2) * 3_600_000 });
    } else {
      await nachher({ request, merke });
    }
  } catch (err) {
    console.error(`FEHLER: ${err.message}`);
    process.exit(1);
  }
}
