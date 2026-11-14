/**
 * Aktionen einer Zeile der ETB-Zeitachse aus EINER Quelle (LLH-1597, Spec
 * `datensatz-aktionsmenue`, `openspec/changes/archive/2026-11-09-j161rpsm-kontextmenue-etb/design.md` D2): das ⋮ eines
 * gesendeten Eintrags, die Knöpfe einer abgelehnten Zeile und das Kontextmenü beider lesen dieselbe
 * Liste und wählen über dieselbe Funktion. So steht kein Weg nur an einem Ort.
 */
import type { EtbEintragAnzeige } from '../api/types';
import { ORIGINAL_TEXT, hatServerVorschau, istBildMime } from '../api/anhangFassung';
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
  /** Großansicht eines Bild-Anhangs (Review L1). */
  vorschau?: (datei: NonNullable<Vermerk['datei']>) => void;
  /** Original eines Bild-Anhangs mit Standort herunterladen (Review L1). */
  original?: (datei: NonNullable<Vermerk['datei']>) => void;
}

/**
 * Was eine Zeile im Menü zusätzlich nennt, weil sie es nicht zeigt (Spec
 * `etb-zeitachse-darstellung`, „Spaltenzeile in kompakter Dichte“ und „Vermerke in eigener
 * Spalte“): die Spaltenzeile ihre Vermerke und den Verfasser, die Handschirm-Zeile den Verfasser.
 */
export interface ZeilenZusatz {
  vermerke?: readonly Vermerk[];
  verfasser?: string;
  /** Darf die Person Originale laden (`useDarfOriginalLaden`)? Dann nennt ein Bild sein Original. */
  darfOriginal?: boolean;
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
const VORSCHAU = 'vorschau:';
const ORIGINAL = 'original:';

/**
 * Ein Vermerk im Menü; ein Bild-Anhang dazu mit „Vorschau“ und, wer darf, „Original (mit
 * Standort)“ (Review L1): die Spaltenzeile zeigt Vorschaubild und Original erst nach „+n“, bei
 * einem einzelnen Foto gar nicht. So bleibt beides an jeder Zeile erreichbar.
 */
function vermerkEintraege(v: Vermerk, darfOriginal: boolean): MenueEintrag<string>[] {
  const eintrag: MenueEintrag<string> = {
    key: `${VERMERK}${v.schluessel}`,
    label: v.datei ? `${v.text} herunterladen` : v.pfad ? `${v.text} öffnen` : v.text,
    ...(v.datei || v.pfad ? {} : { gesperrt: true as const }),
  };
  const d = v.datei;
  if (d == null) return [eintrag];
  return [
    eintrag,
    ...(hatServerVorschau(d.mime)
      ? [{ key: `${VORSCHAU}${v.schluessel}`, label: `Vorschau: ${d.dateiname}` }]
      : []),
    ...(darfOriginal && istBildMime(d.mime)
      ? [
          {
            key: `${ORIGINAL}${v.schluessel}`,
            label: `${ORIGINAL_TEXT}: ${d.dateiname} herunterladen`,
          },
        ]
      : []),
  ];
}

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
    ...(zusatz.vermerke ?? []).flatMap((v) => vermerkEintraege(v, zusatz.darfOriginal === true)),
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
  for (const praefix of [VERMERK, VORSCHAU, ORIGINAL]) {
    if (!key.startsWith(praefix)) continue;
    const v = zusatz?.vermerke?.find((x) => `${praefix}${x.schluessel}` === key);
    if (praefix === VORSCHAU && v?.datei) a.vorschau?.(v.datei);
    else if (praefix === ORIGINAL && v?.datei) a.original?.(v.datei);
    else if (praefix === VERMERK && v?.pfad) a.oeffne?.(v.pfad);
    else if (praefix === VERMERK && v?.datei) a.herunterladen?.(v.datei);
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
