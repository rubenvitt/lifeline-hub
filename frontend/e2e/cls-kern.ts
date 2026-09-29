import type { Page } from '@playwright/test';

/**
 * Messkern für Cumulative Layout Shift, geteilt von mehreren Specs. `pegel-pruefliste` und
 * `betroffene-layout` führen eigene Kopien, die mit einer Marke statt eines Zurücksetzens
 * rechnen.
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
 * Registriert den `layout-shift`-Beobachter VOR jedem Dokument-Script (`addInitScript`;
 * `evaluate` bräuchte ein schon geladenes Dokument).
 *
 * Der Akkumulator lebt PRO DOKUMENT, jede echte Navigation setzt ihn zurück. Deshalb
 * navigiert jeder Test nach `anmelden()` noch einmal per `page.goto`: der Login leitet per
 * React Router IM SELBEN Dokument weiter, dessen Shifts gehörten sonst mit in die Messung.
 */
export async function beobachteShifts(page: Page) {
  await page.addInitScript(() => {
    interface Zustand {
      summe: number;
      eintraege: { wert: number; zeit: number; quellen: string[] }[];
      lauf: string;
    }
    // Die Kennung entsteht EINMAL je Dokument. Ein unbemerkter Reload vergibt eine neue;
    // daran erkennt ein Test eine Messung, die über einen Dokumentwechsel lief und nichts belegt.
    const zustand: Zustand = {
      summe: 0,
      eintraege: [],
      lauf: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    (window as unknown as { __lfhShift: Zustand }).__lfhShift = zustand;

    // Knotenbeschreibung statt Knoten: ein roter Test soll sagen, WAS sich bewegt hat.
    // `className` ist bei SVG-Knoten ein `SVGAnimatedString`, daher die Typprüfung.
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
          sources?: {
            node: Node | null;
            previousRect: DOMRectReadOnly;
            currentRect: DOMRectReadOnly;
          }[];
        };
        // `hadRecentInput`: Verschiebungen innerhalb von 500 ms nach einer Nutzereingabe
        // sind erwartete Folgen der Bedienung und zählen in keiner CLS-Definition mit.
        if (shift.hadRecentInput) continue;
        zustand.summe += shift.value;
        zustand.eintraege.push({
          wert: shift.value,
          zeit: Math.round(shift.startTime),
          // Lage vorher → nachher: zeigt, WIE WEIT es sich bewegt hat und welcher Nachbar schob.
          quellen: (shift.sources ?? []).map(
            (q) =>
              `${beschreibe(q.node)} y${Math.round(q.previousRect.y)}→${Math.round(q.currentRect.y)} h${Math.round(q.previousRect.height)}→${Math.round(q.currentRect.height)}`,
          ),
        });
      }
    });
    // Ohne `buffered: true` hinge die Messung an der Reihenfolge zweier Frames.
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
 * Setzt den Akkumulator zurück, ohne den Beobachter neu zu registrieren. Eine Differenz
 * zweier Ruhelagen täte es nicht: ein Nachzügler-Shift aus dem Seitenaufbau landete im Delta
 * und machte den Test flaky. Nach dem Zurücksetzen gilt absolut „ab hier bewegt sich nichts".
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
 * Wartet, bis der Akkumulator zur Ruhe kommt — `STILLE_RUNDEN` gleiche Lesungen in Folge
 * (450 ms Stille). Kein fester Timeout: unter Volllast der Suite wäre er zu knapp und der
 * Test grün durch zu frühes Hinsehen; aus demselben Grund reichen zwei Lesungen nicht, ein
 * Nachzügler bei +300 ms bliebe ungesehen.
 *
 * Wirft, wenn die Ruhe nie eintritt: ein Zwischenwert unter der Grenze wäre ein stiller
 * Falsch-Grün.
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
