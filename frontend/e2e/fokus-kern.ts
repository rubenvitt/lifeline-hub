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
  /**
   * Stopps, deren Rechteck einen `sticky|fixed`-Knoten mindestens BERÜHRT (LFH-677, 2 px Spiel). Ein
   * Vorbedingungs-Zähler wie `stoppsInTabelle`: ohne ihn kann ein Durchlauf „0 verdeckt"
   * melden, obwohl nie ein Ziel in die Nähe der stehenden Fläche kam. Knoten, die den ganzen
   * Schirm decken (Maske eines Dialogs), zählen hier nicht — sie berühren jedes Ziel.
   */
  stoppsBeruehrt: number;
  /**
   * Davon die Stopps an der stehenden KOPFZEILE einer Tabelle (`.ant-table-sticky-holder`).
   * `stoppsBeruehrt` zählt jede stehende Fläche — auch die fixierte erste Spalte, die in jeder
   * Zeile steht — und kann deshalb nicht belegen, dass ein Lauf die Kopfzeile erreicht hat.
   */
  stoppsAnTabellenkopf: number;
  /**
   * Stopps innerhalb von {@link KernOptionen.region} (LFH-373). Vorbedingungs-Zähler wie
   * `stoppsInTabelle`: ohne ihn kann ein Lauf an der Kartenspalte vorbeilaufen, und
   * „0 verdeckt" wäre trivial wahr. Ohne `region` immer 0.
   */
  stoppsInRegion: number;
}

/**
 * Opt-in-Erweiterung des Kerns (LFH-373). Ohne dieses Argument rechnet der Kern exakt wie
 * vorher — er ist mit `fokus-verdeckung`, `befehl-aktionsleiste`, `dokumente`,
 * `pegel-pruefliste` und `betreuung-pruefliste` geteilt, und deren Zusicherungen dürfen sich nicht
 * still verschieben.
 */
export interface KernOptionen {
  /**
   * Zusätzliche Verdecker per Selektor, NEBEN den `sticky|fixed`-Knoten. Gebraucht für die
   * absolut positionierten Kartenaufbauten (Knopfblock, Überlagerung links, Fußbänder):
   * sie sind `position: absolute` und damit für die Vorgabe unsichtbar — ein Lauf über die
   * Lagekarte wäre ohne sie grün durch Konstruktion, und `fixierteKandidaten` käme allein von
   * den angepinnten Füßen der Rail und des Modulpanels.
   *
   * BEWUSST eine Liste und nicht „alles mit `position: absolute`": dann würden Canvas,
   * Marker und antd-Portale (Tooltips, Menüs) zu Kandidaten und lieferten falsche Treffer.
   */
  zusatzKandidaten?: string[];
  /** Selektor einer Region, deren Stopps `stoppsInRegion` zählt. */
  region?: string;
}

/**
 * Läuft `schritte` Tabulatorschritte und meldet jedes vollständig verdeckte Fokusziel.
 *
 * RICHTUNG (LFH-677): `taste` ist per Vorgabe `Tab`. Vorwärts rollt der Browser ein Ziel an
 * den UNTEREN Rand des Schirms — unter eine OBEN stehende Kopfzeile gerät es so nie. Wer die
 * Kopfzeile prüfen will, läuft zusätzlich mit `Shift+Tab`: dann rollt das Ziel an den oberen
 * Rand, genau unter die stehende Fläche.
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
  let fixierteKandidaten = 0;
  const besuchteZiele = new Set<string>();

  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press(taste);
    const schritt = await page.evaluate(
      ({ zusatz, region }) => {
        const fokus = document.activeElement;
        if (fokus == null || fokus === document.body || fokus === document.documentElement) {
          return null;
        }
        // Der innere Combobox-/Zahleneingabe-Input ist kleiner als das sichtbare Fokusziel.
        // Radio-Knopf (LFH-677): antd setzt dessen `input` auf 0 × 0 — ohne die Hülle fiele der
        // Stopp unten als „keine Fläche" still aus der Zählung. Normales Radio und Checkbox
        // brauchen das nicht: ihr `input` deckt Kreis bzw. Kästchen.
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
          };
        }

        const kandidaten = Array.from(document.querySelectorAll('body *')).filter((el) => {
          const stil = getComputedStyle(el);
          if (stil.position !== 'sticky' && stil.position !== 'fixed') return false;
          if (stil.visibility === 'hidden' || stil.display === 'none') return false;
          return !el.contains(ziel);
        });
        // Opt-in (LFH-373): die benannten Zusatzverdecker, mit denselben Ausschlüssen.
        for (const sel of zusatz) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            if (kandidaten.includes(el) || el.contains(ziel)) continue;
            const stil = getComputedStyle(el);
            if (stil.visibility === 'hidden' || stil.display === 'none') continue;
            kandidaten.push(el);
          }
        }

        const mx = zr.x + zr.width / 2;
        const my = zr.y + zr.height / 2;
        const amPunkt = document.elementFromPoint(mx, my);
        const punktGehoertZiel = amPunkt != null && (amPunkt === ziel || ziel.contains(amPunkt));

        let beschreibung: string | null = null;
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
            zr.left >= kr.left - 0.5 &&
            zr.right <= kr.right + 0.5 &&
            zr.top >= kr.top - 0.5 &&
            zr.bottom <= kr.bottom + 0.5;
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
        };
      },
      { zusatz: optionen.zusatzKandidaten ?? [], region: optionen.region ?? null },
    );

    if (schritt == null) continue;
    stoppsGesamt += 1;
    if (schritt.inTabelle) stoppsInTabelle += 1;
    if (schritt.beruehrt) stoppsBeruehrt += 1;
    if (schritt.anTabellenkopf) stoppsAnTabellenkopf += 1;
    if (schritt.inRegion) stoppsInRegion += 1;
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
  };
}
