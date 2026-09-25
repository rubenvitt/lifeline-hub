import type { Page } from '@playwright/test';

/**
 * Messkern für Cumulative Layout Shift — geteiltes e2e-Modul (LFH-373).
 *
 * WARUM EIGENES MODUL: der Beobachter entstand in `einsatzauswahl-cls.spec.ts` (LFH-514) und
 * wird seit LFH-373 auch von `leisten-flaeche.spec.ts` gebraucht. Präzedenz für den Umzug:
 * `fokus-kern.ts` (LFH-465). Der Inhalt ist ein REINER MOVE; die Tests der Ursprungsdatei
 * bleiben unverändert und belegen damit weiterhin denselben Kern. Die Kommentare nennen
 * „Test 3" — gemeint ist der Refetch-Test in `einsatzauswahl-cls.spec.ts`.
 *
 * Nicht mitgezogen sind die lokalen Kopien in `pegel-pruefliste.spec.ts` und
 * `betroffene-layout.spec.ts`; sie rechnen mit einer Marke statt eines Zurücksetzens und
 * bleiben bis zu einem eigenen Umbau, wo sie sind (design.md D9 des Changes LFH-373).
 */

/** Ein Shift-Eintrag, wie ihn der Beobachter im Dokument sammelt. */
export interface ShiftEintrag {
  wert: number;
  zeit: number;
  quellen: string[];
}

export interface Messung {
  summe: number;
  eintraege: ShiftEintrag[];
  /** Kennung des Dokuments, in dem gemessen wurde — siehe {@link beobachteShifts}. */
  lauf: string;
}

/**
 * Registriert den `layout-shift`-Beobachter VOR jedem Dokument-Script.
 *
 * `addInitScript` statt `evaluate` nach dem Laden: ein nachträglich registrierter
 * Beobachter verpasst zwar dank `buffered: true` keine Einträge, aber `evaluate` selbst
 * braucht ein geladenes Dokument — die Registrierung käme dann frühestens nach dem ersten
 * Rendern, und der Akkumulator müsste über die Navigation hinweg gerettet werden.
 *
 * Der Akkumulator lebt PRO DOKUMENT: jede echte Navigation setzt ihn zurück. Das ist die
 * gewünschte Semantik — die Shifts der Login-Seite gehören nicht in die Messung der
 * Einsatzauswahl. Aus demselben Grund navigiert jeder Test nach `anmelden()` noch einmal
 * per `page.goto`: der Login schickt per React Router weiter, also IM SELBEN Dokument.
 */
export async function beobachteShifts(page: Page) {
  await page.addInitScript(() => {
    interface Zustand {
      summe: number;
      eintraege: { wert: number; zeit: number; quellen: string[] }[];
      lauf: string;
    }
    // Die Kennung entsteht EINMAL je Dokument. Lädt die Seite unbemerkt neu, läuft dieses
    // Script erneut und vergibt eine neue — daran erkennt Test 3 eine Messung, die über
    // einen Dokumentwechsel hinweg lief und damit nichts belegt (gemessen: bei einem
    // solchen Reload stand die Ladephase mit ihrer eigenen `startTime` wieder im frisch
    // angelegten Akkumulator, und die Summe sah aus wie ein Refetch-Shift).
    const zustand: Zustand = {
      summe: 0,
      eintraege: [],
      lauf: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    (window as unknown as { __lfhShift: Zustand }).__lfhShift = zustand;

    // Knotenbeschreibung statt Knoten: ein roter Test soll sagen, WAS sich bewegt hat.
    // `className` ist bei SVG-Knoten ein `SVGAnimatedString` und kein String — deshalb die
    // Typprüfung statt eines blinden `.split`.
    const beschreibe = (knoten: Node | null): string => {
      if (!knoten || !(knoten instanceof Element)) return '(kein Element)';
      const testid = knoten.getAttribute('data-testid');
      const klassen =
        typeof knoten.className === 'string' && knoten.className.trim()
          ? `.${knoten.className.trim().split(/\s+/).join('.')}`
          : '';
      return `${knoten.tagName.toLowerCase()}${klassen}${testid ? `[${testid}]` : ''}`;
    };

    const beobachter = new PerformanceObserver((liste) => {
      for (const eintrag of liste.getEntries()) {
        const shift = eintrag as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node: Node | null }[];
        };
        // `hadRecentInput`: Verschiebungen innerhalb von 500 ms nach einer Nutzereingabe
        // sind erwartete Folgen der Bedienung und zählen in keiner CLS-Definition mit.
        if (shift.hadRecentInput) continue;
        zustand.summe += shift.value;
        zustand.eintraege.push({
          wert: shift.value,
          zeit: Math.round(shift.startTime),
          quellen: (shift.sources ?? []).map((q) => beschreibe(q.node)),
        });
      }
    });
    // `buffered: true` liefert auch die Einträge nach, die vor dieser Zeile entstanden
    // sind — hier zwar keine, aber ohne das Flag hinge die Messung an der Reihenfolge
    // zweier Frames.
    beobachter.observe({ type: 'layout-shift', buffered: true });
  });
}

/** Momentaufnahme des Akkumulators. */
export async function leseShifts(page: Page): Promise<Messung> {
  return page.evaluate(() => {
    const z = (window as unknown as { __lfhShift?: Messung }).__lfhShift;
    if (!z) throw new Error('Shift-Beobachter fehlt — addInitScript hat nicht gegriffen');
    return { summe: z.summe, eintraege: z.eintraege, lauf: z.lauf };
  });
}

/**
 * Setzt den Akkumulator zurück, ohne den Beobachter neu zu registrieren.
 *
 * Test 3 braucht die Shifts AB einem Zeitpunkt, nicht seit dem Dokumentanfang. Eine
 * Differenz zweier Ruhelagen täte es nicht: ein Nachzügler-Shift aus dem Seitenaufbau
 * (nachgeladene Schrift, verspätetes Bild) landete dann im Delta und machte den Test
 * flaky — genau das ist am 11.09.2026 in einem Lauf passiert. Nach dem Zurücksetzen ist
 * die Aussage absolut: „ab hier bewegt sich nichts mehr".
 */
export async function setzeShiftsZurueck(page: Page) {
  await page.evaluate(() => {
    const z = (window as unknown as { __lfhShift?: { summe: number; eintraege: unknown[] } })
      .__lfhShift;
    if (!z) throw new Error('Shift-Beobachter fehlt — addInitScript hat nicht gegriffen');
    z.summe = 0;
    z.eintraege.length = 0;
  });
}

/** Wie viele gleiche Lesungen in Folge als Ruhe gelten — siehe {@link ruheShifts}. */
const STILLE_RUNDEN = 4;
/** Abstand zwischen zwei Lesungen. `STILLE_RUNDEN` × dieser Wert ist das Ruhefenster. */
const LESE_ABSTAND = 150;

/**
 * Wartet, bis der Akkumulator zur Ruhe kommt — `STILLE_RUNDEN` gleiche Lesungen in Folge.
 *
 * KEIN fester Timeout: ein `waitForTimeout(1000)` wäre lokal großzügig und unter Volllast
 * der Suite (drei Worker, Vite übersetzt nebenher) zu knapp — der Test würde dann eine
 * Ruhelage messen, die noch gar nicht eingetreten ist, und wäre grün durch zu frühes
 * Hinsehen.
 *
 * VIER Lesungen, nicht zwei (Review-Befund): mit zwei genügte EIN stilles Fenster von
 * 100 ms, um „Ruhe" zu melden. Ein Nachzügler bei +300 ms — nachgeladene Schrift,
 * verspätete Style-Injektion, Reflow unter Last — wäre nie gesehen worden, die Summe zu
 * klein und JEDE Summen-Zusicherung dieser Datei grün durch zu frühes Hinsehen. Genau das,
 * wogegen die Schleife gebaut ist. Vier Runden à 150 ms sind 450 ms Stille.
 *
 * Und die Schleife WIRFT, wenn sie das Fenster nie erreicht: „kommt nicht zur Ruhe" ist von
 * „ist ruhig" sonst nicht zu unterscheiden, und ein Zwischenwert kann zufällig unter der
 * Grenze liegen — ein stiller Falsch-Grün.
 */
export async function ruheShifts(page: Page, runden = 60): Promise<Messung> {
  let vorher = Number.NaN;
  let gleich = 0;
  let letzte: Messung = { summe: 0, eintraege: [], lauf: '' };
  for (let i = 0; i < runden; i += 1) {
    letzte = await leseShifts(page);
    gleich = letzte.summe === vorher ? gleich + 1 : 0;
    if (gleich >= STILLE_RUNDEN - 1) return letzte;
    vorher = letzte.summe;
    await page.waitForTimeout(LESE_ABSTAND);
  }
  throw new Error(
    `Die Layout-Shifts kamen in ${runden} Runden à ${LESE_ABSTAND} ms nicht zur Ruhe — ` +
      `zuletzt ${bericht(letzte)}. Ein Zwischenwert unter der Grenze wäre ein stiller ` +
      'Falsch-Grün, deshalb ist das ein Fehler und keine Messung.',
  );
}

/** Menschenlesbare Anmerkung für den Testbericht — Summe plus jede bewegte Quelle. */
export function bericht(messung: Messung): string {
  if (messung.eintraege.length === 0) return `Summe ${messung.summe.toFixed(4)} (keine Shifts)`;
  const zeilen = messung.eintraege.map(
    (e) => `${e.wert.toFixed(4)} @${e.zeit}ms [${e.quellen.join(', ') || 'ohne Quelle'}]`,
  );
  return `Summe ${messung.summe.toFixed(4)} aus ${messung.eintraege.length}: ${zeilen.join(' · ')}`;
}
