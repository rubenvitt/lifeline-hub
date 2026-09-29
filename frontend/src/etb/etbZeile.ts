import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';

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
  | { art: 'ausstehend'; schluessel: string; puffer: AusstehenderEintrag }
  | { art: 'abgelehnt'; schluessel: string; puffer: AbgelehnterEintrag };

/**
 * Eigener Schlüsselraum je Sorte.
 *
 * Die `id` eines gepufferten Eintrags ist die Queue-Nummer und kollidiert mit der DB-`id`
 * eines gesendeten — ohne Präfix träfe das Highlight des Deeplinks `?eintrag=` die falsche
 * Zeile. Der Rückfall auf den Zeitstempel deckt den Moment ab, in dem die Queue die Nummer
 * noch nicht vergeben hat.
 */
function ausstehendSchluessel(p: AusstehenderEintrag): string {
  return `ausstehend-${p.id ?? p.erstellt_at}`;
}

function abgelehntSchluessel(p: AbgelehnterEintrag): string {
  return `abgelehnt-${p.id ?? p.abgelehnt_at}`;
}

/**
 * Führt gesendete und gepufferte Einträge zu EINER Chronologie zusammen.
 *
 * Reihenfolge: abgelehnt, dann ausstehend, dann die Serverliste. Beide gepufferten
 * Sorten stehen am KOPF, weil die Liste neueste-zuerst läuft und ein noch nicht
 * gesendeter Eintrag der jüngste ist — und weil ein abgelehnter Eintrag eine Handlung
 * verlangt, ein ausstehender nur Geduld. Die Serverordnung selbst bleibt unangetastet.
 */
export function baueZeilen(args: {
  eintraege: readonly EtbEintragAnzeige[];
  ausstehend: readonly AusstehenderEintrag[];
  abgelehnt: readonly AbgelehnterEintrag[];
}): EtbZeile[] {
  return [
    ...args.abgelehnt.map((puffer): EtbZeile => ({
      art: 'abgelehnt',
      schluessel: abgelehntSchluessel(puffer),
      puffer,
    })),
    ...args.ausstehend.map((puffer): EtbZeile => ({
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
