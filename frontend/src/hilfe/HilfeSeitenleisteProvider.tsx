import {
  Component,
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Drawer, Skeleton } from 'antd';
import { Link, useLocation } from 'react-router';
import { useAuthOptional } from '../auth/AuthContext';
import { GERAET_START_PFAD, HILFE_PFAD, hilfePfad } from '../routing/deeplinks';

/**
 * Hilfe-Seitenleiste (LLH-1824, `docs/anwender/AGENTS.md`, „Hilfe in der App“): „?“ im Kopf, die
 * Tasten ? und F1 und die Palette öffnen das Kapitel zur aktuellen Seite neben der Arbeit.
 *
 * Dieser Provider steht im Haupt-Chunk und lädt KEINE Kapiteltexte; die Leiste kommt per `lazy`
 * aus dem Hilfe-Chunk, erst beim ersten Öffnen (Wächter `hauptChunk.guard.test.ts`). Er sitzt in
 * `App.tsx` über der Sprungpalette, damit sie `oeffneHilfe` aus dem Kontext liest und die Leiste
 * auch beim Wechsel von der Einsatzliste in einen Einsatz offen bleibt.
 */

const HilfeSeitenleiste = lazy(() => import('./HilfeSeitenleiste'));

export type HilfeReiter = 'seite' | 'kuerzel';

export interface HilfeSeitenleisteWert {
  /** Fehlt, wo es keine Hilfe-Leiste gibt: Gerät, Hilfeseite, ohne Anmeldung, ohne Provider. */
  oeffneHilfe?: (reiter?: HilfeReiter) => void;
  offen: boolean;
  reiter: HilfeReiter;
  setzeReiter: (reiter: HilfeReiter) => void;
  schliesse: () => void;
}

const STILL: HilfeSeitenleisteWert = {
  offen: false,
  reiter: 'seite',
  setzeReiter: () => {},
  schliesse: () => {},
};

const HilfeKontext = createContext<HilfeSeitenleisteWert>(STILL);

export function useHilfeSeitenleiste(): HilfeSeitenleisteWert {
  return useContext(HilfeKontext);
}

/** Wo die Leiste angeboten wird: angemeldete Person, nicht auf Gerät, Hilfe- oder Anmeldeseite. */
export function istHilfeAktiv(
  pfad: string,
  auth: { benutzer: unknown; geraet: unknown } | null,
): boolean {
  if (!auth?.benutzer || auth.geraet) return false;
  const unter = (basis: string) => pfad === basis || pfad.startsWith(`${basis}/`);
  return !unter(HILFE_PFAD) && !unter(GERAET_START_PFAD) && !unter('/login');
}

/** „?“ (Umschalt erlaubt, deutsche Tastatur) oder F1, ohne Strg, ⌘ und Alt. */
export function istTasteFuerHilfe(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'F1') return !e.shiftKey;
  return e.key === '?';
}

/** Klasse an der Wurzel der Leiste (`rootClassName`); auch die Leiste selbst setzt sie. */
export const LEISTE_KLASSE = 'lfh-hilfe-seitenleiste';

function istEingabe(ziel: EventTarget | null): boolean {
  return (
    ziel instanceof Element &&
    ziel.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') != null
  );
}

/**
 * Ein offener Dialog oder Drawer außer der eigenen Leiste (die Sprungpalette ist ein antd-Modal).
 * Gefragt wird nach dem SICHTBAREN Overlay wie in `pages/lagekarte/zeichnenEsc.ts`: antd lässt
 * geschlossene Drawer mit `aria-modal` im Baum stehen, nur per Klasse versteckt.
 */
function istDialogOffen(): boolean {
  const offen = document.querySelectorAll<HTMLElement>(
    `.ant-modal-wrap, .ant-drawer-open:not(.${LEISTE_KLASSE})`,
  );
  return Array.from(offen).some((el) => getComputedStyle(el).display !== 'none');
}

/** Rückfall, wenn der Hilfe-Chunk nicht lädt (etwa ohne Netz und ohne Service Worker). */
class LeistenFehlergrenze extends Component<
  { children: ReactNode; schliesse: () => void },
  { fehler: boolean }
> {
  state = { fehler: false };
  static getDerivedStateFromError() {
    return { fehler: true };
  }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <Drawer
        open
        title="Hilfe"
        onClose={this.props.schliesse}
        rootClassName={LEISTE_KLASSE}
        mask={false}
      >
        <p>Hilfe ist gerade nicht verfügbar.</p>
        <Link to={hilfePfad()} onClick={this.props.schliesse}>
          Alle Kapitel
        </Link>
      </Drawer>
    );
  }
}

export function HilfeSeitenleisteProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const auth = useAuthOptional();
  const aktiv = istHilfeAktiv(pathname, auth);
  const [offen, setOffen] = useState(false);
  const [reiter, setzeReiter] = useState<HilfeReiter>('seite');
  // Erst nach dem ersten Öffnen laden, dann für die Sitzung behalten.
  const [geladen, setGeladen] = useState(false);
  const ausloeser = useRef<HTMLElement | null>(null);

  const oeffne = useCallback((r: HilfeReiter = 'seite') => {
    const fokus = document.activeElement;
    ausloeser.current = fokus instanceof HTMLElement && fokus !== document.body ? fokus : null;
    setzeReiter(r);
    setGeladen(true);
    setOffen(true);
  }, []);

  const schliesse = useCallback(() => {
    setOffen(false);
    const ziel = ausloeser.current;
    ausloeser.current = null;
    // Nach dem Schließen zurück an den Auslöser (Knopf, Eingabefeld der Taste F1).
    if (ziel) setTimeout(() => ziel.focus({ preventScroll: true }), 0);
  }, []);

  const offenRef = useRef(offen);
  offenRef.current = offen;

  useEffect(() => {
    if (!aktiv) return;
    function aufTaste(e: KeyboardEvent) {
      if (!istTasteFuerHilfe(e)) return;
      if (e.key === '?' && istEingabe(e.target)) return;
      if (istDialogOffen()) return;
      e.preventDefault();
      if (offenRef.current) schliesse();
      else oeffne('seite');
    }
    window.addEventListener('keydown', aufTaste);
    return () => window.removeEventListener('keydown', aufTaste);
  }, [aktiv, oeffne, schliesse]);

  // Verlässt man den Bereich (Abmelden, Hilfeseite), geht die Leiste zu.
  useEffect(() => {
    if (!aktiv) setOffen(false);
  }, [aktiv]);

  const wert = useMemo<HilfeSeitenleisteWert>(
    () =>
      aktiv
        ? { oeffneHilfe: oeffne, offen, reiter, setzeReiter, schliesse }
        : { ...STILL, offen: false },
    [aktiv, oeffne, offen, reiter, schliesse],
  );

  return (
    <HilfeKontext.Provider value={wert}>
      {children}
      {aktiv && geladen && (
        <LeistenFehlergrenze schliesse={schliesse}>
          <Suspense
            fallback={
              <Drawer
                open={offen}
                title="Hilfe"
                onClose={schliesse}
                rootClassName={LEISTE_KLASSE}
                mask={false}
              >
                <Skeleton active paragraph={{ rows: 8 }} />
              </Drawer>
            }
          >
            <HilfeSeitenleiste />
          </Suspense>
        </LeistenFehlergrenze>
      )}
    </HilfeKontext.Provider>
  );
}
