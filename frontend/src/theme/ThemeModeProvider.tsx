import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import deDE from 'antd/locale/de_DE';
import { antdToken, farbenDunkel, farbenHell, type Dichte } from './tokens';
import { zeigerIstGrob } from '../components/useViewport';

/** Vom Nutzer wählbarer Modus. `system` folgt der OS-Einstellung. */
export type ThemeModus = 'system' | 'light' | 'dark';
/** Tatsächlich angewandtes Theme nach Auflösung von `system`. */
export type EffektivesTheme = 'light' | 'dark';

const SPEICHER_SCHLUESSEL = 'lifeline-hub.theme';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/** Ausgangsstufe ohne gespeicherte Wahl: der Fükw-Arbeitsplatz (A1 Festlegung 1). */
const DICHTE_DEFAULT: Dichte = 'kompakt';

/** …und die Ausgangsstufe, wenn der primäre Zeiger grob ist (LFH-361 · B5a). */
const DICHTE_DEFAULT_BERUEHRUNG: Dichte = 'komfortabel';

interface ThemeModeWert {
  modus: ThemeModus;
  effektiv: EffektivesTheme;
  setModus: (m: ThemeModus) => void;
  /** Gewählte Bediendichte. Es gibt hier bewusst KEINEN zweiten Typ analog
   *  `ThemeModus`/`EffektivesTheme`: die Wahl IST die effektive Stufe.
   *
   *  Das bleibt auch nach LFH-361 so. Die Zeigerart entscheidet dort nur, WOMIT
   *  eine Sitzung ohne gespeicherte Wahl beginnt (`gespeicherteDichte`) — sie
   *  bleibt keine laufende Auflösung wie `system` beim Theme. Ein `automatisch`
   *  müsste von vier Bedienwegen mitgetragen werden und könnte die Wahl
   *  überstimmen; beides ist nicht gewollt. Die Abfrage selbst kommt aus
   *  `useViewport`, nicht aus einer zweiten Medienabfrage in diesem Provider. */
  dichte: Dichte;
  setDichte: (d: Dichte) => void;
}

const ThemeModeContext = createContext<ThemeModeWert | null>(null);

function istThemeModus(wert: string | null): wert is ThemeModus {
  return wert === 'system' || wert === 'light' || wert === 'dark';
}

function gespeicherterModus(): ThemeModus {
  const wert = localStorage.getItem(SPEICHER_SCHLUESSEL);
  return istThemeModus(wert) ? wert : 'system';
}

function istDichte(wert: string | null): wert is Dichte {
  return wert === 'kompakt' || wert === 'komfortabel' || wert === 'handschuh';
}

/**
 * Die Stufe, mit der eine Sitzung beginnt (LFH-361 · B5a).
 *
 * Reihenfolge ist die Aussage: eine getroffene Wahl gewinnt IMMER, das
 * Kontextsignal belegt nur vor. Andersherum wäre der Dichte-Umschalter auf
 * jedem Gerät mit grobem Zeiger ein Knopf, der sich beim Neuladen selbst
 * zurückdreht.
 *
 * Ein unbekannter gespeicherter Wert (alte Version, Handeingriff) fällt auf das
 * Kontextsignal zurück, nicht auf `kompakt` — er ist keine Wahl, sondern Müll.
 *
 * Die Zeigerfrage kommt aus dem Viewport-Primitiv, nicht aus einem eigenen
 * `matchMedia` hier: siehe die Begründung an `zeigerIstGrob`.
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

  // Die zweite Hälfte des Dichte-Schalters: das Merkmal am <html> schaltet die
  // `[data-dichte='…']`-Blöcke in `rollen.css` und damit alle `var(--lfh-luft-*)`-
  // Konsumenten. Ohne diese Zeile folgte nur die antd-Fläche, das
  // handgeschriebene CSS daneben bliebe kompakt — eine halb umgeschaltete Stufe,
  // die nichts bricht und erst im Einsatz auffällt.
  //
  // Gesetzt wird für ALLE drei Stufen, auch für `kompakt` (kein bedingtes
  // Entfernen): `kompakt` lebt in `rollen.css` unter `:root` und braucht deshalb
  // keinen eigenen Block. Wer je einen `[data-dichte='kompakt']`-Block ergänzt,
  // muss `DICHTE_BLOECKE` und die Partitionsprüfung in `rollen.guard.test.ts`
  // nachziehen — sonst prüft der Guard die kompakte Stufe weiter gegen `:root`.
  useEffect(() => {
    document.documentElement.dataset.dichte = dichte;
  }, [dichte]);

  const wert = useMemo<ThemeModeWert>(
    () => ({ modus, effektiv, setModus, dichte, setDichte }),
    [modus, effektiv, setModus, dichte, setDichte],
  );

  return (
    <ThemeModeContext.Provider value={wert}>
      <ConfigProvider
        locale={deDE}
        theme={{
          // Die Farbrollen kommen je Modus aus derselben Quelle wie `rollen.css`
          // (LFH-352 · A0). Der antd-Algorithmus bleibt darunter: er leitet die
          // abgeleiteten Töne (Hover, Rand, Füllung) aus den gesetzten ab.
          //
          // Die Dichte kommt seit LFH-329 · B1 aus der Benutzerwahl (vorher stand
          // sie fest auf `kompakt`, weil A2 nur den Träger baute). Sie hängt genau
          // hier und nicht an einer Größen-Prop je Element: die Steuerhöhe trägt
          // alle Steuerelemente auf einmal, während die verworfene Prop bei 40 px
          // endet und die 48-/72-px-Stufen nicht darstellen kann.
          //
          // Seit LFH-361 · B5a belegt die Zeigerart die Stufe vor, wenn noch keine
          // Wahl gespeichert ist (`gespeicherteDichte`), und `antdToken` setzt die
          // kleine Steuerhöhe mit — sonst rechnete antd sie unter den Boden aus
          // A1 Gate 3 zurück und die Staffel griffe an jedem Element vorbei, das
          // eine Bibliothek intern klein nennt.
          token: antdToken(effektiv === 'dark' ? farbenDunkel : farbenHell, dichte),
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
  return {
    modus: 'system',
    effektiv: 'light',
    setModus: () => {},
    dichte: DICHTE_DEFAULT,
    setDichte: () => {},
  };
}

/**
 * Benannter Zugang zur Bediendichte (LFH-329 · B1).
 *
 * Beide Achsen teilen einen Provider (ein Context, ein `useMemo`), aber sie
 * teilen keinen Namen: wer eine Trefffläche umschaltet, soll nicht `useThemeMode`
 * lesen müssen. Jeder Bedienweg ist dieselbe Quelle — seit LFH-392 sind das die
 * Umschaltgruppe im Benutzermenü (auf jeder Breite, der einzige Weg, der die
 * aktive Stufe auch ANZEIGT) und die Kommandopalette. Der frühere dritte, ein
 * Segmented-Paar in der Kopfzeile, ist fort: sechs Ziele für zwei Einstellungen
 * in einer Aktionsreihe, deren Wahl im Menü darunter schon vollständig lag.
 * Unverzichtbar bleibt der Menüweg, weil A1 dem Führungs-Tablet und dem mobilen
 * Kontext `komfortabel` und `handschuh` zuweist.
 *
 * Das zurückgegebene Objekt ist je Aufruf frisch — es gehört NICHT in ein
 * Dependency-Array. Stabil sind `dichte` (ein String) und `setDichte` (per
 * `useCallback` identitätsstabil); genau die zwei gehören hinein.
 */
export function useDichte(): { dichte: Dichte; setDichte: (d: Dichte) => void } {
  const { dichte, setDichte } = useThemeMode();
  return { dichte, setDichte };
}
