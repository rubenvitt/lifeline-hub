import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useViewport } from '../../components/useViewport';
import { useEinstellungMerken } from '../useEinstellungMerken';
import { loeseSchritteAuf, type AufgeloesterSchritt } from './rundgangAnker';
import { SCHLUESSEL_RUNDGANG, type RundgangTeil } from './rundgangSchluessel';
import { RUNDGANG_SCHRITTE } from './rundgangTexte';

// antd `Tour` erst laden, wenn ein Rundgang wirklich steht: die Einsatzliste braucht ihn sonst nie.
const RundgangTour = lazy(() => import('./RundgangTour'));

interface RundgangWert {
  ort: RundgangTeil | null;
  /** Fehlt ohne Ort, am Handschirm und für Gerätekonten (LLH-1990). */
  starte: (() => void) | undefined;
  starteTeil: (teil: RundgangTeil) => void;
  setzeOrt: (teil: RundgangTeil | null) => void;
  aktiv: boolean;
}

const STILL: RundgangWert = {
  ort: null,
  starte: undefined,
  starteTeil: () => {},
  setzeOrt: () => {},
  aktiv: false,
};

const RundgangKontext = createContext<RundgangWert>(STILL);

/**
 * Rundgang für Erstnutzer (LLH-1990, `frontend/AGENTS.md`, „Ausnahme Rundgang“): hält den Ort
 * (welcher Teil zur offenen Seite gehört) und den laufenden Rundgang. Seiten melden sich mit
 * {@link useRundgangOrt} an; Willkommenskarte und Sprungpalette starten über {@link useRundgang}.
 */
export function RundgangProvider({ children }: { children: ReactNode }) {
  const { benutzerId, merke } = useEinstellungMerken();
  const { abBreite } = useViewport();
  const aktiv = benutzerId != null && abBreite('md');
  const [ort, setzeOrt] = useState<RundgangTeil | null>(null);
  const [lauf, setLauf] = useState<{ teil: RundgangTeil; schritte: AufgeloesterSchritt[] } | null>(
    null,
  );

  const starteTeil = useCallback(
    (teil: RundgangTeil) => {
      if (!aktiv) return;
      // Ein Frame Luft: das Ziel steht erst nach dem Render der Seite im DOM.
      requestAnimationFrame(() => {
        const schritte = loeseSchritteAuf(RUNDGANG_SCHRITTE[teil]);
        if (schritte.length === 0) return;
        setLauf({ teil, schritte });
        // Sofort gemerkt: ein unterbrochener Rundgang kommt nicht von selbst wieder.
        merke(SCHLUESSEL_RUNDGANG[teil]);
      });
    },
    [aktiv, merke],
  );

  // Verlässt man den Ort (Navigation), geht der Rundgang zu.
  useEffect(() => {
    if (lauf && lauf.teil !== ort) setLauf(null);
  }, [lauf, ort]);

  const wert = useMemo<RundgangWert>(
    () => ({
      ort,
      starte: aktiv && ort ? () => starteTeil(ort) : undefined,
      starteTeil,
      setzeOrt,
      aktiv,
    }),
    [aktiv, ort, starteTeil],
  );

  return (
    <RundgangKontext.Provider value={wert}>
      {children}
      {lauf && (
        <Suspense fallback={null}>
          <RundgangTour key={lauf.teil} schritte={lauf.schritte} onClose={() => setLauf(null)} />
        </Suspense>
      )}
    </RundgangKontext.Provider>
  );
}

/** Ort und Starter des Rundgangs für Willkommenskarte und Sprungpalette. */
export function useRundgang(): { ort: RundgangTeil | null; starte: (() => void) | undefined } {
  const { ort, starte } = useContext(RundgangKontext);
  return { ort, starte };
}

/**
 * Meldet die Seite als Ort eines Teils an. Ist `selbststart` wahr, startet der Teil einmal je
 * Mount von selbst (Regeln: `rundgangSchluessel.ts`).
 */
/**
 * Ein automatisierter Browser (Playwright, `navigator.webdriver`) ist kein Erstnutzer: die
 * e2e-Suiten melden sich mit frischen Konten an und öffnen die Demo-Übung, die Maske des
 * Rundgangs hielte jeden Klick auf. Auf Wunsch startet er dort trotzdem.
 */
function istAutomatisiert(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

export function useRundgangOrt(teil: RundgangTeil, selbststart: boolean): void {
  const { setzeOrt, starteTeil, aktiv } = useContext(RundgangKontext);
  const versucht = useRef(false);

  useEffect(() => {
    setzeOrt(teil);
    return () => setzeOrt(null);
  }, [setzeOrt, teil]);

  useEffect(() => {
    if (!selbststart || !aktiv || versucht.current || istAutomatisiert()) return;
    versucht.current = true;
    starteTeil(teil);
  }, [selbststart, aktiv, starteTeil, teil]);
}
