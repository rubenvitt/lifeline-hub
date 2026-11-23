#!/usr/bin/env node
/**
 * Update-Kanäle der Android-App (LLH-1989, Entwurf D9): welche Kanäle ein frisch veröffentlichtes
 * Release fortschreibt, ob sein Manifest den jeweiligen Kanal ersetzt und ob seine APK die feste
 * Datei im Kanal ersetzt. Dazu das Manifest selbst.
 *
 *   node scripts/release/android-kanal.mjs --kanaele-fuer 1.0.0-beta.2
 *   node scripts/release/android-kanal.mjs --apk-ersetzen android-alpha --neu neu/android.json \
 *     [--alt alt/android.json]
 *   node scripts/release/android-kanal.mjs --kanal android-beta --neu neu/android.json \
 *     [--alt alt/android.json]
 *   node scripts/release/android-kanal.mjs --manifest --version 1.0.0 --version-code 471234 \
 *     --sha256 <hex> --repo <owner/repo>
 *
 * Die erste Form gibt die Kanäle aus, je einer pro Zeile (keine Zeile: kein Kanal). Die zweite
 * gibt `ja` oder `nein` aus (feste APK ersetzen), die dritte `hochladen` oder `behalten`
 * (Manifest), die vierte `android.json`.
 * Aufgerufen von `.github/workflows/android.yml`; der Selbsttest (`android-kanal.test.mjs`) läuft
 * in Schritt 8 von `scripts/check-all.sh`.
 *
 * Ein Kanal ist ein Release (`android-alpha`, `android-beta`, `android-stabil`) mit dem Manifest
 * `android.json` und der APK unter festem Namen (`lifeline-hub-android.apk`). Die App liest das
 * Manifest nach ihrem Kanal (`android/kern/…/Kanal.kt`). Die URL im Manifest zeigt auf die APK des
 * versionierten Release, nie auf den Kanal.
 *
 * AUCH STABIL HAT EIN KANAL-RELEASE (Abweichung vom Wortlaut von D9, das
 * `releases/latest/download/` nannte): ein stabiles Release wird „latest“, bevor seine APK gebaut
 * ist. Dort stünde dann 15 bis 45 Minuten lang nichts, bei rotem Bau bis zum Nachbau; stabile Apps
 * bekämen 404, der stabile QR-Code ebenso. `android-stabil` behält dagegen den letzten Stand.
 *
 * MANIFEST WIE `desktop-kanal.mjs`: jeder Vorabkanal nur seine eigenen (eine Beta im Alpha-Kanal
 * höbe jede Alpha-App auf sie, und jede weitere Alpha wäre danach „nicht neuer“), stabile
 * Releases schreiben alle drei fort, und nur vorwärts nach SemVer (überholte Läufe, Handstart
 * eines älteren Tags).
 *
 * FESTE APK NUR AUS DEM EIGENEN KANAL UND NUR VORWÄRTS: Ein QR-Code an der Wand führt über sie
 * immer zu einer Fassung dieses Kanals. Ein stabiles Release schreibt in Alpha und Beta nur das
 * Manifest fort, die feste APK nur in `android-stabil`; wer danach über den Alpha-Code
 * installiert, bekommt die letzte Alpha, legt damit den Kanal `alpha` fest und wird über das
 * Manifest auf das stabile Release gehoben (die App leitet den Kanal beim ersten Start aus ihrer
 * Version ab). Ersetzt wird sie nur, wenn das Release zum Kanal gehört UND sein Manifest den Kanal
 * fortschreibt: ein Handstart eines älteren Tags legt keine ältere APK unter den QR-Code.
 *
 * ALPHA NACH EINEM STABILEN RELEASE (ADR-0019): `alpha` zählt nach `1.0.0` als `1.0.0-alpha.N`
 * weiter. Diese Alphas sind nach SemVer älter als `1.0.0`; Manifest UND feste APK von
 * `android-alpha` bleiben deshalb auf `1.0.0` bzw. der letzten Alpha davor stehen, und Alpha-Apps
 * bekommen bis zur ersten Alpha eines höheren Kerns (`1.1.0-alpha.1`) keine Alpha mehr. Das gilt
 * genauso für die Desktop-Hülle (`desktop-kanal.mjs`) und steht in `docs/betrieb/android-app.md`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { kanalVon, vergleicheVersion } from './pr-kommentare.mjs';

const VERSION_MUSTER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const SHA256_MUSTER = /^[0-9a-f]{64}$/;
const REPO_MUSTER = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// `versionCode` ist auf Android ein Int (scripts/android/version.sh).
const VERSION_CODE_GRENZE = 2 ** 31 - 1;

/** Kanal → Release, das ihn trägt. */
export const KANAELE = { alpha: 'android-alpha', beta: 'android-beta', stabil: 'android-stabil' };

function checkVersion(version) {
  if (typeof version !== 'string' || !VERSION_MUSTER.test(version)) {
    throw new Error(`Keine zulässige Version: '${version}'.`);
  }
}

function checkKanal(kanal) {
  if (!Object.values(KANAELE).includes(kanal)) {
    throw new Error(`Unbekannter Kanal: '${kanal}'.`);
  }
}

const isVersionCode = (n) => Number.isInteger(n) && n > 0 && n <= VERSION_CODE_GRENZE;
const apkUrlMuster = (version) =>
  new RegExp(
    `^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/v${version.replaceAll('.', '\\.')}/lifeline-hub-android-${version.replaceAll('.', '\\.')}\\.apk$`,
  );

/** Der Kanal, zu dem ein Tag dieser Version gehört; `null` für eine andere Vorabkennung. */
function kanalDerVersion(version) {
  const vorab = kanalVon(`v${version}`);
  if (vorab === null) return KANAELE.stabil;
  if (vorab === 'alpha' || vorab === 'beta') return KANAELE[vorab];
  return null;
}

/**
 * Die Kanäle, die ein Release dieser Version fortschreibt: eine Alpha den Alpha-, eine Beta den
 * Beta-Kanal, ein stabiles Release alle drei. Eine andere Vorabkennung (etwa `rc`) keinen.
 * @param {string} version  ohne `v`, z. B. `1.0.0-beta.2`
 * @returns {string[]}
 */
export function kanaeleFuer(version) {
  checkVersion(version);
  const eigener = kanalDerVersion(version);
  if (eigener === KANAELE.stabil) return Object.values(KANAELE);
  return eigener === null ? [] : [eigener];
}

/**
 * Ob die APK dieser Version die feste Datei im Kanal ersetzt: nur ein Tag desselben Kanals (im
 * Alpha- und Beta-Kanal also nie ein stabiler).
 * @param {string} kanal  `android-alpha`, `android-beta` oder `android-stabil`
 * @param {string} version  ohne `v`
 */
export function apkErsetzen(kanal, version) {
  checkKanal(kanal);
  checkVersion(version);
  return kanalDerVersion(version) === kanal;
}

/**
 * Ob die APK eines Release die feste Datei im Kanal ersetzt: nur ein Tag desselben Kanals, und nur, wenn sein Manifest den Kanal fortschreibt (`entscheide` → `hochladen`).
 * @param {{ kanal: string, neu: object, alt: object | null }} e  wie bei `entscheide`
 * @returns {{ ersetzen: boolean, grund: string }}
 */
export function apkEntscheidung({ kanal, neu, alt }) {
  const { entscheidung, grund } = entscheide({ kanal, neu, alt });
  if (!apkErsetzen(kanal, neu.version)) {
    return { ersetzen: false, grund: `${neu.version} ist kein Tag von ${kanal}` };
  }
  return { ersetzen: entscheidung === 'hochladen', grund };
}

/**
 * `android.json` eines Release (Entwurf D9); `url` zeigt auf die APK des versionierten Release.
 * @param {{ version: string, versionCode: number, sha256: string, repo: string }} e
 */
export function manifest({ version, versionCode, sha256, repo }) {
  checkVersion(version);
  if (!isVersionCode(versionCode)) throw new Error(`Kein zulässiger version_code: '${versionCode}'.`);
  if (typeof sha256 !== 'string' || !SHA256_MUSTER.test(sha256)) {
    throw new Error(`Keine zulässige sha256 (64 Zeichen 0-9a-f): '${sha256}'.`);
  }
  if (typeof repo !== 'string' || !REPO_MUSTER.test(repo)) {
    throw new Error(`Kein zulässiges Repository (owner/name): '${repo}'.`);
  }
  return {
    version,
    version_code: versionCode,
    url: `https://github.com/${repo}/releases/download/v${version}/lifeline-hub-android-${version}.apk`,
    sha256,
  };
}

function checkManifest(m, wer) {
  if (!m || typeof m.version !== 'string' || !VERSION_MUSTER.test(m.version)) {
    throw new Error(`${wer}: keine zulässige Version im Manifest.`);
  }
  if (!isVersionCode(m.version_code)) throw new Error(`${wer}: version_code ist keine positive Ganzzahl.`);
  if (typeof m.url !== 'string' || !apkUrlMuster(m.version).test(m.url)) {
    throw new Error(`${wer}: url zeigt nicht auf die APK des Release ${m.version}.`);
  }
  if (typeof m.sha256 !== 'string' || !SHA256_MUSTER.test(m.sha256)) {
    throw new Error(`${wer}: sha256 ist keine Prüfsumme.`);
  }
}

/**
 * @param {{ kanal: string, neu: object, alt: object | null }} e  `kanal`: Release des Kanals
 *   (`android-alpha`, `android-beta`, `android-stabil`); `alt`: das Manifest im Kanal, `null` wenn leer.
 * @returns {{ entscheidung: 'hochladen' | 'behalten', grund: string }}
 */
export function entscheide({ kanal, neu, alt }) {
  checkKanal(kanal);
  checkManifest(neu, 'neu');
  if (!kanaeleFuer(neu.version).includes(kanal)) {
    return { entscheidung: 'behalten', grund: `${neu.version} gehört nicht in ${kanal}` };
  }
  if (alt === null) {
    return { entscheidung: 'hochladen', grund: `Kanal leer, ${neu.version} ist der erste Stand` };
  }
  checkManifest(alt, 'Kanal');
  if (vergleicheVersion(`v${neu.version}`, `v${alt.version}`) <= 0) {
    return { entscheidung: 'behalten', grund: `Kanal trägt ${alt.version}, ${neu.version} ist nicht neuer` };
  }
  return { entscheidung: 'hochladen', grund: `${alt.version} → ${neu.version}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const aufruf =
    'Aufruf: android-kanal.mjs --kanaele-fuer <version>\n' +
    '        android-kanal.mjs --apk-ersetzen <android-alpha|android-beta|android-stabil> --neu <android.json> [--alt <android.json>]\n' +
    '        android-kanal.mjs --kanal <android-alpha|android-beta|android-stabil> --neu <android.json> [--alt <android.json>]\n' +
    '        android-kanal.mjs --manifest --version <v> --version-code <n> --sha256 <hex> --repo <owner/repo>';
  const { values } = parseArgs({
    options: {
      'kanaele-fuer': { type: 'string' },
      'apk-ersetzen': { type: 'string' },
      kanal: { type: 'string' },
      neu: { type: 'string' },
      alt: { type: 'string' },
      manifest: { type: 'boolean' },
      version: { type: 'string' },
      'version-code': { type: 'string' },
      sha256: { type: 'string' },
      repo: { type: 'string' },
    },
  });
  if (values['kanaele-fuer'] !== undefined) {
    for (const kanal of kanaeleFuer(values['kanaele-fuer'])) console.log(kanal);
    process.exit(0);
  }
  const readJson = (pfad) => JSON.parse(readFileSync(pfad, 'utf8'));
  const readAlt = () => (values.alt && existsSync(values.alt) ? readJson(values.alt) : null);
  if (values['apk-ersetzen'] !== undefined) {
    if (!values.neu) {
      console.error(aufruf);
      process.exit(2);
    }
    const kanal = values['apk-ersetzen'];
    const { ersetzen, grund } = apkEntscheidung({ kanal, neu: readJson(values.neu), alt: readAlt() });
    console.error(`${kanal} (feste APK): ${grund}`);
    console.log(ersetzen ? 'ja' : 'nein');
    process.exit(0);
  }
  if (values.manifest) {
    const code = values['version-code'];
    const m = manifest({
      version: values.version,
      // Nur Ziffern: `Number('')` wäre 0, `Number('1e3')` 1000.
      versionCode: /^\d+$/.test(code ?? '') ? Number(code) : code,
      sha256: values.sha256,
      repo: values.repo,
    });
    console.log(JSON.stringify(m, null, 2));
    process.exit(0);
  }
  if (!values.neu || !values.kanal) {
    console.error(aufruf);
    process.exit(2);
  }
  const { entscheidung, grund } = entscheide({ kanal: values.kanal, neu: readJson(values.neu), alt: readAlt() });
  console.error(`${values.kanal}: ${grund}`);
  console.log(entscheidung);
}
