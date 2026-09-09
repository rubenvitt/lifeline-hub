import type { Page } from '@playwright/test';

/**
 * Messkern für WCAG 2.4.11 „Focus Not Obscured (Minimum)" — geteiltes e2e-Modul.
 *
 * WARUM EIGENES MODUL: der Kern entstand in `fokus-verdeckung.spec.ts` (LFH-330 · B2) und
 * wird seit LFH-465 auch von `befehl-aktionsleiste.spec.ts` gebraucht. Eine Kopie driftet
 * still auseinander — und ein Messkern, der an zwei Orten verschieden rechnet, macht beide
 * Nachweise wertlos. Präzedenz für ein geteiltes e2e-Modul: `einheit-fixture.ts`.
 *
 * Der Inhalt ist ein REINER MOVE aus der Bestandsdatei; ihre Tests bleiben unverändert
 * grün und belegen damit weiterhin denselben Kern.
 */

export interface Verdeckungsbefund {
  verdeckt: string[];
  stoppsInTabelle: number;
  stoppsGesamt: number;
  fixierteKandidaten: number;
  besuchteZiele: string[];
}

/**
 * Läuft `schritte` Tabulatorschritte und meldet jedes vollständig verdeckte Fokusziel.
 *
 * GEMESSEN WIRD GEGEN JEDEN KNOTEN MIT `position: sticky|fixed`, nicht gegen einen benannten
 * Selektor: der Kopfhalter heißt bei antd `.ant-table-sticky-holder`, die fixierte Spalte
 * `.ant-table-cell-fix-start`, die Werkzeugzeile des Primitivs ist ein drittes, unbenanntes
 * Konstrukt — und ein vierter Kandidat käme namenlos dazu. Eine Selektorliste veraltet still.
 *
 * ZWEI BEDINGUNGEN ZUSAMMEN, weil jede einzeln falsch urteilt:
 *  - Nur RECHTECK-ENTHALTENSEIN ist falsch POSITIV: eine durchsichtige Sticky-Hülle über der
 *    ganzen Fläche enthält jedes Ziel, verdeckt aber nichts.
 *  - Nur `elementFromPoint` ist falsch NEGATIV: ein Ziel mit einem Pixel Überstand liefert am
 *    Mittelpunkt sich selbst zurück und gilt als frei, obwohl es praktisch verdeckt ist.
 * Gemeldet wird nur, was BEIDE Bedingungen erfüllt.
 *
 * Vorfahren des Ziels sind ausgenommen: ein `sticky` Container, IN dem das Ziel liegt,
 * verdeckt es nicht — er trägt es.
 *
 * `stoppsInTabelle` zählt Stopps mit `closest('.ant-table')`, `fixierteKandidaten` die
 * gefundenen `sticky|fixed`-Knoten. Beide sind Vorbedingungs-Zähler, keine Nebenausgabe: ohne
 * sie kann ein Durchlauf an der Tabelle vorbeilaufen oder gar keinen fixierten Knoten
 * vorfinden, und „0 verdeckte Ziele" wäre in beiden Fällen trivial wahr.
 */
export async function pruefeFokusVerdeckung(page: Page, schritte: number): Promise<Verdeckungsbefund> {
  const verdeckt: string[] = [];
  let stoppsInTabelle = 0;
  let stoppsGesamt = 0;
  let fixierteKandidaten = 0;
  const besuchteZiele = new Set<string>();

  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Tab');
    const schritt = await page.evaluate(() => {
      const fokus = document.activeElement;
      if (fokus == null || fokus === document.body || fokus === document.documentElement) {
        return null;
      }
      // Der innere Combobox-/Zahleneingabe-Input ist kleiner als das sichtbare Fokusziel.
      const ziel = fokus.closest('.ant-select, .ant-input-number, .ant-input-affix-wrapper') ?? fokus;
      const zr = ziel.getBoundingClientRect();
      if (zr.width === 0 || zr.height === 0) {
        return { beschreibung: null, inTabelle: false, kandidaten: 0, kennung: null };
      }

      const kandidaten = Array.from(document.querySelectorAll('body *')).filter((el) => {
        const stil = getComputedStyle(el);
        if (stil.position !== 'sticky' && stil.position !== 'fixed') return false;
        if (stil.visibility === 'hidden' || stil.display === 'none') return false;
        return !el.contains(ziel);
      });

      const mx = zr.x + zr.width / 2;
      const my = zr.y + zr.height / 2;
      const amPunkt = document.elementFromPoint(mx, my);
      const punktGehoertZiel = amPunkt != null && (amPunkt === ziel || ziel.contains(amPunkt));

      let beschreibung: string | null = null;
      for (const el of kandidaten) {
        const kr = el.getBoundingClientRect();
        const umschliesst =
          zr.left >= kr.left - 0.5 &&
          zr.right <= kr.right + 0.5 &&
          zr.top >= kr.top - 0.5 &&
          zr.bottom <= kr.bottom + 0.5;
        if (!umschliesst || punktGehoertZiel) continue;
        beschreibung =
          `${ziel.tagName.toLowerCase()}[${(ziel.getAttribute('aria-label') ?? ziel.textContent ?? '').trim().slice(0, 30)}] ` +
          `bei (${Math.round(zr.x)},${Math.round(zr.y)}) ${Math.round(zr.width)}×${Math.round(zr.height)} ` +
          `vollständig hinter ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ` +
          `(${getComputedStyle(el).position}); am Mittelpunkt liegt ` +
          `${amPunkt == null ? 'nichts' : `${amPunkt.tagName.toLowerCase()}.${String(amPunkt.className).slice(0, 30)}`}`;
        break;
      }
      return {
        beschreibung,
        inTabelle: ziel.closest('.ant-table') != null,
        kandidaten: kandidaten.length,
        kennung: fokus.getAttribute('data-e2e-fokus'),
      };
    });

    if (schritt == null) continue;
    stoppsGesamt += 1;
    if (schritt.inTabelle) stoppsInTabelle += 1;
    fixierteKandidaten = Math.max(fixierteKandidaten, schritt.kandidaten);
    if (schritt.beschreibung) verdeckt.push(schritt.beschreibung);
    if (schritt.kennung) besuchteZiele.add(schritt.kennung);
  }

  return { verdeckt, stoppsInTabelle, stoppsGesamt, fixierteKandidaten, besuchteZiele: [...besuchteZiele] };
}
