import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import Paneel, { type PaneelUeberschrift } from './Paneel';
import PaneelZustand, { PaneelLink, type PaneelDatenzustand } from './PaneelZustand';
import { useRollen } from './rollenwerte';

/**
 * DashboardPaneel — der Rahmen jedes Paneels einer Dashboard-Fläche (Regel „Dashboard-Baukasten“,
 * `frontend/AGENTS.md`, Gestaltungssprache; Vorbild Lagebild, LLH-1140).
 *
 * Kopf wie jedes `Paneel` (Augenbraue, Mono-Meta als Zähler), dazu der Sprung „… ↗“ ins Modul
 * (`PaneelLink`). Der Körper läuft durch `PaneelZustand`: Laden, Fehler und Leer sehen verschieden
 * aus (LFH-331), ein Ausfall nie wie ein leerer Bestand.
 *
 * FÜNFTER ZUSTAND `gesperrt` (LFH-669): das Modul der Quelle ist für die Person nicht
 * freigegeben. Das ist weder Ausfall noch leerer Bestand: der Körper nennt den Grund
 * (`gesperrtText`) in der Form des Leerzustands, ohne Ausweg, und der Kopf trägt keinen Sprung
 * ins gesperrte Modul. `PaneelZustand` selbst bleibt bei vier Zuständen.
 *
 * IM FUGENRASTER (Vorgabe `imRaster`): die Fläche (`DashboardFlaeche`) zeichnet die Linien, ein
 * eigener Paneelrand verdoppelte sie.
 *
 * Meta und Fuß reicht der Aufrufer durch, wie er sie je Zustand braucht — der Rahmen erfindet
 * keinen Zähler.
 *
 * KOPF-AKTION (LLH-1815): eine Handlung am Paneel selbst, kein Sprung ins Modul („Ausblenden“ der
 * Startliste im Überblick). Sie steht als Knopf ohne „↗“ hinter dem Sprung und in jedem Zustand,
 * auch gesperrt: sie führt in kein Modul.
 *
 * KOPF-HINWEIS (LLH-1934): eine Mitteilung im Kopf vor Sprung und Kopf-Aktion, etwa der
 * Sammelbanner des `StromPaneel`. Abstand wie zwischen Meta und Aktion, damit ein Hinweis an der
 * Stelle des Metas den Kopf nicht anders umbrechen lässt.
 */

/** Datenzustand eines Dashboard-Paneels: die vier des `PaneelZustand` plus `gesperrt`. */
export type DashboardZustand = PaneelDatenzustand | 'gesperrt';

/** Ein Sprung oder eine Leeraktion: Wortlaut und Handlung. */
export interface DashboardAktion {
  label: string;
  onKlick: () => void;
}

/** Was jedes Dashboard-Paneel trägt — die Typen (`VerteilungsPaneel` …) erweitern es. */
export interface DashboardPaneelBasis {
  /** Augenbraue und Name des Ladezustands. */
  titel: string;
  /** Überschriftenebene; Vorgabe `h2`. */
  ueberschrift?: PaneelUeberschrift;
  zustand: DashboardZustand;
  /** Mono-Meta rechts im Kopf, etwa der Zähler („12 erfasst“). */
  meta?: ReactNode;
  /** Sprung „… ↗“ ins Modul; entfällt bei `gesperrt`. */
  sprung?: DashboardAktion;
  /** Handlung am Paneel selbst, ohne „↗“, in jedem Zustand (siehe Dateikopf). */
  kopfAktion?: DashboardAktion;
  /** Mitteilung im Kopf vor Sprung und Kopf-Aktion (siehe Dateikopf). */
  kopfHinweis?: ReactNode;
  leerText: string;
  /** Grund im Zustand `gesperrt` („Modul Personen nicht freigegeben.“). */
  gesperrtText: string;
  /** Ausweg im Leerzustand; entfällt bei `gesperrt`. */
  leerAktion?: DashboardAktion;
  onNeuladen: () => void;
  fuss?: ReactNode;
  /** Ohne eigenen Rand im Fugenraster; Vorgabe `true`. */
  imRaster?: boolean;
  style?: CSSProperties;
}

/** Im Fugenraster trägt das Raster die Linien — ein eigener Paneelrahmen verdoppelte sie. */
export const IM_RASTER: CSSProperties = { border: 'none', minHeight: 0 };

export default function DashboardPaneel({
  titel,
  ueberschrift,
  zustand,
  meta,
  sprung,
  kopfAktion,
  kopfHinweis,
  leerText,
  gesperrtText,
  leerAktion,
  onNeuladen,
  fuss,
  imRaster = true,
  style,
  children,
}: DashboardPaneelBasis & { children: ReactNode }) {
  const { token } = useRollen();
  const gesperrt = zustand === 'gesperrt';
  const sprungLink =
    gesperrt || sprung == null ? null : (
      <PaneelLink label={sprung.label} onKlick={sprung.onKlick} />
    );
  const aktionKnopf =
    kopfAktion == null ? null : (
      <Button
        type="link"
        data-lfh="paneel-kopf-aktion"
        onClick={kopfAktion.onKlick}
        style={{ paddingInline: token.paddingXS, fontSize: 12 }}
      >
        {kopfAktion.label}
      </Button>
    );
  const aktion =
    sprungLink && aktionKnopf ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.paddingXS }}>
        {sprungLink}
        {aktionKnopf}
      </span>
    ) : (
      (sprungLink ?? aktionKnopf ?? undefined)
    );
  return (
    <Paneel
      titel={titel}
      ueberschrift={ueberschrift}
      meta={meta}
      aktion={
        kopfHinweis == null ? (
          aktion
        ) : (
          // Abstand wie `paneelKopfRechtsStil` zwischen Meta und Aktion (siehe Dateikopf).
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.paddingSM }}>
            {kopfHinweis}
            {aktion}
          </span>
        )
      }
      fuss={fuss}
      style={{ ...(imRaster ? IM_RASTER : {}), ...style }}
    >
      <PaneelZustand
        zustand={gesperrt ? 'leer' : zustand}
        titel={titel}
        leerText={gesperrt ? gesperrtText : leerText}
        leerAktion={gesperrt ? undefined : leerAktion?.label}
        onLeerAktion={leerAktion?.onKlick}
        onNeuladen={onNeuladen}
      >
        {children}
      </PaneelZustand>
    </Paneel>
  );
}
