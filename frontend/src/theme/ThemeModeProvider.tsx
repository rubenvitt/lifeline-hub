import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import deDE from 'antd/locale/de_DE';
import { antdToken, farbenDunkel, farbenHell } from './tokens';

/** Vom Nutzer wählbarer Modus. `system` folgt der OS-Einstellung. */
export type ThemeModus = 'system' | 'light' | 'dark';
/** Tatsächlich angewandtes Theme nach Auflösung von `system`. */
export type EffektivesTheme = 'light' | 'dark';

const SPEICHER_SCHLUESSEL = 'lifeline-hub.theme';

interface ThemeModeWert {
  modus: ThemeModus;
  effektiv: EffektivesTheme;
  setModus: (m: ThemeModus) => void;
}

const ThemeModeContext = createContext<ThemeModeWert | null>(null);

function istThemeModus(wert: string | null): wert is ThemeModus {
  return wert === 'system' || wert === 'light' || wert === 'dark';
}

function gespeicherterModus(): ThemeModus {
  const wert = localStorage.getItem(SPEICHER_SCHLUESSEL);
  return istThemeModus(wert) ? wert : 'system';
}

function systemBevorzugtDunkel(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [modus, setModusState] = useState<ThemeModus>(gespeicherterModus);
  const [systemDunkel, setSystemDunkel] = useState<boolean>(systemBevorzugtDunkel);

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

  const effektiv: EffektivesTheme = modus === 'system' ? (systemDunkel ? 'dark' : 'light') : modus;

  // `data-theme` + `color-scheme` am <html> setzen, damit reines CSS
  // (z. B. LoginPage, ETB-Berichtigungszeilen) auf den Modus reagieren kann.
  useEffect(() => {
    document.documentElement.dataset.theme = effektiv;
    document.documentElement.style.colorScheme = effektiv;
  }, [effektiv]);

  const wert = useMemo<ThemeModeWert>(
    () => ({ modus, effektiv, setModus }),
    [modus, effektiv, setModus],
  );

  return (
    <ThemeModeContext.Provider value={wert}>
      <ConfigProvider
        locale={deDE}
        theme={{
          // Die Farbrollen kommen je Modus aus derselben Quelle wie `rollen.css`
          // (LFH-352 · A0). Der antd-Algorithmus bleibt darunter: er leitet die
          // abgeleiteten Töne (Hover, Rand, Füllung) aus den gesetzten ab.
          token: antdToken(effektiv === 'dark' ? farbenDunkel : farbenHell),
          algorithm: effektiv === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

/**
 * Liefert den aktuellen Theme-Modus. Außerhalb des Providers (z. B. in
 * isolierten Tests) wird ein neutraler `system`-Default zurückgegeben, statt
 * zu werfen — so brauchen Komponententests keinen Theme-Wrapper.
 */
export function useThemeMode(): ThemeModeWert {
  const wert = useContext(ThemeModeContext);
  if (wert) return wert;
  return { modus: 'system', effektiv: 'light', setModus: () => {} };
}
