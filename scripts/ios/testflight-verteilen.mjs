#!/usr/bin/env node
/**
 * Verteilt einen hochgeladenen Build der iOS-App an die TestFlight-Gruppen seines Kanals
 * (LLH-1988, ADR-0078). Übernommen aus Vault Cockpit (`ios/scripts/testflight-distribute.js`).
 *
 *   TAG=v1.0.0-alpha.196 BUILD_NUMMER=202611221005 ASC_KEY_PATH=… node scripts/ios/testflight-verteilen.mjs
 *
 * Ablauf: App suchen → Gruppen des Kanals prüfen, fehlende anlegen (vor dem Warten, damit ein
 * Fehler nicht erst nach einer halben Stunde auffällt) → warten, bis Apple den Build verarbeitet
 * hat → „Was testen“ setzen → an die Gruppen hängen → bei einer externen Gruppe zur
 * Beta-Prüfung einreichen, sofern noch keine läuft.
 *
 * Kanäle und Gruppen stehen fest hier (Entscheidung 22.11.2026): `alpha` → Intern, `beta` und
 * `main` → Intern und Extern. Ein Alpha-Build erreicht nie eine externe Gruppe.
 *
 * Umgebung:
 *   APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID   Pflicht (Secrets wie testflight.sh)
 *   ASC_KEY_PATH     Pflicht, Pfad der .p8-Datei (ios.yml legt sie mit Rechten 600 ab)
 *   TAG              Pflicht, freigegebener Release-Tag
 *   BUILD_NUMMER     Pflicht, CFBundleVersion des Builds (Ausgabe `build` von testflight.sh)
 *   NOTIZEN_DATEI    optional, Release-Notizen (Markdown) für „Was testen“
 *   WARTE_MINUTEN    optional, so lange auf die Verarbeitung warten; Vorgabe 45
 * Selbsttest: testflight-verteilen.test.mjs daneben.
 */
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com';
const BUNDLE_ID = 'dev.rubeen.lifeline.ios';
const WAS_TESTEN_MAX = 4000;

/** Feste Gruppen: Name → intern? */
const GRUPPEN = { Intern: true, Extern: false };
const KANAL_GRUPPEN = { alpha: ['Intern'], beta: ['Intern', 'Extern'], main: ['Intern', 'Extern'] };

const b64url = (wert) => Buffer.from(typeof wert === 'string' ? wert : JSON.stringify(wert)).toString('base64url');

/** JWT für die API (ES256), 15 Minuten gültig (Apple erlaubt höchstens 20). */
export function token({ keyId, issuerId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const ohne = `${b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64url({ iss: issuerId, iat, exp: iat + 15 * 60, aud: 'appstoreconnect-v1' })}`;
  const signatur = sign('sha256', Buffer.from(ohne), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${ohne}.${signatur.toString('base64url')}`;
}

/** `request(method, path, body)` gegen die API; wirft bei Fehlern mit Status und Apples Begründung. */
export function client({ keyId, issuerId, privateKey, fetch = globalThis.fetch }) {
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token({ keyId, issuerId, privateKey })}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const grund = json?.errors?.map((e) => e.detail || e.title).join('; ') || text;
      throw Object.assign(new Error(`${method} ${path}: ${res.status} ${grund}`), { status: res.status });
    }
    return json;
  };
}

/** Kanal eines Release-Tags; ein anderer Vorabkanal (`-rc.1`) gehört in keinen. */
export function kanal(tag) {
  const m = /^v\d+\.\d+\.\d+(?:-(alpha|beta)\.\d+)?$/.exec(tag ?? '');
  if (!m) throw new Error(`'${tag}' gehört in keinen TestFlight-Kanal: erwartet vX.Y.Z, vX.Y.Z-beta.N oder vX.Y.Z-alpha.N`);
  return m[1] ?? 'main';
}

export function gruppenFuer(k) {
  return [...KANAL_GRUPPEN[k]];
}

/** Markdown der Release-Notizen als Klartext: TestFlight zeigt „Was testen“ ohne Formatierung. */
function klartext(markdown) {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** „Was testen“: oben die volle Version (TestFlight zeigt nur „1.0.0 (Build)“), dann die Notizen. */
export function wasTesten({ version, notizen = '' }) {
  const text = [`Lifeline ${version}`, klartext(notizen)].filter(Boolean).join('\n\n');
  return text.length > WAS_TESTEN_MAX ? `${text.slice(0, WAS_TESTEN_MAX - 1)}…` : text;
}

const q = (params) => new URLSearchParams(params).toString();

async function gruppeSichern({ request, appId, vorhanden, name, log }) {
  const intern = GRUPPEN[name];
  const da = vorhanden.find((g) => g.attributes.name === name);
  if (da) {
    if (Boolean(da.attributes.isInternalGroup) !== intern) {
      throw new Error(`Gruppe „${name}“ ist ${da.attributes.isInternalGroup ? 'intern' : 'extern'}, erwartet ${intern ? 'intern' : 'extern'}`);
    }
    return da;
  }
  // Intern ohne Zugriff auf alle Builds: dort landet nur, was dieses Skript zuweist.
  const attributes = intern
    ? { name, isInternalGroup: true, hasAccessToAllBuilds: false }
    : { name, isInternalGroup: false, publicLinkEnabled: false };
  const { data } = await request('POST', '/v1/betaGroups', {
    data: { type: 'betaGroups', attributes, relationships: { app: { data: { type: 'apps', id: appId } } } },
  });
  log(`Gruppe „${name}“ angelegt (${intern ? 'intern' : 'extern'}); Tester trägt man in App Store Connect ein`);
  return data;
}

export async function verteilen({
  request, bundleId = BUNDLE_ID, buildNummer, gruppen, wasTesten: text = '', sprache = 'de-DE',
  warteMs = 45 * 60_000, pruefMs = 30_000, schlafe = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log,
}) {
  const apps = await request('GET', `/v1/apps?${q({ 'filter[bundleId]': bundleId })}`);
  const app = apps.data.find((a) => a.attributes.bundleId === bundleId);
  if (!app) throw new Error(`App ${bundleId} fehlt in App Store Connect`);

  const vorhanden = (await request('GET', `/v1/apps/${app.id}/betaGroups?limit=200`)).data;
  const ziele = [];
  for (const name of gruppen) ziele.push(await gruppeSichern({ request, appId: app.id, vorhanden, name, log }));

  const build = await aufBuildWarten({ request, appId: app.id, buildNummer, warteMs, pruefMs, schlafe, log });

  const was = text.trim().slice(0, WAS_TESTEN_MAX);
  if (was) {
    const sprachen = (await request('GET', `/v1/builds/${build.id}/betaBuildLocalizations`)).data;
    for (const s of sprachen) {
      await request('PATCH', `/v1/betaBuildLocalizations/${s.id}`, {
        data: { type: 'betaBuildLocalizations', id: s.id, attributes: { whatsNew: was } },
      });
    }
    if (!sprachen.length) {
      await request('POST', '/v1/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: sprache, whatsNew: was },
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
    }
    log('„Was testen“ gesetzt');
  }

  for (const g of ziele) {
    await request('POST', `/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
    log(`An Gruppe „${g.attributes.name}“ gehängt`);
  }

  // Externe Tester sehen den Build erst nach der Beta-Prüfung; weitere Builds derselben Version
  // gibt Apple meist sofort frei. Fehlen die Testinformationen, nennt Apples Antwort sie.
  if (ziele.some((g) => !g.attributes.isInternalGroup)) {
    const laufend = await request('GET', `/v1/builds/${build.id}/betaAppReviewSubmission`).then(
      (res) => res?.data,
      (err) => { if (err.status === 404) return null; throw err; },
    );
    if (laufend) {
      log(`Beta-Prüfung läuft schon (${laufend.attributes.betaReviewState})`);
    } else {
      await request('POST', '/v1/betaAppReviewSubmissions', {
        data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
      });
      log('Zur Beta-Prüfung eingereicht');
    }
  }
  return build;
}

/** Der Build taucht erst einige Minuten nach dem Upload auf und ist dann eine Weile PROCESSING. */
async function aufBuildWarten({ request, appId, buildNummer, warteMs, pruefMs, schlafe, log }) {
  const pfad = `/v1/builds?${q({ 'filter[app]': appId, 'filter[version]': buildNummer, 'filter[preReleaseVersion.platform]': 'IOS', limit: '1' })}`;
  for (let gewartet = 0; ; gewartet += pruefMs) {
    const [build] = (await request('GET', pfad)).data;
    const zustand = build?.attributes.processingState;
    if (zustand === 'VALID') {
      log(`Build ${buildNummer} verarbeitet`);
      return build;
    }
    if (zustand === 'FAILED' || zustand === 'INVALID') throw new Error(`Build ${buildNummer}: ${zustand}`);
    if (gewartet >= warteMs) {
      throw new Error(`Build ${buildNummer} nach ${Math.round(warteMs / 60_000)} Minuten nicht verarbeitet (${zustand ?? 'nicht gefunden'})`);
    }
    log(`Build ${buildNummer}: ${zustand ?? 'noch nicht da'}, warte …`);
    await schlafe(pruefMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  try {
    for (const name of ['APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'ASC_KEY_PATH', 'TAG', 'BUILD_NUMMER']) {
      if (!env[name]) throw new Error(`${name} fehlt`);
    }
    const k = kanal(env.TAG);
    const notizen = env.NOTIZEN_DATEI ? readFileSync(env.NOTIZEN_DATEI, 'utf8') : '';
    const request = client({
      keyId: env.APP_STORE_CONNECT_KEY_ID,
      issuerId: env.APP_STORE_CONNECT_ISSUER_ID,
      privateKey: readFileSync(env.ASC_KEY_PATH, 'utf8'),
    });
    console.log(`Kanal ${k} → ${gruppenFuer(k).join(', ')}`);
    await verteilen({
      request,
      buildNummer: env.BUILD_NUMMER,
      gruppen: gruppenFuer(k),
      wasTesten: wasTesten({ version: env.TAG.slice(1), notizen }),
      warteMs: Number(env.WARTE_MINUTEN || 45) * 60_000,
    });
  } catch (err) {
    console.error(`FEHLER: ${err.message}`);
    process.exit(1);
  }
}
