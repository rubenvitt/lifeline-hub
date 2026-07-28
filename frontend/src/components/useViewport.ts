import { useEffect, useState } from 'react';
import { Grid } from 'antd';
import type { Breakpoint } from 'antd';

/**
 * Viewport-Primitiv (LFH-329 · B1/H24) — **der einzige erlaubte Zugang** zu Breiten- und
 * Zeigerfragen im Produktivcode. Erzwungen von `useViewport.guard.test.ts`, nicht bloß
 * behauptet.
 *
 * ── Die Schwellen kommen aus antd und werden NICHT gespiegelt ───────────────────────────
 * `md` = 768, `lg` = 992 (antd `theme/util/alias.js`). Eine zweite Wahrheit in
 * `theme/tokens.ts` würde still driften, und ein zusätzlicher Schlüssel in `flaeche` bräche
 * dessen `toEqual`-Pin auf exakt fünf Maße. Ein punktuelles Überschreiben von `screenMD`
 * am `ConfigProvider` ist außerdem verboten: antds `validateBreakpoints` WIRFT, wenn die
 * Min/Max-Nachbarn nicht widerspruchsfrei sind — das ist ein Laufzeitfehler, kein stiller
 * Rückfall.
 *
 * ── `xs` ist ausgeschlossen ─────────────────────────────────────────────────────────────
 * antds Screen-Karte ist nicht gleichförmig „mindestens so breit": `xs` ist als einzige
 * Stufe eine `max-width`-Abfrage, alle anderen sind `min-width`. Bei 1024 px wäre
 * `screens.xs` falsch — `abBreite('xs')` läse sich also als „schmaler als xs" und damit als
 * die Umkehrung dessen, was der Name verspricht. {@link AbBreitePunkt} schließt die Stufe
 * aus, damit der falsche Aufruf schon am Typecheck scheitert. Dieselbe Warnung gilt für
 * die roh mitgelieferte {@link ViewportZustand.screens}-Karte.
 *
 * ── Erst-Render ist BREIT, nicht schmal ─────────────────────────────────────────────────
 * `Grid.useBreakpoint()` liefert auf dem ersten Render `{}` und korrigiert erst im
 * `useLayoutEffect`. „Noch unbekannt" gilt hier deshalb als breit: der Primärkontext Fükw
 * bekommt den unkorrigierten Render, statt dass für einen Frame das Handy-Layout aufblitzt.
 *
 * ── Zeigersignal: `(pointer: coarse)`, nicht `(any-pointer: coarse)` ────────────────────
 * `pointer` beschreibt den PRIMÄREN Zeiger. Konservativ gewählt: `any-pointer` schlüge auch
 * am Fükw-Laptop mit Touchscreen an und erzwänge dort dauerhaft größere Trefflächen. Der
 * Preis ist das 2-in-1-Führungstablet mit angesteckter Tastatur, das dann `fine` meldet.
 * Was aus `istBeruehrung` folgt (Dichtestufe, Trefflächen), entscheidet ohnehin erst B5;
 * hier wird nur das Signal festgenagelt. Die Bauform — Abfrage einmal im
 * `useState`-Initialisierer lesen, Änderung über einen `change`-Zuhörer im Effekt — folgt
 * `theme/ThemeModeProvider.tsx`, das die Dunkelmodus-Frage genauso stellt.
 *
 * ── Neben, nicht statt der Container-Abfragen ───────────────────────────────────────────
 * Die Staffelung in `theme/sprache.css` (1100/700 px) bleibt bestehen: eine Container-Abfrage
 * misst die Fläche des INHALTS, dieser Hook den Viewport. Zwei Fragen, zwei Zahlen.
 */

/** Zeigerabfrage für Berührungsbedienung. Bewusst der primäre Zeiger — siehe Dateikopf. */
const ZEIGER_GROB = '(pointer: coarse)';

/** Breakpoints, ab denen sinnvoll „mindestens so breit" gefragt werden kann — ohne `xs`. */
export type AbBreitePunkt = Exclude<Breakpoint, 'xs'>;

/** Die von antd gelieferte Screens-Karte; auf dem ersten Render leer. */
export type ScreensKarte = Partial<Record<Breakpoint, boolean>>;

export interface ViewportZustand {
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

function zeigerIstGrob(): boolean {
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
