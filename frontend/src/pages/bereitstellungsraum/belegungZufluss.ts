/**
 * Live-Zufluss der Belegungslisten des Bereitstellungsraums ohne Sprung unter dem Cursor
 * (LFH-1113; Bedien-Leitlinie Festlegung 6, Prüfliste Kriterium 12, WCAG 3.2.5).
 *
 * Meldet die Einsatzleitung eine Einheit an, lud die Liste neu und schob eine Zeile ein, auch
 * unter einen Finger, der gerade auf „entfernen“ zielte. Am BR-Tablet ist die Liste der
 * Hauptarbeitsplatz.
 *
 * - FESTE FOLGE: der Server liefert die Belegung ohne Ordnung; die Liste ordnet nach Name bzw.
 *   Funkrufname ({@link ordnungsschluessel}), bei Gleichstand nach Id.
 * - DIE SCHLEUSE HÄLT wie die `Datensicht` (`frontend/AGENTS.md`, „Zufluss der `Datensicht`“):
 *   solange der Fokus in den Listen liegt oder ein Maus- bzw. Stiftzeiger über ihnen steht (nicht
 *   Touch: ein Tipp betritt und verlässt die Fläche, danach hält der Fokus). Fremde Neuzugänge
 *   warten dann hinter dem Sammelbanner, die Folge der gezeigten Zeilen ist eingefroren.
 * - Sofort stehen eigene Anmeldungen (Id vor der Invalidierung vorgemerkt), sofort weg sind
 *   abgemeldete Zeilen.
 *
 * Die reine Logik ist die der Ablösung (`abloesung/zufluss.ts`, `…Nach`-Varianten), hier mit dem
 * Ordnungsschlüssel als eingefrorenem Sortierschlüssel. Ohne Halt zeigt die Liste alles.
 */
import { useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import {
  freigegebenNach,
  LEERER_ZUFLUSSSTAND,
  nachgefuehrtNach,
  teileZuflussNach,
  type Sortierschluessel,
  type Zuflussstand,
} from '../../abloesung/zufluss';

interface MitId {
  id: number;
}

/**
 * Schlüssel der festen Folge, mit `<` vergleichbar wie in `teileZuflussNach`: ohne Groß/Klein und
 * Akzente, Zahlen nach Wert („Florian 2“ vor „Florian 10“). Der Name selbst hängt dahinter, damit
 * „Ärzte“ und „Arzte“ nicht gleich zählen.
 */
export function ordnungsschluessel(name: string): string {
  const grob = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/\d+/g, (zahl) => zahl.padStart(12, '0'));
  return `${grob}\u0000${name}`;
}

/** Die Liste in fester Folge: Schlüssel, dann Id — dieselbe Ordnung wie `teileZuflussNach`. */
export function geordnet<T extends MitId>(
  liste: readonly T[],
  schluesselVon: Sortierschluessel<T>,
): T[] {
  return [...liste].sort((a, b) => {
    const ka = schluesselVon(a);
    const kb = schluesselVon(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
  });
}

/** Wortlaut des Banners: „1 neue Einheit“, „2 neue Fahrzeuge · Reihenfolge geändert“. */
export function zuflussText(
  anzahl: number,
  [einzahl, mehrzahl]: readonly [string, string],
  umgeordnet: boolean,
): string {
  const teile: string[] = [];
  if (anzahl > 0) teile.push(`${anzahl} ${anzahl === 1 ? einzahl : mehrzahl}`);
  if (umgeordnet) teile.push('Reihenfolge geändert');
  return teile.join(' · ');
}

/**
 * Fokus ODER Maus-/Stiftzeiger in der Fläche hält; offen erst, wenn keins mehr gilt. Erst die
 * Bewegung zählt, nicht `pointerenter` (Chromium meldet das Betreten auch, wenn Inhalt unter
 * einem ruhenden Zeiger auftaucht — Begründung in `Datensicht`). `focusout` zum Nachbarknopf
 * derselben Fläche ist kein Verlassen.
 */
export function useHalteFlaeche() {
  const wurzel = useRef<HTMLDivElement>(null);
  const bedingung = useRef({ zeiger: false, fokus: false });
  const [gehalten, setGehalten] = useState(false);
  const pruefe = () => setGehalten(bedingung.current.zeiger || bedingung.current.fokus);
  return {
    gehalten,
    flaeche: {
      ref: wurzel,
      onFocus: () => {
        bedingung.current.fokus = true;
        pruefe();
      },
      onBlur: (e: FocusEvent) => {
        if (e.relatedTarget != null && wurzel.current?.contains(e.relatedTarget as Node)) return;
        bedingung.current.fokus = false;
        pruefe();
      },
      onPointerMove: (e: PointerEvent) => {
        if (e.pointerType === 'touch' || bedingung.current.zeiger) return;
        bedingung.current.zeiger = true;
        pruefe();
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        bedingung.current.zeiger = false;
        pruefe();
      },
    },
  };
}

/**
 * Teilt eine Belegungsliste in gezeigte und zurückgehaltene Zeilen. `kontext` ist der BR: der
 * Umschalter wechselt den Raum in derselben Seite, ein alter Stand gilt dann nicht.
 */
export function useBelegungZufluss<T extends MitId>(
  liste: readonly T[],
  schluesselVon: Sortierschluessel<T>,
  gehalten: boolean,
  kontext: number,
) {
  const [zustand, setZustand] = useState<{ kontext: number } & Zuflussstand>({
    kontext,
    ...LEERER_ZUFLUSSSTAND,
  });
  // `Object.is`: eine ungültige BR-Id ist `NaN`, und `NaN !== NaN` setzte den Zustand ohne Ende.
  const gleicherKontext = (z: typeof zustand) => Object.is(z.kontext, kontext);
  const stand = gleicherKontext(zustand) ? zustand : LEERER_ZUFLUSSSTAND;
  const frisch = useMemo(() => geordnet(liste, schluesselVon), [liste, schluesselVon]);
  const teilung = gehalten
    ? teileZuflussNach(frisch, stand, schluesselVon)
    : { sichtbar: frisch, zurueckgehalten: [] as T[], umgeordnet: false };
  // Nachführen im Render (Muster `AbloesungPage`); `null` heißt „nichts zu tun“, der Riegel gegen
  // die Schleife.
  const neu = nachgefuehrtNach(stand, teilung.sichtbar, teilung.umgeordnet, schluesselVon);
  if (neu || !gleicherKontext(zustand)) setZustand({ kontext, ...(neu ?? stand) });

  const basis = (z: typeof zustand) => (gleicherKontext(z) ? z : LEERER_ZUFLUSSSTAND);
  return {
    ...teilung,
    /** Banner bedient: alles wird gezeigt, in frischer Folge. */
    gibFrei: () =>
      setZustand((z) => ({ kontext, ...freigegebenNach(basis(z), frisch, schluesselVon) })),
    /** Eigene Anmeldung: steht sofort, auch hinter gehaltener Schleuse. */
    merkeEigene: (id: number) =>
      setZustand((z) => {
        const b = basis(z);
        return { kontext, ...b, eigene: new Set([...b.eigene, id]) };
      }),
  };
}
