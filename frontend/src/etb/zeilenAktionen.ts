/**
 * Aktionen einer Zeile der ETB-Zeitachse aus EINER Quelle (LLH-1597, Spec
 * `datensatz-aktionsmenue`, `openspec/changes/j161rpsm-kontextmenue-etb/design.md` D2): das ⋮ eines
 * gesendeten Eintrags, die Knöpfe einer abgelehnten Zeile und das Kontextmenü beider lesen dieselbe
 * Liste und wählen über dieselbe Funktion. So steht kein Weg nur an einem Ort.
 */
import type { EtbEintragAnzeige } from '../api/types';
import type { MenueEintrag } from '../components/MenueAusloeser';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import type { AbgelehnterEintrag } from '../offline/queue';
import type { EtbZeile } from './etbZeile';

export type ZeilenAktion =
  'berichtigen' | 'wiedervorlage' | 'auftrag' | 'erneut' | 'nurProtokollieren' | 'verwerfen';

/** Welche Wege die Seite anbietet; je Zeitachse gleich, nicht je Zeile. */
export interface ZeilenRechte {
  kannBerichtigen: boolean;
  /** Grund, aus dem „Berichtigen“ gerade gesperrt ist (ein Entwurf sendet noch). */
  berichtigenGesperrt?: string;
  kannWiedervorlage: boolean;
  kannAuftrag: boolean;
  /** Aufträge ohne Freigabe (LFH-1051): gesperrt mit Grund. */
  auftragGesperrt: boolean;
  /** Bietet die Seite „Nur protokollieren“ für abgelehnte Zeilen an? */
  nurProtokollierenAngeboten: boolean;
}

/** Die stabilen Aufrufer einer Zeile — sie lesen den aktuellen Handler der Zeitachse. */
export interface ZeilenAufrufe {
  berichtigen: (e: EtbEintragAnzeige) => void;
  wiedervorlage: (e: EtbEintragAnzeige) => void;
  auftragErteilen: (e: EtbEintragAnzeige) => void;
  erneutSenden: (p: AbgelehnterEintrag) => void;
  verwerfen: (p: AbgelehnterEintrag) => void;
  /** Fehlt, wenn die Seite den Weg nicht anbietet. */
  nurProtokollieren?: (p: AbgelehnterEintrag) => void;
}

/**
 * Einträge einer Zeile. Ein vorgemerkter Eintrag hat keine: er steht noch nicht im Tagebuch,
 * nichts zu berichtigen, nichts zu beauftragen. Eine abgelehnte Zeile trägt ihre Entscheidung;
 * „Verwerfen“ ist unumkehrbar und steht rot hinter dem Trenner, ohne Rückfrage wie am Knopf
 * (abgestimmt mit Ruben am 09.11.2026).
 */
export function zeilenAktionen(z: EtbZeile, r: ZeilenRechte): MenueEintrag<ZeilenAktion>[] {
  if (z.art === 'ausstehend') return [];
  if (z.art === 'abgelehnt') {
    return [
      { key: 'erneut', label: 'Erneut senden' },
      ...(z.puffer.eintrag.in_meldungseingang === true && r.nurProtokollierenAngeboten
        ? [{ key: 'nurProtokollieren' as const, label: 'Nur protokollieren' }]
        : []),
      { key: 'verwerfen', label: 'Verwerfen', gefahr: true },
    ];
  }
  return [
    ...(r.kannBerichtigen
      ? [
          {
            key: 'berichtigen' as const,
            label: r.berichtigenGesperrt ? `Berichtigen (${r.berichtigenGesperrt})` : 'Berichtigen',
            ...(r.berichtigenGesperrt ? { gesperrt: true as const } : {}),
          },
        ]
      : []),
    ...(r.kannWiedervorlage ? [{ key: 'wiedervorlage' as const, label: 'Wiedervorlage' }] : []),
    ...(r.kannAuftrag
      ? [
          r.auftragGesperrt
            ? {
                key: 'auftrag' as const,
                label: `Auftrag erteilen (${KEINE_BERECHTIGUNG})`,
                gesperrt: true as const,
              }
            : { key: 'auftrag' as const, label: 'Auftrag erteilen' },
        ]
      : []),
  ];
}

/** Führt die Wahl aus ⋮, Knopf oder Kontextmenü aus; ein Schlüssel der falschen Zeilenart tut nichts. */
export function fuehreZeilenWahlAus(z: EtbZeile, key: string, a: ZeilenAufrufe): void {
  if (z.art === 'eintrag') {
    if (key === 'berichtigen') a.berichtigen(z.eintrag);
    if (key === 'wiedervorlage') a.wiedervorlage(z.eintrag);
    if (key === 'auftrag') a.auftragErteilen(z.eintrag);
    return;
  }
  if (z.art === 'abgelehnt') {
    if (key === 'erneut') a.erneutSenden(z.puffer);
    if (key === 'nurProtokollieren') a.nurProtokollieren?.(z.puffer);
    if (key === 'verwerfen') a.verwerfen(z.puffer);
  }
}

/**
 * Name des Menüs für Hilfstechnik, gleich für ⋮ und Kontextmenü. Er trägt die laufende Nummer:
 * n gleichnamige Menüs wären per Rolle nicht auseinanderzuhalten. Gepufferte Zeilen haben noch
 * keine Nummer; ihr Name nennt den Zustand.
 */
export function zeilenMenueName(z: EtbZeile): string {
  if (z.art === 'eintrag') return `Aktionen zu Eintrag ${z.eintrag.lfd_nr}`;
  return z.art === 'abgelehnt'
    ? 'Aktionen zu abgelehntem Eintrag'
    : 'Aktionen zu vorgemerktem Eintrag';
}
