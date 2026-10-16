import type { Sortierschluessel } from '../../abloesung/zufluss';
import type {
  BrAbrufKurz,
  BrEinheitKurz,
  BrFahrzeugKurz,
  Einheit,
  ModulFreigaben,
  ObjektTyp,
} from '../../api/types';
import {
  MODUL_ABSCHNITTE_GESPERRT,
  MODUL_AUFTRAEGE_GESPERRT,
  MODUL_EINHEITEN_GESPERRT,
} from '../../components/nurAnsicht';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { collectNachfahren } from '../einheit/einheitAnsichtKern';
import { folgeSchluessel, ordnungsschluessel } from './brBelegungKern';

/**
 * Reiner Kern des Abrufs auf der Seite eines Bereitstellungsraums (LLH-1085 Teil II, Spec
 * `bereitstellungsraum-belegung`, „Detail nennt den Abruf“, „Verband geht mit“).
 *
 * „Abgerufen“ ist kein gespeicherter Zustand: der Server leitet `abruf` je Kraft aus ihrem jüngsten
 * Belegungsereignis ab. Die Seite teilt die Belegung danach in „Abgerufen“ (oben, getrennt) und
 * die bereitgestellten Kräfte; die Zahlen des Raums zählen beide (der Server rechnet sie).
 */

/** Eine Zeile unter „Abgerufen“: Einheit oder einheitenloses Fahrzeug mit ihrem Abruf. */
export interface AbrufZeile {
  /**
   * Schlüssel der Zuflussschleuse (`useBelegungZufluss`), die Zeilen über `id` verfolgt: eine
   * Liste mischt zwei Kennungsräume, darum Einheiten gerade, Fahrzeuge ungerade.
   */
  id: number;
  objekt_typ: ObjektTyp;
  objekt_id: number;
  /** Name der Einheit bzw. Funkrufname des Fahrzeugs. */
  name: string;
  abruf: BrAbrufKurz;
  einheit?: BrEinheitKurz;
  fahrzeug?: BrFahrzeugKurz;
}

export interface BelegungNachAbruf {
  /** Bereitgestellt, nicht abgerufen. */
  einheiten: BrEinheitKurz[];
  fahrzeuge: BrFahrzeugKurz[];
  abgerufen: AbrufZeile[];
}

/** Schleusen-Kennung einer Zeile unter „Abgerufen“ ({@link AbrufZeile.id}). */
export function abrufZeilenId(typ: ObjektTyp, objektId: number): number {
  return typ === 'einheit' ? objektId * 2 : objektId * 2 + 1;
}

export function splitNachAbruf(
  einheiten: readonly BrEinheitKurz[],
  fahrzeuge: readonly BrFahrzeugKurz[],
): BelegungNachAbruf {
  const abgerufen: AbrufZeile[] = [];
  for (const e of einheiten) {
    if (e.abruf) {
      abgerufen.push({
        id: abrufZeilenId('einheit', e.id),
        objekt_typ: 'einheit',
        objekt_id: e.id,
        name: e.name,
        abruf: e.abruf,
        einheit: e,
      });
    }
  }
  for (const f of fahrzeuge) {
    if (f.abruf) {
      abgerufen.push({
        id: abrufZeilenId('fahrzeug', f.id),
        objekt_typ: 'fahrzeug',
        objekt_id: f.id,
        name: f.funkrufname,
        abruf: f.abruf,
        fahrzeug: f,
      });
    }
  }
  return {
    einheiten: einheiten.filter((e) => !e.abruf),
    fahrzeuge: fahrzeuge.filter((f) => !f.abruf),
    abgerufen,
  };
}

/** Folge unter „Abgerufen“: am längsten abgerufen zuerst, bei Gleichstand nach Name. */
export const abrufFolge: Sortierschluessel<AbrufZeile> = (z) =>
  folgeSchluessel(z.abruf.seit_at, z.name);

/**
 * Was hinter dem Wort „abgerufen“ steht: „1432 → EA Deich · Auftrag Nr. 7“, bei einer
 * mitgenommenen Untereinheit „… · mit 1. Zug“. Die Uhrzeit kommt formatiert (taktisch,
 * Anzeigezone) herein.
 */
export function abrufAngabe(uhrzeit: string, abruf: BrAbrufKurz, mitEinheit?: string): string {
  const teile = [abruf.ziel_anzeige ? `${uhrzeit} → ${abruf.ziel_anzeige}` : uhrzeit];
  if (abruf.auftrag_nr != null) teile.push(`Auftrag Nr. ${abruf.auftrag_nr}`);
  if (mitEinheit) teile.push(`mit ${mitEinheit}`);
  return teile.join(' · ');
}

/**
 * Untereinheiten, die ein Abruf der Einheit `wurzel` mitnimmt, nach Name: über alle Ebenen
 * (`ueber_einheit_id`), im Raum und nicht schon abgerufen. Dieselbe Menge bestimmt der Server
 * (`bereitstellungsraum::abruf`, `load_verband_tx`); hier steht sie nur im Dialog.
 */
export function verbandImRaum(
  wurzel: number,
  imRaum: readonly BrEinheitKurz[],
  alleEinheiten: readonly Pick<Einheit, 'id' | 'ueber_einheit_id'>[],
): string[] {
  const nachfahren = collectNachfahren(alleEinheiten as readonly Einheit[], wurzel);
  return imRaum
    .filter((e) => e.id !== wurzel && nachfahren.has(e.id) && !e.abruf)
    .map((e) => e.name)
    .sort((a, b) => {
      const ka = ordnungsschluessel(a);
      const kb = ordnungsschluessel(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

/**
 * Sperren der beiden Felder des Abruf-Dialogs, je `null` (frei), `''` (gesperrt, solange die
 * Freigaben laden; kein erfundener Grund) oder der Grund in wenigen Wörtern (`frontend/AGENTS.md`,
 * „Fehlende Berechtigung wird benannt“). Der Server verlangt für den Abschnitt das Modul Einheiten
 * und für den Auftrag das Modul Aufträge (403 sonst); die Liste der Abschnitte liest das Modul
 * Einsatzabschnitte.
 */
export function abrufFelderRechte(freigaben: ModulFreigaben | undefined): {
  abschnitt: string | null;
  auftrag: string | null;
} {
  if (freigaben == null) return { abschnitt: '', auftrag: '' };
  const abschnitt = !istKeyFreigegeben('einheiten', freigaben)
    ? MODUL_EINHEITEN_GESPERRT
    : !istKeyFreigegeben('einsatzabschnitte', freigaben)
      ? MODUL_ABSCHNITTE_GESPERRT
      : null;
  const auftrag = istKeyFreigegeben('auftraege', freigaben) ? null : MODUL_AUFTRAEGE_GESPERRT;
  return { abschnitt, auftrag };
}

/** Quittung nach dem Abruf: „HLF 20 abgerufen → EA Deich · Auftrag Nr. 7“. */
export function abrufQuittung(
  name: string,
  {
    ziel,
    auftragNr,
    ausgetragen,
  }: { ziel?: string | null; auftragNr?: number | null; ausgetragen: boolean },
): string {
  const kopf = `${name} abgerufen${ausgetragen ? ' und ausgetragen' : ''}`;
  const teile = [ziel ? `${kopf} → ${ziel}` : kopf];
  if (auftragNr != null) teile.push(`Auftrag Nr. ${auftragNr}`);
  return teile.join(' · ');
}
