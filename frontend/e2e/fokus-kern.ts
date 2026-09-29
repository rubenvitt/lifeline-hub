import type { Page } from '@playwright/test';

/**
 * Messkern für WCAG 2.4.11 „Focus Not Obscured (Minimum)", geteilt von mehreren Specs. Eine
 * Kopie je Spec driftete still auseinander und machte beide Nachweise wertlos.
 */

export interface Verdeckungsbefund {
  verdeckt: string[];
  stoppsInTabelle: number;
  stoppsGesamt: number;
  fixierteKandidaten: number;
  besuchteZiele: string[];
  /**
   * Stopps, deren Rechteck einen `sticky|fixed`-Knoten mindestens BERÜHRT (2 px Spiel).
   * Vorbedingungs-Zähler: ohne ihn kann ein Lauf „0 verdeckt" melden, obwohl nie ein Ziel in
   * die Nähe der stehenden Fläche kam. Schirmfüllende Knoten (Dialogmaske) zählen nicht.
   */
  stoppsBeruehrt: number;
  /**
   * Davon die Stopps an der stehenden Tabellenkopfzeile (`.ant-table-sticky-holder`).
   * `stoppsBeruehrt` zählt auch die fixierte erste Spalte und belegt die Kopfzeile nicht.
   */
  stoppsAnTabellenkopf: number;
  /**
   * Stopps innerhalb von {@link KernOptionen.region}. Vorbedingungs-Zähler: ohne ihn wäre
   * „0 verdeckt" trivial wahr, wenn der Lauf an der Region vorbeigeht. Ohne `region` immer 0.
   */
  stoppsInRegion: number;
  /**
   * Nur mit {@link KernOptionen.beschnitt}: unter den Stopps in der Region der mit dem kleinsten
   * sichtbaren ANTEIL seiner Höhe (nach allen abschneidenden Vorfahren und dem Fenster), als
   * sichtbare und volle Höhe in px. Der Kern meldet nur VOLLSTÄNDIGEN Beschnitt; dieser Wert zeigt, wie knapp es ist.
   */
  kleinsterRestInRegion: { sichtbar: number; ziel: number } | null;
}

/** Opt-in-Erweiterungen; ohne sie rechnet der Kern für alle Bestands-Specs unverändert. */
export interface KernOptionen {
  /**
   * Zusätzliche Verdecker per Selektor, NEBEN den `sticky|fixed`-Knoten — für absolut
   * positionierte Kartenaufbauten, die die Vorgabe nicht sieht (ohne sie wäre ein Lauf über
   * die Lagekarte grün durch Konstruktion). Bewusst eine Liste statt „alles mit
   * `position: absolute`": sonst würden Canvas, Marker und antd-Portale zu Fehltreffern.
   */
  zusatzKandidaten?: string[];
  /** Selektor einer Region, deren Stopps `stoppsInRegion` zählt. */
  region?: string;
  /**
   * Meldet auch ein Ziel, das ein Vorfahr mit `overflow` ≠ `visible` (oder das Fenster)
   * VOLLSTÄNDIG abschneidet (LFH-811). Ein Band, das Höhe abgibt und in sich rollt
   * (`bandStil(…, nachgiebig)`), verdeckt nichts, es schneidet ab — das sieht die
   * Überdeckungsprüfung nicht. Die Überdeckung rechnet dann mit dem sichtbaren Rest statt mit
   * dem ganzen Ziel (halb abgeschnitten, Rest verdeckt ist verdeckt).
   *
   * Genähert: geschnitten wird je Achse an der Border-Box; ein `fixed`-Knoten beendet den Lauf,
   * ein `absolute`-Knoten überspringt unpositionierte Vorfahren bis zu seinem Containing Block;
   * `display: contents`/`inline` schneiden nicht. `transform`-Containing-Blocks sind nicht
   * nachgebildet. Opt-in, damit die Bestands-Specs unverändert rechnen.
   */
  beschnitt?: boolean;
}

/**
 * Läuft `schritte` Tabulatorschritte und meldet jedes vollständig verdeckte Fokusziel.
 *
 * `Tab` rollt Ziele an den UNTEREN Rand; eine oben stehende Kopfzeile prüft nur `Shift+Tab`.
 *
 * Kandidaten sind ALLE Knoten mit `position: sticky|fixed` (eine Selektorliste veraltet still),
 * ohne Vorfahren des Ziels — ein Container, in dem das Ziel liegt, trägt es. Verdeckt ist ein
 * Ziel nur, wenn BEIDES gilt, weil jede Bedingung allein falsch urteilt:
 *  - Rechteck-Enthaltensein allein ist falsch positiv (durchsichtige Sticky-Hülle).
 *  - `elementFromPoint` allein ist falsch negativ (ein Pixel Überstand am Mittelpunkt).
 *
 * `stoppsInTabelle` und `fixierteKandidaten` sind Vorbedingungs-Zähler: ohne sie wäre
 * „0 verdeckte Ziele" trivial wahr, wenn der Lauf die Tabelle verfehlt.
 */
export async function pruefeFokusVerdeckung(
  page: Page,
  schritte: number,
  taste: 'Tab' | 'Shift+Tab' = 'Tab',
  optionen: KernOptionen = {},
): Promise<Verdeckungsbefund> {
  const verdeckt: string[] = [];
  let stoppsInTabelle = 0;
  let stoppsGesamt = 0;
  let stoppsBeruehrt = 0;
  let stoppsAnTabellenkopf = 0;
  let stoppsInRegion = 0;
  let kleinsterRestInRegion: Verdeckungsbefund['kleinsterRestInRegion'] = null;
  let fixierteKandidaten = 0;
  const besuchteZiele = new Set<string>();

  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press(taste);
    const schritt = await page.evaluate(
      ({ zusatz, region, beschnitt }) => {
        const fokus = document.activeElement;
        if (fokus == null || fokus === document.body || fokus === document.documentElement) {
          return null;
        }
        // Der innere Input von Combobox/Zahlenfeld ist kleiner als das sichtbare Fokusziel;
        // den des Radio-Knopfs setzt antd auf 0 × 0, er fiele sonst still aus der Zählung.
        const ziel =
          fokus.closest(
            '.ant-select, .ant-input-number, .ant-input-affix-wrapper, .ant-radio-button-wrapper',
          ) ?? fokus;
        const zr = ziel.getBoundingClientRect();
        if (zr.width === 0 || zr.height === 0) {
          return {
            beschreibung: null,
            inTabelle: false,
            kandidaten: 0,
            kennung: null,
            beruehrt: false,
            anTabellenkopf: false,
            inRegion: false,
            rest: null,
          };
        }

        const kandidaten = Array.from(document.querySelectorAll('body *')).filter((el) => {
          const stil = getComputedStyle(el);
          if (stil.position !== 'sticky' && stil.position !== 'fixed') return false;
          if (stil.visibility === 'hidden' || stil.display === 'none') return false;
          return !el.contains(ziel);
        });
        // Die benannten Zusatzverdecker, mit denselben Ausschlüssen.
        for (const sel of zusatz) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            if (kandidaten.includes(el) || el.contains(ziel)) continue;
            const stil = getComputedStyle(el);
            if (stil.visibility === 'hidden' || stil.display === 'none') continue;
            kandidaten.push(el);
          }
        }

        // Sichtbarer Rest des Ziels nach allen abschneidenden Vorfahren und dem Fenster; ohne
        // `beschnitt` das ganze Ziel.
        let sr = { left: zr.left, right: zr.right, top: zr.top, bottom: zr.bottom };
        let schnitt: string | null = null;
        if (beschnitt) {
          const leer = () => sr.right <= sr.left || sr.bottom <= sr.top;
          const schneide = (k: DOMRect, x: boolean, y: boolean) => {
            if (x)
              sr = { ...sr, left: Math.max(sr.left, k.left), right: Math.min(sr.right, k.right) };
            if (y)
              sr = { ...sr, top: Math.max(sr.top, k.top), bottom: Math.min(sr.bottom, k.bottom) };
          };
          let schneider: string | null = null;
          // Ein absolut positionierter Knoten entkommt unpositionierten Vorfahren, ein fixierter
          // allen: geschnitten wird nur entlang der Containing-Block-Kette.
          let lage = getComputedStyle(ziel).position;
          for (
            let a = ziel.parentElement;
            a != null && a !== document.body && a !== document.documentElement && lage !== 'fixed';
            a = a.parentElement
          ) {
            const stil = getComputedStyle(a);
            const positioniert = stil.position !== 'static';
            const traegt = lage !== 'absolute' || positioniert;
            if (traegt && lage === 'absolute') lage = 'static';
            if (positioniert && stil.position !== 'relative' && stil.position !== 'sticky') {
              lage = stil.position;
            }
            if (!traegt || stil.display === 'contents' || stil.display === 'inline') continue;
            const x = stil.overflowX !== 'visible';
            const y = stil.overflowY !== 'visible';
            if (!x && !y) continue;
            const vorher = leer();
            schneide(a.getBoundingClientRect(), x, y);
            if (!vorher && leer()) {
              schneider = `${a.tagName.toLowerCase()}.${String(a.className).slice(0, 40)}`;
            }
          }
          const vorFenster = leer();
          schneide(new DOMRect(0, 0, innerWidth, innerHeight), true, true);
          if (!vorFenster && leer()) schneider = 'dem Fenster';
          if (leer()) {
            schnitt =
              `${ziel.tagName.toLowerCase()}[${(ziel.getAttribute('aria-label') ?? ziel.textContent ?? '').trim().slice(0, 30)}] ` +
              `bei (${Math.round(zr.x)},${Math.round(zr.y)}) ${Math.round(zr.width)}×${Math.round(zr.height)} ` +
              `vollständig abgeschnitten von ${schneider ?? 'einem Vorfahren'}`;
          }
        }

        const mx = (sr.left + sr.right) / 2;
        const my = (sr.top + sr.bottom) / 2;
        const amPunkt = document.elementFromPoint(mx, my);
        const punktGehoertZiel = amPunkt != null && (amPunkt === ziel || ziel.contains(amPunkt));

        let beschreibung: string | null = schnitt;
        let beruehrt = false;
        let anTabellenkopf = false;
        for (const el of kandidaten) {
          const kr = el.getBoundingClientRect();
          const schirmfuellend = kr.width >= innerWidth - 1 && kr.height >= innerHeight - 1;
          // BERÜHREN zählt mit (2 px Spiel): ein Ziel, das der Browser dank `scroll-margin`
          // bündig UNTER die Kopfzeile rollt, war an ihr — überlappen tut es gerade nicht.
          if (
            !schirmfuellend &&
            zr.left <= kr.right + 2 &&
            zr.right >= kr.left - 2 &&
            zr.top <= kr.bottom + 2 &&
            zr.bottom >= kr.top - 2
          ) {
            beruehrt = true;
            if (el.matches('.ant-table-sticky-holder')) anTabellenkopf = true;
          }
          const umschliesst =
            sr.left >= kr.left - 0.5 &&
            sr.right <= kr.right + 0.5 &&
            sr.top >= kr.top - 0.5 &&
            sr.bottom <= kr.bottom + 0.5;
          if (!umschliesst || punktGehoertZiel || beschreibung != null) continue;
          beschreibung =
            `${ziel.tagName.toLowerCase()}[${(ziel.getAttribute('aria-label') ?? ziel.textContent ?? '').trim().slice(0, 30)}] ` +
            `bei (${Math.round(zr.x)},${Math.round(zr.y)}) ${Math.round(zr.width)}×${Math.round(zr.height)} ` +
            `vollständig hinter ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ` +
            `(${getComputedStyle(el).position}); am Mittelpunkt liegt ` +
            `${amPunkt == null ? 'nichts' : `${amPunkt.tagName.toLowerCase()}.${String(amPunkt.className).slice(0, 30)}`}`;
          // Kein `break`: die Überlappung weiterer Kandidaten zählt mit, der Befund bleibt der erste.
        }
        return {
          beschreibung,
          inTabelle: ziel.closest('.ant-table') != null,
          kandidaten: kandidaten.length,
          kennung: fokus.getAttribute('data-e2e-fokus'),
          beruehrt,
          anTabellenkopf,
          inRegion: region != null && ziel.closest(region) != null,
          rest: beschnitt ? { sichtbar: Math.max(0, sr.bottom - sr.top), ziel: zr.height } : null,
        };
      },
      {
        zusatz: optionen.zusatzKandidaten ?? [],
        region: optionen.region ?? null,
        beschnitt: optionen.beschnitt ?? false,
      },
    );

    if (schritt == null) continue;
    stoppsGesamt += 1;
    if (schritt.inTabelle) stoppsInTabelle += 1;
    if (schritt.beruehrt) stoppsBeruehrt += 1;
    if (schritt.anTabellenkopf) stoppsAnTabellenkopf += 1;
    if (schritt.inRegion) {
      stoppsInRegion += 1;
      if (
        schritt.rest != null &&
        (kleinsterRestInRegion == null ||
          schritt.rest.sichtbar / schritt.rest.ziel <
            kleinsterRestInRegion.sichtbar / kleinsterRestInRegion.ziel)
      ) {
        kleinsterRestInRegion = schritt.rest;
      }
    }
    fixierteKandidaten = Math.max(fixierteKandidaten, schritt.kandidaten);
    if (schritt.beschreibung) verdeckt.push(schritt.beschreibung);
    if (schritt.kennung) besuchteZiele.add(schritt.kennung);
  }

  return {
    verdeckt,
    stoppsInTabelle,
    stoppsGesamt,
    fixierteKandidaten,
    besuchteZiele: [...besuchteZiele],
    stoppsBeruehrt,
    stoppsAnTabellenkopf,
    stoppsInRegion,
    kleinsterRestInRegion,
  };
}
