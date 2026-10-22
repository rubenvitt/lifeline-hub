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
 * `kennung` bildet die Greifer: `<kennung>-feld`, `<kennung>-wert`, `<kennung>-anteil`.
 * `attribute` (nur `data-*`) landen am `<li>`, etwa `data-sichtung`.
 *
 * `Verteilungsliste` ist die Liste ohne Paneel, mit `dichte="zeile"` klein genug für eine
 * Paneelzeile (Einheiten je Status im Abschnitt).
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

export function Verteilungsliste({
  zeilen,
  kennung = 'verteilung',
  dichte = 'paneel',
  ...rest
}: {
  zeilen: readonly Verteilungszeile[];
  kennung?: string;
  /** `paneel`: Zahl Mono 20 mit Polsterung; `zeile`: Mono 13 ohne Polsterung. */
  dichte?: 'paneel' | 'zeile';
} & Pick<HTMLAttributes<HTMLUListElement>, 'aria-label'>) {
  const { token, rollen } = useRollen();
  const dicht = dichte === 'zeile';
  return (
    <ul
      {...rest}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: dicht ? 0 : token.padding,
        display: 'grid',
        gap: dicht ? 6 : 14,
        // In einer Zahlspalte (rechtsbündiger Flex) nimmt die dichte Liste die volle Breite.
        ...(dicht ? { width: '100%' } : {}),
      }}
    >
      {zeilen.map((z) => (
        <li
          key={z.schluessel}
          {...z.attribute}
          style={{ display: 'flex', flexDirection: 'column', gap: dicht ? 3 : 6 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: dicht ? token.paddingXS : token.paddingSM,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                ...monoStil(dicht ? 10 : 12),
                letterSpacing: '0.06em',
                color: dicht ? rollen.gedaempft : rollen.text,
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
              style={{ ...monoStil(dicht ? 13 : 20, 500), color: rollen.text }}
            >
              {z.wert ?? '—'}
            </span>
          </div>
          {z.wert == null ? (
            // Ausfall: der Platz bleibt, die Spur nicht — sie sähe aus wie 0.
            <span aria-hidden="true" style={{ height: dicht ? 4 : 6, visibility: 'hidden' }} />
          ) : (
            <span
              aria-hidden="true"
              style={{ display: 'flex', height: dicht ? 4 : 6, background: rollen.flaeche3 }}
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
  ...basis
}: DashboardPaneelBasis & { zeilen: readonly Verteilungszeile[]; kennung?: string }) {
  return (
    <DashboardPaneel {...basis}>
      <Verteilungsliste zeilen={zeilen} kennung={kennung} />
    </DashboardPaneel>
  );
}
