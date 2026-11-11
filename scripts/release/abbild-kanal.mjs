#!/usr/bin/env node
/**
 * Gleitender Tag am Container-Abbild (LLH-1545): `:latest` für stabil, `:alpha` und `:beta` für
 * die Vorabkanäle — aber nur für das neueste veröffentlichte Release seines Kanals.
 *
 *   node scripts/release/abbild-kanal.mjs --tag v1.0.0-beta.2 --veroeffentlicht tags.txt
 *
 * `tags.txt`: die Tags aller veröffentlichten Releases, einer pro Zeile. Gibt den Tag-Namen
 * aus (`latest`, `alpha`, `beta`) oder nichts. Aufgerufen vom Job `freigeben` in
 * `.github/workflows/artefakte.yml`; der Selbsttest (`abbild-kanal.test.mjs`) läuft in Schritt 8
 * von `scripts/check-all.sh`.
 *
 * NUR VORWÄRTS: Wer einen älteren Lauf nachholt („Re-run failed jobs“ Tage später) oder zwei
 * Alpha-Läufe sich überholen, darf `:alpha` nicht auf einen älteren Stand zurückdrehen. Wer
 * `docker pull …:beta` macht, bekäme sonst still eine ältere Beta.
 *
 * Alpha und Beta zählen parallel (`1.0.0-alpha.180` neben `1.0.0-beta.3`); verglichen wird
 * deshalb nur innerhalb des Kanals. Eine andere Vorabkennung (etwa `rc`) bekommt keinen Tag.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { kanalVon, vergleicheVersion } from './pr-kommentare.mjs';

const TAG_MUSTER = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const KANAL_TAG = { alpha: 'alpha', beta: 'beta' };

/**
 * @param {{ tag: string, veroeffentlicht: string[] }} e
 * @returns {string | null}  `latest`, `alpha`, `beta` oder `null`
 */
export function abbildTag({ tag, veroeffentlicht }) {
  if (!TAG_MUSTER.test(tag)) throw new Error(`Kein zulässiger Release-Tag: '${tag}'.`);
  const kanal = kanalVon(tag);
  const name = kanal === null ? 'latest' : (KANAL_TAG[kanal] ?? null);
  if (name === null) return null;
  const neuer = veroeffentlicht.some(
    (t) => TAG_MUSTER.test(t) && kanalVon(t) === kanal && vergleicheVersion(t, tag) > 0,
  );
  return neuer ? null : name;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { tag: { type: 'string' }, veroeffentlicht: { type: 'string' } } });
  if (!values.tag || !values.veroeffentlicht) {
    console.error('Aufruf: abbild-kanal.mjs --tag <vX.Y.Z[-vorab]> --veroeffentlicht <datei>');
    process.exit(2);
  }
  const veroeffentlicht = readFileSync(values.veroeffentlicht, 'utf8').split('\n').map((z) => z.trim());
  const name = abbildTag({ tag: values.tag, veroeffentlicht });
  console.error(name ? `${values.tag} → :${name}` : `${values.tag}: kein gleitender Tag`);
  if (name) console.log(name);
}
