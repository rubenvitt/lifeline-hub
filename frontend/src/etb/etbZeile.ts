import type { NeuerEintrag } from '../api/etb';
import type { EtbEintragAnzeige, SpiegelAntragAnzeige } from '../api/types';
import { antragDatenOhneVerweise, type AntragKennung } from '../offline/antragAlsVormerkung';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { etbTyp } from '../theme/statusFarben';

/**
 * Ein ausstehender Eintrag: aus der Warteschlange oder, mit `antrag`, ein Antrag am Spiegel
 * (LLH-1492, Spec `spiegel-antraege`, „ETB-Eintrag am Hub“). Beide haben noch keine Nummer und
 * stehen gleich da; der Chip sagt „beantragt“ statt „vorgemerkt“.
 */
export type AusstehendeEtbZeile = AusstehenderEintrag & { antrag?: AntragKennung };

/**
 * Zeilentyp der ETB-Chronologie: gesendete und gepufferte Einträge in EINER Folge. Fehlte
 * die eigene, gerade erfasste Meldung in der Chronologie, wäre das in einer beweissichernden
 * Unterlage der teuerste Fehlermodus.
 *
 * **Diskriminiertes Union statt eines aufgeweichten `EtbEintragAnzeige`:** ein gepufferter
 * Eintrag hat keine laufende Nummer, keinen Erfassernamen und keine Rückverweise — die vergibt
 * erst der Server. Als optionale Felder getarnt wüsste keine Stelle mehr, ob „keine Nummer"
 * *noch nicht* oder *nicht mehr* heißt.
 */
export type EtbZeile =
  | { art: 'eintrag'; schluessel: string; eintrag: EtbEintragAnzeige }
  | { art: 'ausstehend'; schluessel: string; puffer: AusstehendeEtbZeile }
  | { art: 'abgelehnt'; schluessel: string; puffer: AbgelehnterEintrag };

/**
 * Eigener Schlüsselraum je Sorte.
 *
 * Die `id` eines gepufferten Eintrags ist die Queue-Nummer und kollidiert mit der DB-`id`
 * eines gesendeten — ohne Präfix träfe das Highlight des Deeplinks `?eintrag=` die falsche
 * Zeile. Der Rückfall auf den Zeitstempel deckt den Moment ab, in dem die Queue die Nummer
 * noch nicht vergeben hat.
 */
function ausstehendSchluessel(p: AusstehendeEtbZeile): string {
  if (p.antrag) return `beantragt-${p.antrag.id}`;
  return `ausstehend-${p.id ?? p.erstellt_at}`;
}

/** Auch der Schlüssel des Zeilenfehlers von „Erneut senden“ (`pages/EtbPage.tsx`, LFH-1077). */
export function abgelehntSchluessel(p: AbgelehnterEintrag): string {
  return `abgelehnt-${p.id ?? p.abgelehnt_at}`;
}

/**
 * Führt gesendete und gepufferte Einträge zu EINER Chronologie zusammen.
 *
 * Reihenfolge: abgelehnt, dann ausstehend, dann die Serverliste. Beide gepufferten
 * Sorten stehen am KOPF, weil die Liste neueste-zuerst läuft und ein noch nicht
 * gesendeter Eintrag der jüngste ist — und weil ein abgelehnter Eintrag eine Handlung
 * verlangt, ein ausstehender nur Geduld. Die Serverordnung selbst bleibt unangetastet; die
 * Zeitachse kehrt die ganze Folge erst beim Darstellen um (`funkprotokollFolge` in
 * `components/useFunkprotokollLauf.ts`, LLH-1149), dann stehen die gepufferten ganz unten über
 * der Erfassung, abgelehnte zuletzt.
 */
export function baueZeilen(args: {
  eintraege: readonly EtbEintragAnzeige[];
  ausstehend: readonly AusstehendeEtbZeile[];
  abgelehnt: readonly AbgelehnterEintrag[];
}): EtbZeile[] {
  // Die Puffer kommen aufsteigend aus der Warteschlange (`queueLaden`); hier gilt Serverordnung,
  // neueste zuerst — gekehrt steht dann der jüngste Vorgemerkte direkt über der Erfassung.
  return [
    ...[...args.abgelehnt].reverse().map((puffer): EtbZeile => ({
      art: 'abgelehnt',
      schluessel: abgelehntSchluessel(puffer),
      puffer,
    })),
    ...[...args.ausstehend].reverse().map((puffer): EtbZeile => ({
      art: 'ausstehend',
      schluessel: ausstehendSchluessel(puffer),
      puffer,
    })),
    ...args.eintraege.map((eintrag): EtbZeile => ({
      art: 'eintrag',
      schluessel: `eintrag-${eintrag.id}`,
      eintrag,
    })),
  ];
}

/** Der Antrag trägt einen bekannten Typ: die Daten gingen ungeprüft in den Antrag. */
function hasEtbTyp(daten: unknown): boolean {
  const typ = daten != null && typeof daten === 'object' ? (daten as { typ?: unknown }).typ : null;
  return typeof typ === 'string' && Object.prototype.hasOwnProperty.call(etbTyp, typ);
}

/**
 * Offene ETB-Anträge der Person am Spiegel als ausstehende Zeilen (LLH-1492): Wortlaut aus den
 * erfassten Daten, Zeit der Erfassung; der Verweis auf einen berichtigten Eintrag trägt die
 * Kennung der führenden Instanz und fällt weg. Abgelehnte nicht: die stehen im Hinweisband.
 */
export function etbAntraegeAlsAusstehend(
  antraege: readonly SpiegelAntragAnzeige[],
  benutzerId: number | undefined,
  einsatzId: number,
): AusstehendeEtbZeile[] {
  if (benutzerId == null) return [];
  return antraege
    .filter((a) => a.art === 'etb' && a.zustand !== 'abgelehnt' && hasEtbTyp(a.daten))
    .map((a) => ({
      benutzer_id: benutzerId,
      einsatz_id: einsatzId,
      eintrag: antragDatenOhneVerweise('etb', a.daten) as unknown as NeuerEintrag,
      erstellt_at: a.erfasst_at,
      antrag: { id: a.id, zustand: a.zustand },
    }));
}
