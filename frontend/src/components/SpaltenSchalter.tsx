import { Button, Checkbox, Dropdown } from 'antd';
import type { ReactNode } from 'react';
import { useViewport, type AbBreitePunkt } from './useViewport';

/**
 * Spaltensichtbarkeit und Spaltenschalter — EINE Zählwahrheit, zwei Träger (LFH-374).
 *
 * Kriterium 14 der Bedien-Leitlinie verlangt einen umschaltbaren Spaltensatz mit Zähler
 * ausgeblendeter Spalten. Die Rechnung dafür stand bis LFH-374 in `Datensicht.tsx`; seit
 * `KatalogTabelle` den Schalter als Opt-in trägt, liegt sie HIER, und beide Träger lesen von
 * hier. Der Grund ist die Importrichtung: `Datensicht` rendert seinen Tabellenzweig durch
 * `KatalogTabelle` — hätte das Primitiv den Schalter aus `Datensicht.tsx` geholt, wäre das
 * ein Zyklus, und eine zweite Kopie der Zählung wäre genau die Drift, gegen die die
 * Festlegung aus LFH-330 · B2 steht: ein Zähler, der lügen kann, verfehlt das Kriterium, für
 * das er existiert.
 *
 * Gearbeitet wird auf einem STRUKTURELLEN Minimaltyp ({@link SchaltbareSpalte}):
 * `DatensichtSpalte` erfüllt ihn ohne Zutun, `KatalogSpalte` mit Opt-in ebenso. `Datensicht`
 * exportiert die Namen weiter, damit Bestandsimporte unverändert bleiben — neue Aufrufer
 * importieren direkt von hier.
 */

/** Was Zählung und Schalter von einer Spalte wissen müssen — und nicht mehr. */
export interface SchaltbareSpalte<K extends string = string> {
  key: K;
  /** Klartext für den Schalter. Fehlt er, trägt ein String-`title`. */
  etikett?: string;
  /** `unknown`, weil antd hier auch Knoten und Funktionen erlaubt; gelesen wird nur ein String. */
  title?: unknown;
  /** Nicht abwählbar (Aktionsspalte). Spalte 0 ist es immer, unabhängig vom Flag. */
  immerSichtbar?: boolean;
  /** Erst ab dieser Breite sichtbar — und darunter vom Zähler mitgezählt. */
  abBreite?: AbBreitePunkt;
}

/** `etikett ?? title` (nur wenn `title` ein String ist), sonst `undefined` + DEV-Warnung. */
export function etikettVon(spalte: SchaltbareSpalte): string | undefined {
  if (spalte.etikett != null) return spalte.etikett;
  if (typeof spalte.title === 'string') return spalte.title;
  if (import.meta.env.DEV) {
    console.warn(
      `[Spaltenschalter] Spalte "${spalte.key}" hat kein etikett und keinen String-title. ` +
        'Karte, Spaltenschalter und Sortierauswahl brauchen einen Klartext — `etikett` setzen.',
    );
  }
  return undefined;
}

/** Sichtbare Spalten + Zähler — EINE Wahrheit aus Handauswahl UND `abBreite`. */
export function sichtbareSpalten<K extends string, S extends SchaltbareSpalte<K>>(args: {
  spalten: readonly S[];
  verborgen: ReadonlySet<K>;
  /**
   * Die zweite Handwahl (LFH-374 · D9): Spalten, die TROTZ unterschrittener Breite gezeigt
   * werden sollen. Ohne sie ließe sich eine per `abBreite` weggefallene Spalte nie
   * zurückholen — der Zähler zählte sie, der Schalter könnte aber nichts dagegen tun.
   * `verborgen` gewinnt immer: eine Spalte in beiden Mengen ist aus.
   */
  eingeblendet?: ReadonlySet<K>;
  abBreite: (punkt: AbBreitePunkt) => boolean;
}): { spalten: readonly S[]; anzahlVerborgen: number } {
  const { spalten, verborgen, eingeblendet, abBreite } = args;
  const sichtbar: S[] = [];
  let anzahlVerborgen = 0;
  spalten.forEach((spalte, index) => {
    /**
     * INDEX 0 IST NIE ENTFERNBAR. `KatalogTabelle` fixiert, was als Spalte 0 ANKOMMT,
     * nicht eine benannte. Fällt Spalte 0 weg, wird still eine ANDERE Spalte die fixierte
     * Kennung — kein Fehler, kein roter Test, nur eine falsche Fixierung. `immerSichtbar`
     * allein genügt dafür nicht: es ist ein Flag, das jemand vergisst.
     */
    if (index === 0 || spalte.immerSichtbar) {
      sichtbar.push(spalte);
      return;
    }
    // BEIDE Gründe in EINEM Zähler, und eine doppelt verborgene Spalte nur einmal —
    // ein Zähler, der „0 ausgeblendet" meldet, verfehlt das Kriterium, für das er da ist.
    const zuSchmal =
      spalte.abBreite != null && !abBreite(spalte.abBreite) && !eingeblendet?.has(spalte.key);
    if (verborgen.has(spalte.key) || zuSchmal) {
      anzahlVerborgen += 1;
      return;
    }
    sichtbar.push(spalte);
  });
  return { spalten: sichtbar, anzahlVerborgen };
}

/** Die abwählbaren Spalten: alles außer der Kennungsspalte und den `immerSichtbar`-Spalten. */
function waehlbareSpalten<K extends string>(
  spalten: readonly SchaltbareSpalte<K>[],
): readonly SchaltbareSpalte<K>[] {
  return spalten.filter((s, i) => i !== 0 && !s.immerSichtbar);
}

/**
 * Gibt es überhaupt etwas zu schalten? EINE Wahrheit für zwei Leser (LFH-391 · B4).
 *
 * Der Schalter selbst rendert bei `false` gar nichts — und die Kommandopalette darf dann
 * auch keinen Befehl „Spalten" anbieten, der auf einen nicht vorhandenen Schalter zeigt.
 * Rechnete jede Seite das für sich, wäre das derselbe Fehlermodus wie beim Spaltenzähler:
 * eine Angabe, die lügen kann, verfehlt genau das Kriterium, für das sie existiert.
 */
export function hatWaehlbareSpalten<K extends string>(
  spalten: readonly SchaltbareSpalte<K>[],
): boolean {
  return waehlbareSpalten(spalten).length > 0;
}

/** Der Schalter für Seiten, die ihn EINMAL über mehreren Sichten zeigen. */
export function SpaltenSchalter<K extends string>(props: {
  bezeichnung: string;
  spalten: readonly SchaltbareSpalte<K>[];
  aus: readonly K[];
  onAus: (schluessel: K[]) => void;
  /**
   * Optionale KONTROLLIERTE Offen-Achse. Ohne beide Props bleibt das Dropdown unkontrolliert
   * wie bisher — der Export ist für Seiten gedacht, die den Schalter selbst platzieren, und
   * ein Pflicht-Prop wäre eine Vertragsänderung ohne Gegenstand (gemessen: kein externer
   * Aufrufer). Gebraucht wird sie, weil die Kommandopalette den Schalter von AUSSEN öffnet:
   * `trigger={['click']}` allein hat keinen Weg hinein.
   */
  offen?: boolean;
  onOffen?: (offen: boolean) => void;
  /**
   * Die zweite Handwahl (D9): per Breite weggefallene, aber von Hand eingeblendete Spalten.
   * Ohne `onAn` bleibt eine weggefallene Spalte ohne Häkchen und lässt sich nicht
   * zurückholen — der Schalter verspricht dann nichts, was er nicht einlösen kann.
   */
  an?: readonly K[];
  onAn?: (schluessel: K[]) => void;
}): ReactNode {
  const { bezeichnung, spalten, aus, onAus, offen, onOffen, an = [], onAn } = props;
  // Der Schalter stellt die Breitenfrage SELBST, statt den Zähler übergeben zu bekommen:
  // sonst gäbe es zwei Stellen, an denen „wie viele sind ausgeblendet" gerechnet wird, und
  // die Seiten-Variante (ein Schalter über mehreren Sichten) driftete von der internen weg.
  const { abBreite } = useViewport();
  const { spalten: gezeigt, anzahlVerborgen } = sichtbareSpalten({
    spalten,
    verborgen: new Set(aus),
    eingeblendet: new Set(an),
    abBreite,
  });
  /**
   * Das Häkchen zeigt die WIRKLICHE Sichtbarkeit, aus derselben Funktion wie der Zähler.
   * Bis LFH-374 las es `!aus.includes(key)` — eine per Breite weggefallene Spalte stand
   * damit angehakt im Menü, obwohl sie in der Tabelle fehlte (D9).
   */
  const sichtbar = new Set(gezeigt.map((s) => s.key));
  const waehlbar = waehlbareSpalten(spalten);
  // Bewusst über {@link hatWaehlbareSpalten} statt über `waehlbar.length` — es ist genau die
  // Funktion, die auch die Palette liest. Wer die Bedingung hier ändert, sieht die zweite
  // Seite im selben Aufruf.
  if (!hatWaehlbareSpalten(spalten)) return null;

  /**
   * Sichtbar → per Hand aus (und aus `an` heraus, sonst hielte eine alte Einblendung sie
   * beim nächsten Umschalten fest). Verborgen → aus `aus` heraus, und fällt sie per Breite
   * weg, zusätzlich nach `an`. Ohne `onAn` fehlt der zweite Schritt — dann bleibt es beim
   * Häkchen, das die Wahrheit sagt.
   */
  const umschalten = (schluessel: K) => {
    if (sichtbar.has(schluessel)) {
      onAus([...aus.filter((k) => k !== schluessel), schluessel]);
      if (an.includes(schluessel)) onAn?.(an.filter((k) => k !== schluessel));
      return;
    }
    if (aus.includes(schluessel)) onAus(aus.filter((k) => k !== schluessel));
    const spalte = spalten.find((s) => s.key === schluessel);
    const zuSchmal = spalte?.abBreite != null && !abBreite(spalte.abBreite);
    if (zuSchmal && !an.includes(schluessel)) onAn?.([...an, schluessel]);
  };

  /**
   * Der Zähler steht als TEXT im Namen, nicht als Zähl-Abzeichen: ein antd-`Badge` mit
   * `count` und ohne `color` rendert auf `token.colorError` — Rot für einen Spaltenzähler
   * bricht „Rot bedient nichts" und Kriterium 7.
   *
   * Und er zählt BEIDE Ursachen (Handauswahl UND `abBreite`) aus {@link sichtbareSpalten},
   * nicht bloß `aus.length`: ein Zähler, der „1 ausgeblendet" meldet, während zwei Spalten
   * fehlen, verfehlt genau das Kriterium (14), für das er existiert.
   */
  const beschriftung =
    anzahlVerborgen === 0 ? 'Spalten' : `Spalten · ${anzahlVerborgen} ausgeblendet`;

  return (
    <Dropdown
      trigger={['click']}
      // `undefined` lässt rc-trigger in seinem unkontrollierten Zweig — die Achse ist
      // additiv, kein Bruch für Aufrufer ohne die Props.
      open={offen}
      onOpenChange={onOffen}
      /*
       * Der Fokus muss beim Öffnen IN das Menü wandern. Ohne `autoFocus` bleibt er am Knopf,
       * die Pfeiltasten heben keinen Eintrag hervor, und die Eingabetaste schließt das Menü
       * wieder — gemessen: nach `ArrowDown` stand `document.activeElement` weiter auf dem
       * Knopf und `.ant-dropdown-menu-item-active` bei 0.
       */
      autoFocus
      menu={{
        /*
         * Umgeschaltet wird am MENÜEINTRAG, nicht am Kontrollkästchen: rc-menu ruft `onClick`
         * auf beiden Wegen auf — Mausklick und Eingabe-/Leertaste auf dem hervorgehobenen
         * Eintrag. Hing der Umschalter allein am `onChange` des Kästchens, gab es nur einen
         * Mausweg; die Tastatur konnte den Schalter öffnen, aber keine Spalte umschalten
         * (WCAG 2.1.1). Der Nachweis liegt in `frontend/e2e/datensicht-schmal.spec.ts` und
         * nicht in Vitest: jsdom liefert kein Fokusverhalten für ein Portal-Menü.
         */
        onClick: ({ key }) => umschalten(key as K),
        items: waehlbar.map((spalte) => ({
          key: spalte.key,
          /*
           * Ohne `onAn` lässt sich eine per Breite weggefallene Spalte nicht zurückholen.
           * Gesperrt statt klickbar: ein Eintrag, der auf Klick still nichts tut, wäre von
           * einem kaputten nicht zu unterscheiden. Heute trägt jeder Aufrufer `onAn`.
           */
          disabled: !onAn && !sichtbar.has(spalte.key) && !aus.includes(spalte.key),
          label:
            (
              /*
               * Das Kästchen ist ANZEIGE, kein zweiter Umschalter: mit eigenem `onChange` würde
               * ein Mausklick darauf zusätzlich das `onClick` des Eintrags auslösen und die
               * Umschaltung im selben Atemzug zurücknehmen.
               */
              <Checkbox checked={sichtbar.has(spalte.key)}>
                {etikettVon(spalte) ?? spalte.key}
              </Checkbox>
            ),
        })),
      }}
    >
      {/* Kein `size`-Prop: die Höhe kommt aus `controlHeight` und zieht mit der Dichte mit. */}
      <Button aria-label={`${beschriftung} — ${bezeichnung}`}>{beschriftung}</Button>
    </Dropdown>
  );
}
