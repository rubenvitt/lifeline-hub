import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../../anzeige/format';
import type { KartenAufnahme } from './kartenAufnahme';
import type { KartenHandle } from './Kartenflaeche';
import { lageplanLegende, type LageplanLegende, type LegendenQuellen } from './lageplan';
import { setzeKartenbild, setzeLageplanAnlage } from './lageplanBild';
import type { BeginneKartenHandlung } from './useKartenFehler';

/** Was der Kopf des Lageplans nennt; die Seite weiß es, der Hook liest es erst bei der Aufnahme. */
export interface LageplanKopf {
  einsatz: { bezeichnung: string; einsatznummer_intern?: string | null };
  /** Name der aktiven Kartenansicht; `null` ohne gespeicherte Ansicht. */
  ansicht: string | null;
  /** Kartengrundlage, wie sie die Segmentleiste nennt. */
  grundlage: string | null;
  /** ISO-Stand: gesicherter Stand oder Datenstand; `null` = Zeitpunkt der Aufnahme. */
  stand: string | null;
}

/** Ein Blatt zum Drucken: das Bild als Objekt-URL plus alles, was darunter steht. */
export interface LageplanBlatt {
  bildUrl: string;
  /** Maße, Maßstab und Peilung des Ausschnitts. */
  aufnahme: KartenAufnahme;
  einsatz: LageplanKopf['einsatz'];
  zeilen: { etikett: string; wert: string }[];
  legende: LageplanLegende;
}

/** Die Anlage: fertiges Bild und der Stand, der darin steht. */
export interface LageplanAnlage {
  datei: Blob;
  standAt: string;
}

/** Quellen der Legende ohne die Uhr: sie liest der Hook beim Aufnehmen. */
export type LageplanQuellen = Omit<LegendenQuellen, 'jetztMs'>;

/** Gründe ohne Servermeldung, im Hinweis über der Karte bzw. im Dialog. */
export const KARTENBILD_FEHLT = 'Kartenbild nicht aufgenommen';

function kopfZeilen(kopf: LageplanKopf, stand: string, dtg: (iso: string) => string) {
  return [
    { etikett: 'Stand', wert: dtg(stand) },
    ...(kopf.ansicht ? [{ etikett: 'Ansicht', wert: kopf.ansicht }] : []),
    ...(kopf.grundlage ? [{ etikett: 'Kartengrundlage', wert: kopf.grundlage }] : []),
  ];
}

/** „Lageplan · Hochwasser Musterstadt (2026-014)“ — der Titel im Bild der Anlage. */
export function anlagenTitel(einsatz: LageplanKopf['einsatz']): string {
  const nummer = einsatz.einsatznummer_intern ? ` (${einsatz.einsatznummer_intern})` : '';
  return `Lageplan · ${einsatz.bezeichnung}${nummer}`;
}

function vorladen(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  return typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
}

/**
 * Lageplan der Lagekarte (LLH-1051, Spec `lagekarte-druck`): nimmt den Ausschnitt auf Wahl auf.
 *
 * - `vorbereitenDruck` für `useDruckNebenwege`: Aufnahme, Bild geladen, dann steht das Blatt
 *   (`blatt`) und die Seite hängt die Druckwurzel ein. Nach `afterprint` geht es wieder: ein
 *   späteres Strg+P druckt nie ein altes Bild.
 * - `erstelleAnlage` für den Dialog „Als Anlage an …“: dasselbe als ganzes PNG-Blatt.
 *
 * Kopf und Legende liest der Hook über Refs erst bei der Aufnahme: sie gehören zum Bild dieses
 * Augenblicks, nicht zum Render davor.
 */
export function useLageplan({
  kartenRef,
  kopf,
  quellen,
  beginneHandlung,
}: {
  kartenRef: RefObject<KartenHandle | null>;
  kopf: LageplanKopf | null;
  quellen: LageplanQuellen;
  beginneHandlung: BeginneKartenHandlung;
}) {
  const { konventionen } = useAnzeigeKonventionen();
  const [blatt, setBlatt] = useState<LageplanBlatt | null>(null);
  const kopfRef = useRef(kopf);
  kopfRef.current = kopf;
  const quellenRef = useRef(quellen);
  quellenRef.current = quellen;
  const konventionenRef = useRef(konventionen);
  konventionenRef.current = konventionen;

  useEffect(() => {
    if (!blatt) return;
    const raeume = () => setBlatt(null);
    window.addEventListener('afterprint', raeume);
    return () => {
      window.removeEventListener('afterprint', raeume);
      URL.revokeObjectURL(blatt.bildUrl);
    };
  }, [blatt]);

  const nimmAuf = useCallback(async () => {
    const k = kopfRef.current;
    if (!k) return null;
    const aufnahme = (await kartenRef.current?.nimmBildAuf()) ?? null;
    if (!aufnahme) return null;
    const stand = k.stand ?? new Date().toISOString();
    const legende = lageplanLegende({ ...quellenRef.current, jetztMs: Date.now() });
    const zeilen = kopfZeilen(k, stand, (iso) => taktischeDtgVoll(iso, konventionenRef.current));
    return { aufnahme, stand, legende, zeilen, einsatz: k.einsatz };
  }, [kartenRef]);

  const vorbereitenDruck = useCallback(async (): Promise<boolean> => {
    const melde = beginneHandlung('lageplan-druck', 'Lageplan nicht gedruckt', KARTENBILD_FEHLT);
    const auf = await nimmAuf();
    const bild = auf ? await setzeKartenbild(auf.aufnahme) : null;
    if (!auf || !bild) {
      melde(new Error(KARTENBILD_FEHLT));
      return false;
    }
    const bildUrl = URL.createObjectURL(bild);
    await vorladen(bildUrl);
    setBlatt({
      bildUrl,
      aufnahme: auf.aufnahme,
      einsatz: auf.einsatz,
      zeilen: auf.zeilen,
      legende: auf.legende,
    });
    return true;
  }, [beginneHandlung, nimmAuf]);

  const erstelleAnlage = useCallback(async (): Promise<LageplanAnlage | null> => {
    const auf = await nimmAuf();
    if (!auf) return null;
    const datei = await setzeLageplanAnlage({
      aufnahme: auf.aufnahme,
      titel: anlagenTitel(auf.einsatz),
      zeilen: auf.zeilen.map((z) => (z.etikett === 'Stand' ? `Stand ${z.wert}` : z.wert)),
      legende: auf.legende,
    });
    return datei ? { datei, standAt: auf.stand } : null;
  }, [nimmAuf]);

  return { blatt, vorbereitenDruck, erstelleAnlage };
}
