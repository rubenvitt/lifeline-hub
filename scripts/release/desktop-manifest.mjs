#!/usr/bin/env node
/**
 * Update-Manifest der Desktop-Hülle (LFH-721): `latest.json` für den Tauri-Updater.
 *
 *   node scripts/release/desktop-manifest.mjs --dir versand --tag v1.2.0 --repo owner/name
 *
 * Liest die gebauten Update-Archive samt `.sig` aus `--dir` und schreibt dort `latest.json`.
 * Aufgerufen vom Job `desktop-veroeffentlichen` in `.github/workflows/artefakte.yml`; der
 * Selbsttest (`desktop-manifest.test.mjs`) läuft in Schritt 8 von `scripts/check-all.sh`.
 *
 * AUFGENOMMEN WIRD NUR, WAS WIRKLICH AM RELEASE HÄNGT: je Plattform genau ein Archiv der
 * Release-Version MIT nicht leerer Signatur. Eine gescheiterte Plattform fehlt im Manifest —
 * ein Eintrag, dessen Archiv fehlt, ließe jede installierte Hülle ins Leere laden. Ohne ein
 * einziges Paar bricht das Skript ab.
 *
 * Die Dateinamen setzt artefakte.yml beim Einsammeln (`lifeline-hub-desktop-<version>-…`):
 * Tauris eigene Namen tragen Leerzeichen, und GitHub ersetzt die beim Hochladen still durch
 * Punkte — die URL im Manifest zeigte dann auf eine Datei, die es nicht gibt.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

/** Tauri-Plattformschlüssel → Endung des Update-Archivs (nach `-<version>`). */
export const PLATTFORMEN = {
  'darwin-aarch64': '-macos-arm64.app.tar.gz',
  'windows-x86_64': '-windows-x64-setup.exe',
};

const TAG_MUSTER = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;

/**
 * @param {{ dateien: Record<string, string | null>, tag: string, repo: string, jetzt: Date }} e
 *   `dateien`: Dateiname → Inhalt; nur bei `.sig` wird der Inhalt gebraucht (sonst `null`).
 */
export function baueManifest({ dateien, tag, repo, jetzt }) {
  const treffer = TAG_MUSTER.exec(tag);
  if (!treffer) {
    throw new Error(`Kein zulässiger Release-Tag: '${tag}' (erwartet vX.Y.Z[-vorab]).`);
  }
  const version = treffer[1];
  const praefix = `lifeline-hub-desktop-${version}`;
  const platforms = {};
  for (const [plattform, endung] of Object.entries(PLATTFORMEN)) {
    const archive = Object.keys(dateien).filter(
      (name) => name.startsWith(praefix) && name.endsWith(endung),
    );
    if (archive.length > 1) {
      throw new Error(`Mehrere Archive für ${plattform}: ${archive.join(', ')}`);
    }
    const [archiv] = archive;
    if (!archiv || archiv !== `${praefix}${endung}`) continue;
    const signatur = (dateien[`${archiv}.sig`] ?? '').trim();
    if (!signatur) continue;
    platforms[plattform] = {
      signature: signatur,
      url: `https://github.com/${repo}/releases/download/${tag}/${archiv}`,
    };
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error(`keine Plattform mit Archiv und Signatur für ${tag} gefunden.`);
  }
  return {
    version,
    notes: `Lifeline Hub ${version}: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: jetzt.toISOString(),
    platforms,
  };
}

/** Liest `dir`, baut das Manifest und schreibt `dir/latest.json`. */
export function manifestAusVerzeichnis({ dir, tag, repo, jetzt = new Date() }) {
  const dateien = {};
  for (const name of readdirSync(dir)) {
    dateien[name] = name.endsWith('.sig') ? readFileSync(join(dir, name), 'utf8') : null;
  }
  const manifest = baueManifest({ dateien, tag, repo, jetzt });
  writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { dir: { type: 'string' }, tag: { type: 'string' }, repo: { type: 'string' } },
  });
  if (!values.dir || !values.tag || !values.repo) {
    console.error('Aufruf: desktop-manifest.mjs --dir <verzeichnis> --tag vX.Y.Z --repo owner/name');
    process.exit(2);
  }
  const manifest = manifestAusVerzeichnis(values);
  console.log(`latest.json für ${manifest.version}: ${Object.keys(manifest.platforms).join(', ')}`);
}
