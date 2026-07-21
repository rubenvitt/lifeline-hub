/** Kanal zwischen den React-freien react-query-Cache-Callbacks und dem React-Baum (LFH-268/F24).
 *  Der QueryClient entsteht in `main.tsx` auf Modulebene und liegt in der Provider-Hierarchie
 *  ÜBER `AntApp` und `BrowserRouter` — seine `onError`-Closures können `message` und `navigate`
 *  deshalb strukturell nicht lesen. Ein window-CustomEvent ist im Projekt das etablierte Mittel
 *  dafür (vgl. `lfh:live-status`, `lfh:sofortmeldung`, `lfh:erinnerung-alarm`). */
export const SITZUNG_ABGELAUFEN = 'lfh:sitzung-abgelaufen';

/** Wiederhol-Sperre: bei Session-Ablauf laufen typischerweise mehrere Queries gleichzeitig in
 *  401. Ohne die Sperre gäbe es N Events und damit N `logout()`/`navigate()`-Versuche. */
let bereitsGemeldet = false;

/** Meldet einen erkannten Sitzungsablauf genau einmal — bis
 *  {@link sitzungsMeldungZuruecksetzen} die Sperre löst. */
export function meldeSitzungAbgelaufen(): void {
  if (bereitsGemeldet) return;
  bereitsGemeldet = true;
  window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
}

/** Löst die Sperre — aufzurufen, sobald wieder eine gültige Sitzung besteht (Login,
 *  `aktualisiere`). Sonst bliebe ein zweiter Ablauf in derselben Browser-Sitzung stumm. */
export function sitzungsMeldungZuruecksetzen(): void {
  bereitsGemeldet = false;
}
