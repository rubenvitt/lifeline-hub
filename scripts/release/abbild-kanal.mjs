#!/usr/bin/env node
/**
 * Gleitender Tag am Container-Abbild (LLH-1545): `:latest` für stabil, `:alpha` und `:beta` für
 * die Vorabkanäle — aber nur für das neueste veröffentlichte Release seines Kanals.
 *
 *   node scripts/release/abbild-kanal.mjs --tag v1.0.0-beta.2 --veroeffentlicht tags.txt
 *   node scripts/release/abbild-kanal.mjs --tag v1.0.0-beta.2 --veroeffentlicht tags.txt --neuestes
 *
 * `tags.txt`: die Tags aller veröffentlichten Releases, einer pro Zeile. Gibt den Tag-Namen
 * aus (`latest`, `alpha`, `beta`) oder nichts. Mit `--neuestes`: den neuesten veröffentlichten
 * Release-Tag aus dem Kanal von `--tag` (für die Gegenprobe nach dem Umhängen, siehe unten). Aufgerufen vom Job `freigeben` in
 * `.github/workflows/artefakte.yml`; der Selbsttest (`abbild-kanal.test.mjs`) läuft in Schritt 8
 * von `scripts/check-all.sh`.
 *
 * NUR VORWÄRTS: Wer einen älteren Lauf nachholt („Re-run failed jobs“ Tage später) oder zwei
 * Alpha-Läufe sich überholen, darf `:alpha` nicht auf einen älteren Stand zurückdrehen. Wer
 * `docker pull …:beta` macht, bekäme sonst still eine ältere Beta.
 *
 * Alpha und Beta zählen parallel (`1.0.0-alpha.180` neben `1.0.0-beta.3`); verglichen wird
 * deshalb nur innerhalb des Kanals. Eine andere Vorabkennung (etwa `rc`) bekommt keinen Tag.
 *
 * ÜBERHOLEN: Zwei Freigaben desselben Kanals können gleichzeitig laufen. Die ältere liest die
 * Liste, bevor die neuere veröffentlicht ist, und schreibt ihren Tag womöglich NACH der neueren.
 * Deshalb liest der Workflow nach dem Umhängen die Liste noch einmal (`--neuestes`) und hängt
 * den Tag auf das neueste Release um, wenn das inzwischen ein anderes ist. Wer zuletzt schreibt,
 * liest danach auch zuletzt und sieht jedes Release, dessen Abbild schon einen Tag bekam.
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

/**
 * Der neueste veröffentlichte Release-Tag im Kanal von `tag` (stabil, `alpha` oder `beta`);
 * `tag` selbst, wenn keiner neuer ist.
 * @param {{ tag: string, veroeffentlicht: string[] }} e
 * @returns {string}
 */
export function neuestesImKanal({ tag, veroeffentlicht }) {
  if (!TAG_MUSTER.test(tag)) throw new Error(`Kein zulässiger Release-Tag: '${tag}'.`);
  const kanal = kanalVon(tag);
  return veroeffentlicht
    .filter((t) => TAG_MUSTER.test(t) && kanalVon(t) === kanal)
    .reduce((neuestes, t) => (vergleicheVersion(t, neuestes) > 0 ? t : neuestes), tag);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { tag: { type: 'string' }, veroeffentlicht: { type: 'string' }, neuestes: { type: 'boolean' } },
  });
  if (!values.tag || !values.veroeffentlicht) {
    console.error('Aufruf: abbild-kanal.mjs --tag <vX.Y.Z[-vorab]> --veroeffentlicht <datei> [--neuestes]');
    process.exit(2);
  }
  const veroeffentlicht = readFileSync(values.veroeffentlicht, 'utf8').split('\n').map((z) => z.trim());
  if (values.neuestes) {
    console.log(neuestesImKanal({ tag: values.tag, veroeffentlicht }));
    process.exit(0);
  }
  const name = abbildTag({ tag: values.tag, veroeffentlicht });
  console.error(name ? `${values.tag} → :${name}` : `${values.tag}: kein gleitender Tag`);
  if (name) console.log(name);
}
