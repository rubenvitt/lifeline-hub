import type { VerbleibEingabe } from '../api/einsatzPerson';
import type { Betreuungsstelle, Person, TransportmittelAuswahl, VerbleibArt } from '../api/types';

/**
 * Reiner Kern des Verbleib-Dialogs (`VerbleibErfassung.tsx`). Felder je Art halten das Budget:
 * Transportmittel nur beim Transport, die Betreuungsstelle nur bei der Notunterkunft und nur
 * mit Lesezugriff auf das Modul Betreuung.
 * Das Suffix `Kern` ist Pflicht: `verbleibErfassung.ts` kollidierte case-insensitiv mit der
 * Komponente, und `./VerbleibErfassung` träfe still diese Datei.
 */

export interface VerbleibFormWerte {
  art?: VerbleibArt;
  ziel?: string;
  transportmittel?: string;
  notiz?: string;
  betreuungsstelle_id?: number | null;
  /** Nur am UHS-Gerät (LFH-1046, `geraet/BestaetigtVonFeld`). */
  bestaetigt_personal_id?: number | null;
  /**
   * Disposition, wenn „Rettungsmittel“ aus „Im Einsatz“ gewählt ist (LLH-1332, design.md D5):
   * dann ist der Transport ein Eigentransport. Jede Texteingabe danach leert sie.
   */
  einsatz_fahrzeug_id?: number | null;
}

export const VERBLEIB_ART_OPTIONEN: { value: VerbleibArt; label: string }[] = [
  { value: 'transport', label: 'Transport' },
  { value: 'notunterkunft', label: 'Notunterkunft' },
  { value: 'entlassung', label: 'Entlassung vor Ort' },
  { value: 'vor_ort', label: 'verbleibt vor Ort' },
  { value: 'verstorben', label: 'Verbleib des Leichnams' },
];

export function sichtbareVerbleibFelder(
  art: VerbleibArt | undefined,
  betreuungFrei: boolean,
): { ziel: boolean; transportmittel: boolean; stelle: boolean } {
  return {
    ziel: true,
    transportmittel: art === 'transport',
    stelle: art === 'notunterkunft' && betreuungFrei,
  };
}

/**
 * Auswahl der Stellen: stornierte fallen weg (409), geschlossene bleiben WÄHLBAR mit Zusatz im
 * Label — ein Verbleib wird oft nachgetragen.
 */
export function stellenOptionen(stellen: Betreuungsstelle[]): { value: number; label: string }[] {
  return stellen
    .filter((s) => !s.storniert_at)
    .map((s) => ({
      value: s.id,
      label: s.status === 'geschlossen' ? `${s.bezeichnung} · geschlossen` : s.bezeichnung,
    }));
}

/**
 * Ziel nach einer Stellenwahl: der Name wird sichtbar und änderbar vorbelegt (der Server kopiert
 * keinen Namen). Überschrieben wird nur ein leeres Ziel oder die unveränderte Vorbelegung der
 * zuvor gewählten Stelle; eigener Text bleibt.
 */
export function zielNachStellenwahl(a: {
  ziel: string | undefined;
  vorher: Betreuungsstelle | undefined;
  neu: Betreuungsstelle | undefined;
}): string | undefined {
  const leer = !a.ziel || a.ziel.trim() === '';
  const unveraendert = a.vorher != null && a.ziel === a.vorher.bezeichnung;
  if (leer || unveraendert) return a.neu?.bezeichnung;
  return a.ziel;
}

/**
 * Ziel nach einem Artwechsel: sonst stünde der Stellenname als Transportziel im Feld. Geleert
 * wird nur die UNVERÄNDERTE Vorbelegung.
 */
export function zielNachArtwechsel(a: {
  art: VerbleibArt | undefined;
  ziel: string | undefined;
  gewaehlt: Betreuungsstelle | undefined;
}): string | undefined {
  if (a.art === 'notunterkunft' || !a.gewaehlt) return a.ziel;
  return a.ziel === a.gewaehlt.bezeichnung ? undefined : a.ziel;
}

/**
 * Request-Body. Unsichtbare Felder gehen nicht mit: ein liegengebliebener Stellen-Verweis wäre
 * 422, einer nach verlorenem Betreuungszugriff 403. antd hält ausgeblendete Werte im Speicher
 * (`preserve`), deshalb entscheidet `stelleSichtbar`, nicht das Vorhandensein des Werts.
 */
export function verbleibBody(
  w: VerbleibFormWerte & { art: VerbleibArt },
  stelleSichtbar: boolean,
): VerbleibEingabe {
  const body: VerbleibEingabe = {
    art: w.art,
    ziel: w.ziel ?? null,
    transportmittel: w.art === 'transport' ? (w.transportmittel ?? null) : null,
    status: w.art === 'transport' ? 'abtransportiert' : null,
    notiz: w.notiz ?? null,
  };
  // Wer fährt (LLH-1332): ein Fahrzeug aus dem Einsatz heißt Eigentransport, alles andere fremd.
  if (w.art === 'transport') {
    if (w.einsatz_fahrzeug_id != null) {
      body.transport_durch = 'eigen';
      body.einsatz_fahrzeug_id = w.einsatz_fahrzeug_id;
    } else {
      body.transport_durch = 'fremd';
    }
  }
  if (stelleSichtbar && w.art === 'notunterkunft' && w.betreuungsstelle_id != null) {
    body.betreuungsstelle_id = w.betreuungsstelle_id;
  }
  if (w.bestaetigt_personal_id != null) body.bestaetigt_personal_id = w.bestaetigt_personal_id;
  return body;
}

/** Eine Vorschlagsoption des Felds „Rettungsmittel“; `einsatzFahrzeugId` nur bei „Im Einsatz“. */
export interface RettungsmittelOption {
  value: string;
  label: string;
  einsatzFahrzeugId?: number;
}

/**
 * Gruppen des Felds „Rettungsmittel“ (LLH-1332, Spec `patienten-uebergabe`, „Vorschläge für das
 * Rettungsmittel“): „Im Einsatz“ (Wahl heißt Eigentransport), „Bisher verwendet“ und
 * „Fahrzeugstamm“. Leere Gruppen fallen weg.
 */
export function rettungsmittelOptionen(
  auswahl: TransportmittelAuswahl | undefined,
): { label: string; options: RettungsmittelOption[] }[] {
  if (!auswahl) return [];
  const gruppen = [
    {
      label: 'Im Einsatz',
      options: auswahl.im_einsatz.map((f) => ({
        value: f.funkrufname,
        label: f.fahrzeugtyp ? `${f.funkrufname} · ${f.fahrzeugtyp}` : f.funkrufname,
        einsatzFahrzeugId: f.einsatz_fahrzeug_id,
      })),
    },
    { label: 'Bisher verwendet', options: auswahl.bisher.map((t) => ({ value: t, label: t })) },
    { label: 'Fahrzeugstamm', options: auswahl.stamm.map((t) => ({ value: t, label: t })) },
  ];
  return gruppen.filter((g) => g.options.length > 0);
}

/**
 * Body von „Übergabe quittieren“ (LLH-1332, design.md D2): ein Verbleib-Ereignis Transport,
 * eigen, dasselbe Fahrzeug, Status `uebergeben`. Ohne eigenes Ziel gilt das bisherige; ohne
 * Uhrzeit setzt der Server jetzt.
 */
export function uebergabeBody(
  person: Pick<Person, 'aktuelles_einsatz_fahrzeug_id' | 'aktuelles_verbleib_ziel'>,
  werte: { ziel?: string; zeitpunkt_at?: string },
): VerbleibEingabe {
  const ziel = werte.ziel?.trim() || person.aktuelles_verbleib_ziel || null;
  return {
    art: 'transport',
    transport_durch: 'eigen',
    einsatz_fahrzeug_id: person.aktuelles_einsatz_fahrzeug_id ?? null,
    status: 'uebergeben',
    ziel,
    ...(werte.zeitpunkt_at ? { zeitpunkt_at: werte.zeitpunkt_at } : {}),
  };
}
