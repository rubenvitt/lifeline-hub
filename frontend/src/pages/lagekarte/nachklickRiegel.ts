/**
 * Nachklick-Riegel für den langen Druck (LFH-776, Spec `lagekarte-kontextmenue`, „Loslassen nach dem
 * langen Druck ist kein Tipp“; `openspec/changes/archive/2026-10-03-lfh-776-lagekarte-kontextmenue/design.md` D3).
 *
 * maplibre (ab 6.11) feuert `contextmenu` nach 500 ms Halten, der Finger liegt dann NOCH. Was danach
 * kommt — das native `contextmenu` von Android-Chrome, die Kompatibilitäts-Mausereignisse und der
 * `click` beim Abheben —, schlösse das gerade geöffnete Menü sofort (rc-trigger hört am `window` in
 * der Capture-Phase auf `mousedown` und `contextmenu`) oder landete als Tipp auf der Karte (Auswahl,
 * Flächen-Auswahlmenü). Der Riegel hängt deshalb VOR jedem Dropdown am `window` (Capture) und
 * verschluckt diese Ereignisse, bis {@link NACHLAUF_MS} nach dem Abheben; ein neuer Finger löst ihn
 * sofort, ein bewusster Tipp kommt also immer an.
 *
 * Ob ein `contextmenu` aus einem langen Druck stammt, weiß nur, wer mitführt, ob ein Finger liegt:
 * maplibres Ereignis ist selbst gebaut und wird nie im DOM ausgelöst (`isTrusted` taugt nicht).
 */

/** Wie lange nach dem Abheben Nachklicks noch verschluckt werden. */
export const NACHLAUF_MS = 400;

const GESCHLUCKT = ['contextmenu', 'mousedown', 'mouseup', 'click'] as const;

export interface NachklickRiegel {
  /**
   * Für ein `contextmenu` der Karte: `'touch'`, wenn ein Finger liegt (langer Druck) — dann ist der
   * Riegel ab jetzt scharf —, sonst `'maus'` (Rechtsklick, kein Riegel).
   */
  quelleFuerKontextmenue(): 'maus' | 'touch';
  abbauen(): void;
}

export function erzeugeNachklickRiegel(
  container: HTMLElement,
  fenster: Window = window,
): NachklickRiegel {
  let fingerLiegt = false;
  let scharf = false;
  let nachlauf: ReturnType<typeof setTimeout> | undefined;

  const loesen = () => {
    scharf = false;
    if (nachlauf !== undefined) clearTimeout(nachlauf);
    nachlauf = undefined;
  };

  const beruehrt = (e: Event) => {
    // Ein neuer Finger ist eine neue Absicht: kein Nachklick des vorigen langen Drucks mehr — auch
    // nicht im Menü selbst, das im Portal außerhalb der Karte hängt.
    loesen();
    fingerLiegt = e.target instanceof Node && container.contains(e.target);
  };
  const abgehoben = (e: Event) => {
    const rest = (e as TouchEvent).touches?.length ?? 0;
    if (rest > 0) return;
    fingerLiegt = false;
    if (scharf) {
      if (nachlauf !== undefined) clearTimeout(nachlauf);
      nachlauf = setTimeout(loesen, NACHLAUF_MS);
    }
  };
  const schlucke = (e: Event) => {
    if (!scharf) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const opt = { capture: true, passive: true } as const;
  fenster.addEventListener('touchstart', beruehrt, opt);
  fenster.addEventListener('touchend', abgehoben, opt);
  fenster.addEventListener('touchcancel', abgehoben, opt);
  for (const t of GESCHLUCKT) fenster.addEventListener(t, schlucke, true);

  return {
    quelleFuerKontextmenue: () => {
      if (!fingerLiegt) return 'maus';
      scharf = true;
      return 'touch';
    },
    abbauen: () => {
      loesen();
      fenster.removeEventListener('touchstart', beruehrt, opt);
      fenster.removeEventListener('touchend', abgehoben, opt);
      fenster.removeEventListener('touchcancel', abgehoben, opt);
      for (const t of GESCHLUCKT) fenster.removeEventListener(t, schlucke, true);
    },
  };
}
