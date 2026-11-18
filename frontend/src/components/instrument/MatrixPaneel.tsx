import type { ReactNode } from 'react';
import DashboardPaneel, { type DashboardPaneelBasis } from './DashboardPaneel';
import type { KennzahlTon } from './Kennzahl';
import { MATRIX_KLASSE } from './matrixGeometrie';
import { monoStil, useRollen } from './rollenwerte';
import './matrixPaneel.css';

/**
 * MatrixPaneel — Kategorien auf einer Stufenskala: je Zeile Name · Stufenbalken · Stufenwort,
 * darunter die Legende der Stufen in derselben Geometrie (Regel „Dashboard-Baukasten“,
 * `frontend/AGENTS.md`; Vorbild Gefahrenmatrix im Lagebild, LLH-1140).
 *
 * VIER STUFEN: die Spaltengeometrie steht in `matrixPaneel.css` (Container-Abfrage auf die
 * Paneelbreite, `matrixGeometrie.ts`), dort auf vier Segmente bemessen; deshalb ist `stufen` ein
 * Viertupel.
 *
 * Der Stufenbalken ist Dekoration (`aria-hidden`), der zweite Kanal das Stufenwort rechts; die
 * Zeile ist als Ganzes benannt (`beschriftung`). Farbe und Ton kommen vom Aufrufer, aufgelöst
 * (`warnstufeBalkenFarbe` …): der Baustein trägt keine Statuskarte. Ein Zeichen am Namen (etwa
 * „mit Erläuterung“) reicht der Aufrufer als `zusatz`, seine Legende als `unterLegende`.
 *
 * `kennung` bildet die Greifer: `<kennung>zeile`, `<kennung>balken`, `<kennung>legende`
 * (`gefahren` → `gefahrenzeile`).
 */

export interface Matrixzeile {
  schluessel: string;
  name: string;
  /** Zeichen hinter dem Namen, für Hilfstechnik verborgen (steht in `beschriftung`). */
  zusatz?: ReactNode;
  /** Zugänglicher Name der Zeile („Feuer: hoch“). */
  beschriftung: string;
  /** Gefüllte Stufen 0…4. */
  rang: number;
  /** Füllfarbe der gefüllten Stufen; `null` = Spurfarbe. */
  farbe: string | null;
  /** Wort rechts, zugleich `data-stufe`. */
  stufenwort: string;
  /** Ton des Stufenworts: `achtung`/`alarm` in ihrer Textrolle, sonst gedämpft. */
  ton: KennzahlTon;
}

export default function MatrixPaneel({
  zeilen,
  stufen,
  kennung = 'matrix',
  unterLegende,
  ...basis
}: DashboardPaneelBasis & {
  zeilen: readonly Matrixzeile[];
  /** Wortlaut der vier Stufen, aufsteigend. */
  stufen: readonly [string, string, string, string];
  kennung?: string;
  unterLegende?: ReactNode;
}) {
  const { token, rollen } = useRollen();
  return (
    <DashboardPaneel {...basis}>
      <div
        className={MATRIX_KLASSE.wurzel}
        style={{ padding: token.padding, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {zeilen.map((z) => (
            <li
              key={z.schluessel}
              data-lfh={`${kennung}zeile`}
              data-stufe={z.stufenwort}
              aria-label={z.beschriftung}
              className={MATRIX_KLASSE.zeile}
              style={{ gap: token.paddingSM }}
            >
              {/* Silbentrennung statt Bruch an beliebiger Stelle (`lang="de"` steht in
                  index.html). Das Zeichen steht am Namen: die Spalte des Stufenworts trägt
                  „niedrig“ knapp, dort deckte es das Wort. */}
              <span
                style={{
                  fontSize: 12,
                  color: rollen.text2,
                  hyphens: 'auto',
                  overflowWrap: 'break-word',
                }}
              >
                {z.name}
                {z.zusatz != null && <> {z.zusatz}</>}
              </span>
              {/* Dekoration neben dem Wort — der zweite Kanal ist das Stufenwort rechts. */}
              <span
                aria-hidden="true"
                data-lfh={`${kennung}balken`}
                className={MATRIX_KLASSE.stufen}
                style={{ height: 14 }}
              >
                {stufen.map((_, i) => (
                  <span
                    key={i}
                    data-voll={i < z.rang ? 'ja' : 'nein'}
                    style={{ background: i < z.rang && z.farbe ? z.farbe : rollen.flaeche3 }}
                  />
                ))}
              </span>
              <span
                style={{
                  ...monoStil(11),
                  textAlign: 'end',
                  color:
                    z.ton === 'alarm'
                      ? rollen.alarmText
                      : z.ton === 'achtung'
                        ? rollen.achtungText
                        : rollen.gedaempft,
                }}
              >
                {z.stufenwort}
              </span>
            </li>
          ))}
        </ul>
        {/* Legende in derselben Geometrie wie die Balken (`matrixGeometrie.ts`). */}
        <div
          aria-hidden="true"
          data-lfh={`${kennung}legende`}
          className={`${MATRIX_KLASSE.zeile} ${MATRIX_KLASSE.legende}`}
          style={{
            gap: token.paddingSM,
            paddingTop: 6,
            borderTop: `1px solid ${rollen.linie}`,
          }}
        >
          <span className={MATRIX_KLASSE.fueller} />
          <span className={MATRIX_KLASSE.stufen} style={{ ...monoStil(10), color: rollen.schwach }}>
            {stufen.map((l) => (
              <span
                key={l}
                style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}
              >
                {l}
              </span>
            ))}
          </span>
          <span className={MATRIX_KLASSE.fueller} />
        </div>
        {unterLegende}
      </div>
    </DashboardPaneel>
  );
}
