import type { HTMLAttributes } from 'react';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import { monoStil, useRollen } from './rollenwerte';

/**
 * VerteilungsPaneel — eine Menge nach Kategorien: je Zeile Wort, Zahl und darunter ein
 * Anteilsbalken (Regel „Dashboard-Baukasten“, `frontend/AGENTS.md`; Vorbild Sichtung im Lagebild,
 * LLH-1140). Abnehmer: Sichtung nach BBK, Einheiten nach FMS-Status, Einheiten je Status.
 *
 * ZAHL FÜHRT, der Balken ergänzt nur (wie `Aufgliederung`): die Zahl steht in Mono 20 rechts, der
 * Balken ist `aria-hidden`. Der zweite Kanal (WCAG 1.4.1) ist das Wort, nie die Farbe.
 *
 * AUSFALL ALS „—“: eine Kategorie mit `wert: null` (Quelle unbekannt) zeigt „—“ und keinen Balken
 * — eine leere Spur sähe aus wie 0. Der Platz des Balkens bleibt (keine springende Zeile).
 *
 * FARBEN KOMMEN VOM AUFRUFER, aufgelöst (`sichtungsfarben`, `rollenFarbe` …); der Baustein trägt
 * keine Statuskarte. `farbfeld` setzt ein umrandetes Farbfeld vor das Wort (Fachfarben wie BBK:
 * Gelb auf Hell und Schwarz auf Dunkel wären als Schrift unlesbar), `balkenKontur` eine
 * Innenkontur, wenn die Füllung auf der Spur verschwände (Schwarz auf Nacht).
 *
 * `kennung` bildet die Greifer: `<kennung>-wort`, `-feld`, `-wert`, `-anteil`.
 * `attribute` (nur `data-*`) landen am `<li>`, etwa `data-sichtung`.
 *
 * `Verteilungsliste` ist die Liste ohne Paneel, mit `dichte="zeile"` klein genug für eine
 * Paneelzeile (Einheiten je Status im Abschnitt). `dichte="kompakt"` hält einen Paneelkopf über
 * einer Vergleichstabelle niedrig (Meldebild).
 */

export interface Verteilungszeile {
  schluessel: string;
  /** Wortlaut der Kategorie — Pflicht, er ist der zweite Kanal. */
  wort: string;
  /** Gedämpfte Beschreibung zwischen Wort und Zahl. */
  beschreibung?: string;
  /** Zahl der Kategorie; `null` = Stand unbekannt („—“). */
  wert: number | null;
  /** Anteil 0…1 für den Balken (`anteil` aus `Aufgliederung`). */
  anteil: number;
  balkenFarbe: string;
  balkenKontur?: string;
  farbfeld?: { farbe: string; umrandung: string };
  attribute?: Record<`data-${string}`, string>;
}

/** Anteil als Prozent mit einer Nachkommastelle — rein. */
export function anteilProzent(anteil: number): string {
  const sicher = Number.isFinite(anteil) ? Math.min(1, Math.max(0, anteil)) : 0;
  return `${Math.round(sicher * 1000) / 10}%`;
}

/** Maße je Dichte: Zahl, Wort, Abstand, Balken. */
const DICHTE = {
  paneel: { wert: 20, wort: 12, abstand: 14, zeile: 6, balken: 6 },
  kompakt: { wert: 15, wort: 12, abstand: 8, zeile: 4, balken: 4 },
  zeile: { wert: 13, wort: 10, abstand: 6, zeile: 3, balken: 4 },
} as const;

/**
 * `paneel`: Zahl Mono 20 (Lagebild); `kompakt`: Mono 15 mit knapper Polsterung, für einen Kopf über
 * einer Vergleichstabelle (Meldebild); `zeile`: Mono 13 ohne Polsterung, in einer Paneelzeile.
 */
export type VerteilungsDichte = keyof typeof DICHTE;

export function Verteilungsliste({
  zeilen,
  kennung = 'verteilung',
  dichte = 'paneel',
  ...rest
}: {
  zeilen: readonly Verteilungszeile[];
  kennung?: string;
  dichte?: VerteilungsDichte;
} & Pick<HTMLAttributes<HTMLUListElement>, 'aria-label'>) {
  const { token, rollen } = useRollen();
  const mass = DICHTE[dichte];
  const inZeile = dichte === 'zeile';
  return (
    <ul
      {...rest}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: inZeile
          ? 0
          : dichte === 'kompakt'
            ? `${token.paddingSM}px ${token.padding}px`
            : token.padding,
        display: 'grid',
        gap: mass.abstand,
        // In einer Zahlspalte (rechtsbündiger Flex) nimmt die Liste die volle Breite.
        ...(inZeile ? { width: '100%' } : {}),
      }}
    >
      {zeilen.map((z) => (
        <li
          key={z.schluessel}
          {...z.attribute}
          style={{ display: 'flex', flexDirection: 'column', gap: mass.zeile }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: inZeile ? token.paddingXS : token.paddingSM,
            }}
          >
            <span
              data-lfh={`${kennung}-wort`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                ...monoStil(mass.wort),
                letterSpacing: '0.06em',
                color: inZeile ? rollen.gedaempft : rollen.text,
              }}
            >
              {z.farbfeld && (
                <span
                  aria-hidden="true"
                  data-lfh={`${kennung}-feld`}
                  style={{
                    width: 9,
                    height: 9,
                    background: z.farbfeld.farbe,
                    border: `1px solid ${z.farbfeld.umrandung}`,
                  }}
                />
              )}
              {z.wort}
            </span>
            <span style={{ flex: '1 1 auto', fontSize: 11, color: rollen.schwach }}>
              {z.beschreibung}
            </span>
            <span
              data-lfh={`${kennung}-wert`}
              style={{ ...monoStil(mass.wert, 500), color: rollen.text }}
            >
              {z.wert ?? '—'}
            </span>
          </div>
          {z.wert == null ? (
            // Ausfall: der Platz bleibt, die Spur nicht — sie sähe aus wie 0.
            <span aria-hidden="true" style={{ height: mass.balken, visibility: 'hidden' }} />
          ) : (
            <span
              aria-hidden="true"
              style={{ display: 'flex', height: mass.balken, background: rollen.flaeche3 }}
            >
              <span
                data-lfh={`${kennung}-anteil`}
                style={{
                  width: anteilProzent(z.anteil),
                  background: z.balkenFarbe,
                  boxShadow: z.balkenKontur ? `inset 0 0 0 1px ${z.balkenKontur}` : undefined,
                }}
              />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function VerteilungsPaneel({
  zeilen,
  kennung,
  dichte = 'paneel',
  ...basis
}: DashboardPaneelBasis & {
  zeilen: readonly Verteilungszeile[];
  kennung?: string;
  /** `paneel` oder `kompakt`; `zeile` gehört in eine Paneelzeile, nicht in ein Paneel. */
  dichte?: Exclude<VerteilungsDichte, 'zeile'>;
}) {
  return (
    <DashboardPaneel {...basis}>
      <Verteilungsliste zeilen={zeilen} kennung={kennung} dichte={dichte} />
    </DashboardPaneel>
  );
}
