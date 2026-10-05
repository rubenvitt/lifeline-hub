import type { KommunikationsStelle, Verkehrsart } from './types';

/**
 * Datentypen der taktischen Fernmeldeskizze (LFH-893) — seit dem Typ-Codegen nur noch Aliase aus
 * `types.ts` (Vertrag D14 in `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md`).
 * Neue Importe nehmen `types.ts` direkt; diese Datei hält nur die Namen der Bauzeit (`Verkehr`,
 * `KommunikationsStelleMitKanaelen`) für die vorhandenen Importe, bis sie umgestellt sind.
 */

export type {
  Fernmeldeskizze,
  Komponentenart,
  Schriftfeld,
  SkizzenBereich,
  SkizzenBezug,
  SkizzenBezugArt,
  SkizzenKomponente,
  SkizzenLage,
  SkizzenVerbindung,
  StellenKanal,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
  VsVermerk,
} from './types';

/** Betriebsart einer Verbindung (Wechsel- oder Gegenverkehr); im Schema `Verkehrsart`. */
export type Verkehr = Verkehrsart;

/** Die Stelle des Kommunikationsplans trägt ihre Kanäle seit dem Codegen selbst (`sprechgruppen`). */
export type KommunikationsStelleMitKanaelen = KommunikationsStelle;
