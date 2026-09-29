import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import deDE from 'antd/locale/de_DE';
import {
  antdAlgorithmus,
  antdKnopf,
  antdKomponenten,
  antdToken,
  farbenDunkel,
  farbenHell,
  type Dichte,
} from './tokens';
import { zeigerIstGrob } from '../components/useViewport';

/** Vom Nutzer wählbarer Modus. `system` folgt der OS-Einstellung. */
export type ThemeModus = 'system' | 'light' | 'dark';
/** Tatsächlich angewandtes Theme nach Auflösung von `system`. */
export type EffektivesTheme = 'light' | 'dark';

const SPEICHER_SCHLUESSEL = 'lifeline-hub.theme';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** Ausgangsstufe ohne gespeicherte Wahl: der Fükw-Arbeitsplatz (A1 Festlegung 1). */
const DICHTE_DEFAULT: Dichte = 'kompakt';

/** …und die Ausgangsstufe, wenn der primäre Zeiger grob ist. */
const DICHTE_DEFAULT_BERUEHRUNG: Dichte = 'komfortabel';

interface ThemeModeWert {
  modus: ThemeModus;
  effektiv: EffektivesTheme;
  setModus: (m: ThemeModus) => void;
  /** Gewählte Bediendichte. Kein zweiter Typ wie bei `ThemeModus`/`EffektivesTheme`: die Wahl
   *  IST die effektive Stufe. Die Zeigerart entscheidet nur, womit eine Sitzung ohne
   *  gespeicherte Wahl beginnt (`gespeicherteDichte`); ein `automatisch` könnte die Wahl
   *  überstimmen. */
  dichte: Dichte;
  setDichte: (d: Dichte) => void;
}

const ThemeModeContext = createContext<ThemeModeWert | null>(null);

function istThemeModus(wert: string | null): wert is ThemeModus {
  return wert === 'system' || wert === 'light' || wert === 'dark';
}

/**
 * Modus ohne gespeicherte Wahl: NACHTBETRIEB. Gespiegelt im Bootstrap-Skript von `index.html`;
 * wer eines ändert, ändert beide.
 */
const MODUS_DEFAULT: ThemeModus = 'dark';

function gespeicherterModus(): ThemeModus {
  const wert = localStorage.getItem(SPEICHER_SCHLUESSEL);
  return istThemeModus(wert) ? wert : MODUS_DEFAULT;
}

function istDichte(wert: string | null): wert is Dichte {
  return wert === 'kompakt' || wert === 'komfortabel' || wert === 'handschuh';
}

/**
 * Die Stufe, mit der eine Sitzung beginnt. Eine getroffene Wahl gewinnt IMMER, die Zeigerart
 * belegt nur vor; sonst drehte sich der Dichte-Umschalter beim Neuladen selbst zurück. Ein
 * unbekannter gespeicherter Wert fällt auf das Zeigersignal zurück. Die Zeigerfrage kommt aus
 * `useViewport` (`zeigerIstGrob`), nicht aus einem eigenen `matchMedia`.
 */
function gespeicherteDichte(): Dichte {
  const wert = localStorage.getItem(DICHTE_SCHLUESSEL);
  if (istDichte(wert)) return wert;
  return zeigerIstGrob() ? DICHTE_DEFAULT_BERUEHRUNG : DICHTE_DEFAULT;
}

function systemBevorzugtDunkel(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [modus, setModusState] = useState<ThemeModus>(gespeicherterModus);
  const [systemDunkel, setSystemDunkel] = useState<boolean>(systemBevorzugtDunkel);
  const [dichte, setDichteState] = useState<Dichte>(gespeicherteDichte);

  // OS-Einstellung live verfolgen — relevant, sobald der Modus `system` ist.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const aktualisiere = (e: MediaQueryListEvent) => setSystemDunkel(e.matches);
    mql.addEventListener('change', aktualisiere);
    return () => mql.removeEventListener('change', aktualisiere);
  }, []);

  const setModus = useCallback((m: ThemeModus) => {
    setModusState(m);
    localStorage.setItem(SPEICHER_SCHLUESSEL, m);
  }, []);

  const setDichte = useCallback((d: Dichte) => {
    setDichteState(d);
    localStorage.setItem(DICHTE_SCHLUESSEL, d);
  }, []);

  const effektiv: EffektivesTheme = modus === 'system' ? (systemDunkel ? 'dark' : 'light') : modus;

  // `data-theme` + `color-scheme` am <html> setzen, damit reines CSS
  // (z. B. LoginPage, ETB-Berichtigungszeilen) auf den Modus reagieren kann.
  useEffect(() => {
    document.documentElement.dataset.theme = effektiv;
    document.documentElement.style.colorScheme = effektiv;
  }, [effektiv]);

  // Das Merkmal am <html> schaltet die `[data-dichte='…']`-Blöcke in `rollen.css`; ohne es folgte
  // nur die antd-Fläche und das handgeschriebene CSS bliebe kompakt. Gesetzt für ALLE Stufen:
  // `kompakt` lebt unter `:root`. Wer einen `[data-dichte='kompakt']`-Block ergänzt, zieht
  // `DICHTE_BLOECKE` in `rollen.guard.test.ts` nach.
  useEffect(() => {
    document.documentElement.dataset.dichte = dichte;
  }, [dichte]);

  const knopf = useMemo(() => antdKnopf(dichte), [dichte]);

  const wert = useMemo<ThemeModeWert>(
    () => ({ modus, effektiv, setModus, dichte, setDichte }),
    [modus, effektiv, setModus, dichte, setDichte],
  );

  return (
    <ThemeModeContext.Provider value={wert}>
      <ConfigProvider
        locale={deDE}
        // Boden der kurzen Achse (LFH-381): die Breite eines beschrifteten Knopfs folgt der Staffel
        // nur über diesen Kontext-Stil.
        button={knopf}
        theme={{
          // Farbrollen je Modus aus derselben Quelle wie `rollen.css`; die Dichte hängt hier und nicht
          // an einer Größen-Prop je Element (die endet bei 40 px). `antdToken` setzt die kleine
          // Steuerhöhe mit, sonst rechnete antd sie unter den Boden aus A1 Gate 3.
          token: antdToken(effektiv === 'dark' ? farbenDunkel : farbenHell, dichte),
          // Nachts hält `antdAlgorithmus` die Signalfarben auf ihrem Rollenwert.
          algorithm: antdAlgorithmus(effektiv === 'dark'),
          // antds Switch rechnet seine Maße aus der Schrift statt aus `controlHeight` (LFH-380).
          components: antdKomponenten(effektiv === 'dark' ? farbenDunkel : farbenHell, dichte),
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

/**
 * Liefert den aktuellen Theme-Modus. Außerhalb des Providers (z. B. in isolierten Tests) wird
 * die Vorgabe `dark` zurückgegeben statt zu werfen, dieselbe, mit der die App startet.
 */
export function useThemeMode(): ThemeModeWert {
  const wert = useContext(ThemeModeContext);
  if (wert) return wert;
  return {
    modus: MODUS_DEFAULT,
    effektiv: 'dark',
    setModus: () => {},
    dichte: DICHTE_DEFAULT,
    setDichte: () => {},
  };
}

/**
 * Benannter Zugang zur Bediendichte. Bedienwege sind die Umschaltgruppe im Benutzermenü (der
 * einzige, der die aktive Stufe auch anzeigt) und die Kommandopalette.
 *
 * Das zurückgegebene Objekt ist je Aufruf frisch und gehört NICHT in ein Dependency-Array;
 * `dichte` und `setDichte` (identitätsstabil) gehören hinein.
 */
export function useDichte(): { dichte: Dichte; setDichte: (d: Dichte) => void } {
  const { dichte, setDichte } = useThemeMode();
  return { dichte, setDichte };
}
