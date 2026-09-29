import { useEffect, useState } from 'react';
import { Grid } from 'antd';
import type { Breakpoint } from 'antd';

/**
 * Viewport-Primitiv (LFH-329 · B1/H24) — **der einzige erlaubte Zugang** zu Breiten- und
 * Zeigerfragen im Produktivcode, erzwungen von `useViewport.guard.test.ts`.
 *
 * ── Die Schwellen kommen aus antd und werden NICHT gespiegelt ───────────────────────────
 * `md` = 768, `lg` = 992 (antd `theme/util/alias.js`). Eine zweite Wahrheit in
 * `theme/tokens.ts` driftete still. `screenMD` am `ConfigProvider` zu überschreiben ist
 * verboten: antds `validateBreakpoints` WIRFT bei widersprüchlichen Nachbarn.
 *
 * ── `xs` ist ausgeschlossen ─────────────────────────────────────────────────────────────
 * `xs` ist als einzige Stufe eine `max-width`-Abfrage; `abBreite('xs')` läse sich als Umkehrung
 * dessen, was der Name verspricht. {@link AbBreitePunkt} schließt die Stufe am Typ aus. Dieselbe
 * Warnung gilt für die roh mitgelieferte {@link ViewportZustand.screens}-Karte.
 *
 * ── Erst-Render ist BREIT, nicht schmal ─────────────────────────────────────────────────
 * `Grid.useBreakpoint()` liefert auf dem ersten Render `{}`. „Noch unbekannt" gilt als breit:
 * der Primärkontext Fükw bekommt den unkorrigierten Render, statt dass für einen Frame das
 * Handy-Layout aufblitzt.
 *
 * ── Zeigersignal: `(pointer: coarse)`, nicht `(any-pointer: coarse)` ────────────────────
 * `pointer` beschreibt den PRIMÄREN Zeiger; `any-pointer` schlüge auch am Fükw-Laptop mit
 * Touchscreen an. Das Signal belegt über {@link zeigerIstGrob} die Dichtestufe vor, wenn keine
 * Wahl gespeichert ist (LFH-361). Preis: ein 2-in-1-Tablet mit Tastatur meldet `fine` und
 * startet kompakt — lieber eine Stufe zu eng als ein Umschalter, der sich beim Neuladen
 * zurückdreht. Bauform wie `theme/ThemeModeProvider.tsx`: Abfrage im
 * `useState`-Initialisierer, Änderung über einen `change`-Zuhörer im Effekt.
 *
 * ── Neben, nicht statt der Container-Abfragen ───────────────────────────────────────────
 * Die Staffelung in `theme/sprache.css` (1100/700 px) misst die Fläche des INHALTS, dieser Hook
 * den Viewport. Zwei Fragen, zwei Zahlen.
 */

/** Zeigerabfrage für Berührungsbedienung. Bewusst der primäre Zeiger — siehe Dateikopf. */
const ZEIGER_GROB = '(pointer: coarse)';

/** Breakpoints, ab denen sinnvoll „mindestens so breit" gefragt werden kann — ohne `xs`. */
export type AbBreitePunkt = Exclude<Breakpoint, 'xs'>;

/** Die von antd gelieferte Screens-Karte; auf dem ersten Render leer. */
type ScreensKarte = Partial<Record<Breakpoint, boolean>>;

interface ViewportZustand {
  /**
   * Rohe antd-Karte, unverändert durchgereicht. Achtung: `screens.xs` ist eine
   * `max-width`-Aussage und damit nicht wie die übrigen Stufen zu lesen.
   */
  screens: ScreensKarte;
  /** Ist der Viewport mindestens so breit wie dieser Breakpoint? Unbekannt ⇒ ja. */
  abBreite: (punkt: AbBreitePunkt) => boolean;
  /** Schmaler als `md` (768) — der Handy-/Einhand-Fall. */
  istSchmal: boolean;
  /** Primärer Zeiger ist grob (Finger/Handschuh) statt Maus/Stift. */
  istBeruehrung: boolean;
}

/**
 * Reine Ableitung, damit die Erst-Render-Semantik prüfbar ist, ohne zu rendern.
 * `!== false` statt `=== true`: `undefined` (noch unbekannt) zählt als breit.
 */
export function abBreiteAus(screens: ScreensKarte, punkt: AbBreitePunkt): boolean {
  return screens[punkt] !== false;
}

/**
 * Einmalige Momentaufnahme der Zeigerart, ohne Hook und ohne Zuhörer — für Aufrufer, die VOR
 * dem ersten Render fragen: die Vorbelegung der Dichtestufe in `theme/ThemeModeProvider.tsx`
 * (LFH-361 · B5a).
 *
 * Sie steht HIER, weil der Viewport-Guard Medienabfragen im Primitiv verlangt und
 * `ThemeModeProvider.tsx` nur für die Dunkelmodus-Frage freigestellt ist.
 *
 * Wer auf ÄNDERUNGEN reagieren muss, nimmt {@link useViewport}, nicht dies.
 */
export function zeigerIstGrob(): boolean {
  return window.matchMedia(ZEIGER_GROB).matches;
}

export function useViewport(): ViewportZustand {
  const screens = Grid.useBreakpoint();
  const [istBeruehrung, setIstBeruehrung] = useState<boolean>(zeigerIstGrob);

  useEffect(() => {
    const abfrage = window.matchMedia(ZEIGER_GROB);
    const aktualisiere = (e: MediaQueryListEvent) => setIstBeruehrung(e.matches);
    abfrage.addEventListener('change', aktualisiere);
    return () => abfrage.removeEventListener('change', aktualisiere);
  }, []);

  const abBreite = (punkt: AbBreitePunkt) => abBreiteAus(screens, punkt);

  return { screens, abBreite, istSchmal: !abBreite('md'), istBeruehrung };
}
