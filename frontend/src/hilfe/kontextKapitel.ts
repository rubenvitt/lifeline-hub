/**
 * Kapitel der Anwenderhilfe zur aktuellen Seite (LLH-1824, `docs/anwender/AGENTS.md`, „Hilfe in
 * der App“). Module nennen ihr Kapitel selbst (`ModulEintrag.hilfeKapitel`); Seiten ohne Modul
 * stehen in {@link KAPITEL_JE_PFAD}.
 *
 * Bewusst OHNE Kapiteltexte (kein Import von `./kapitel`): Kopf, Palette und Provider laden diese
 * Datei im Haupt-Chunk. Wächter: `hauptChunk.guard.test.ts`, `kontextKapitel.guard.test.ts`.
 */

import { modulAusPfad } from '../einsatz/modulRegistry';

/** Kapitel, wenn keine Zuordnung greift: der Aufbau der Oberfläche. */
export const RUECKFALL_KAPITEL = 'einsatz-oberflaeche';

/**
 * Seiten ohne eigenes Modul und Unterseiten, die ein anderes Kapitel haben als ihr Modul. Die erste
 * passende Zeile gewinnt, sie gehen der Registry vor. Im Muster passt `:id` auf genau ein Segment,
 * ein abschließendes `*` auf beliebig viele (auch keins).
 */
export const KAPITEL_JE_PFAD: readonly { muster: string; kapitel: string }[] = [
  // Sektionen der Einsatz-Einstellungen mit eigenem Kapitel (`EINSTELLUNGEN_SEKTIONEN`).
  { muster: '/einsaetze/:id/einstellungen/geraete*', kapitel: 'geraete-koppeln' },
  { muster: '/einsaetze/:id/einstellungen/zugriff*', kapitel: 'rechte-im-einsatz' },
  { muster: '/einsaetze/:id/einstellungen/aufbewahrung*', kapitel: 'aufbewahrung' },
  { muster: '/einsaetze/:id/einstellungen/abloesung*', kapitel: 'abloesung' },
  { muster: '/einsaetze', kapitel: 'einsatz-oberflaeche' },
  { muster: '/neuigkeiten', kapitel: 'neuigkeiten' },
  { muster: '/planungen*', kapitel: 'vorplanung' },
  { muster: '/profil', kapitel: 'profil-sicherheit' },
  { muster: '/benachrichtigungen', kapitel: 'einsatz-oberflaeche' },
  { muster: '/admin/benutzer*', kapitel: 'benutzer' },
  { muster: '/admin/stammdaten*', kapitel: 'stammdaten' },
  { muster: '/admin/demo-daten*', kapitel: 'demo-daten' },
  { muster: '/admin/aufbewahrung*', kapitel: 'aufbewahrung' },
  { muster: '/admin/zugangsprotokoll*', kapitel: 'zugangsprotokoll' },
  { muster: '/admin/einstellungen/anbindungen*', kapitel: 'anbindungen' },
  { muster: '/admin/einstellungen/instanzkopplung*', kapitel: 'instanzkopplung' },
  { muster: '/admin/karten*', kapitel: 'karten' },
  { muster: '/admin*', kapitel: 'verwaltung' },
];

function segmente(pfad: string): string[] {
  return pfad.split('/').filter(Boolean);
}

function passt(muster: string, teile: readonly string[]): boolean {
  const rest = muster.endsWith('*');
  const m = segmente(rest ? muster.slice(0, -1) : muster);
  if (rest ? teile.length < m.length : teile.length !== m.length) return false;
  return m.every((s, i) => s === ':id' || s === teile[i]);
}

/** Slug des Kapitels zur Seite unter `pfad` (ohne Query); nie leer. */
export function kapitelFuerPfad(pfad: string): string {
  const teile = segmente(pfad);
  const zeile = KAPITEL_JE_PFAD.find((e) => passt(e.muster, teile));
  if (zeile) return zeile.kapitel;
  return modulAusPfad(pfad)?.hilfeKapitel ?? RUECKFALL_KAPITEL;
}
