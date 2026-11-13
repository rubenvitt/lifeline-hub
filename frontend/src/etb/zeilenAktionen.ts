/**
 * Aktionen einer Zeile der ETB-Zeitachse aus EINER Quelle (LLH-1597, Spec
 * `datensatz-aktionsmenue`, `openspec/changes/archive/2026-11-09-j161rpsm-kontextmenue-etb/design.md` D2): das ⋮ eines
 * gesendeten Eintrags, die Knöpfe einer abgelehnten Zeile und das Kontextmenü beider lesen dieselbe
 * Liste und wählen über dieselbe Funktion. So steht kein Weg nur an einem Ort.
 */
import type { EtbEintragAnzeige } from '../api/types';
import type { MenueEintrag } from '../components/MenueAusloeser';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import type { AbgelehnterEintrag } from '../offline/queue';
import type { EtbZeile } from './etbZeile';
import type { Vermerk } from './vermerke';

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
  /** Sprung auf das Ziel eines Vermerks (Spaltenzeile, `zeilenMenue`). */
  oeffne?: (pfad: string) => void;
  /** Datei eines Vermerks herunterladen (Anhang, Dokument). */
  herunterladen?: (datei: NonNullable<Vermerk['datei']>) => void;
}

/**
 * Was eine Zeile im Menü zusätzlich nennt, weil sie es nicht zeigt (Spec
 * `etb-zeitachse-darstellung`, „Spaltenzeile in kompakter Dichte“ und „Vermerke in eigener
 * Spalte“): die Spaltenzeile ihre Vermerke und den Verfasser, die Handschirm-Zeile den Verfasser.
 */
export interface ZeilenZusatz {
  vermerke?: readonly Vermerk[];
  verfasser?: string;
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

const VERMERK = 'vermerk:';

/**
 * Die ganze Liste des ⋮ und des Kontextmenüs: die Handlungen ({@link zeilenAktionen}), dahinter,
 * was die Zeile nicht zeigt ({@link ZeilenZusatz}) — Verweise und Dateien als Sprung bzw.
 * Herunterladen, Marken (Nachtrag) und der Verfasser als Angabe ohne Wirkung (gesperrt). EINE
 * Liste für ⋮ und Kontextmenü; ob die Zeile ein Kontextmenü trägt, entscheiden weiter allein die
 * Handlungen (ohne sie bleibt das Browsermenü).
 */
export function zeilenMenue(
  z: EtbZeile,
  r: ZeilenRechte,
  zusatz?: ZeilenZusatz,
): MenueEintrag<string>[] {
  const aktionen: MenueEintrag<string>[] = zeilenAktionen(z, r);
  if (z.art !== 'eintrag' || zusatz == null) return aktionen;
  return [
    ...aktionen,
    ...(zusatz.vermerke ?? []).map((v): MenueEintrag<string> => ({
      key: `${VERMERK}${v.schluessel}`,
      label: v.datei ? `${v.text} herunterladen` : v.pfad ? `${v.text} öffnen` : v.text,
      ...(v.datei || v.pfad ? {} : { gesperrt: true as const }),
    })),
    ...(zusatz.verfasser
      ? [{ key: 'verfasser', label: `Verfasser: ${zusatz.verfasser}`, gesperrt: true as const }]
      : []),
  ];
}

/** Führt die Wahl aus ⋮, Knopf oder Kontextmenü aus; ein Schlüssel der falschen Zeilenart tut nichts. */
export function fuehreZeilenWahlAus(
  z: EtbZeile,
  key: string,
  a: ZeilenAufrufe,
  zusatz?: ZeilenZusatz,
): void {
  if (key.startsWith(VERMERK)) {
    const v = zusatz?.vermerke?.find((x) => `${VERMERK}${x.schluessel}` === key);
    if (v?.pfad) a.oeffne?.(v.pfad);
    else if (v?.datei) a.herunterladen?.(v.datei);
    return;
  }
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
