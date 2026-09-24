import type { CSSProperties } from 'react';
import { Typography } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt } from '../../api/types';
import { monoStil, useRollen } from '../../components/instrument';
import { warnstufeFlaeche } from '../../theme/statusFarben';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, kombinationGueltig } from './gefahrenSchema';
import { SPALTENKOPF, zellFlaechenStil } from './GefahrenMatrix';

/**
 * Auszug der Gefahrenmatrix zum Lesen — für die Gefahrengebiet-Vorschau der Sprungpalette
 * (LFH-664, Entscheidung 5a des Auftraggebers).
 *
 * Zeilen sind nur die Gefahrentypen, die mindestens eine Zelle über „keine" tragen; Spalten
 * bleiben alle fünf Schutzobjekte, damit die Matrixgestalt der Fachseite erhalten bleibt.
 * Ohne solche Zeile steht ein Satz statt einer leeren Tabelle.
 *
 * Keine Bedienung: eine einfache Tabelle ohne Menü, ohne Knopf. Die volle `GefahrenMatrix`
 * mit `darfSchreiben={false}` zeigte 13 Zeilen gesperrter Knöpfe — genau das Bild, das der
 * Auftraggeber nicht will. Kopf und Zellfläche kommen aus `GefahrenMatrix`
 * (`SPALTENKOPF`, `zellFlaechenStil`), damit Auszug und Matrix dieselbe Zelle zeigen.
 *
 * Drei Zellzustände, im Text UND im zugänglichen Namen getrennt (WCAG 1.4.1):
 * bewertet → Kürzel der Stufe (auch „–" für ausdrücklich „keine"), gültig aber ohne
 * Bewertung → leer, „nicht bewertet"; ungültiges Paar → „n. a.", „nicht anwendbar".
 */
export default function GefahrenMatrixAuszug({ matrix }: { matrix: GefahrBewertung[] }) {
  const { token, rollen } = useRollen();

  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
  const zeilen = GEFAHRENTYPEN.filter((g) =>
    matrix.some(
      (m) =>
        m.gefahrentyp === g.wert &&
        m.warnstufe !== 'keine' &&
        kombinationGueltig(g.wert, m.schutzobjekt),
    ),
  );

  if (zeilen.length === 0) {
    return <Typography.Paragraph>Keine Gefahren bewertet.</Typography.Paragraph>;
  }

  const rand = `1px solid ${rollen.linie}`;
  const kopfStil: CSSProperties = {
    border: rand,
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    fontSize: 12,
    fontWeight: 600,
    color: rollen.text2,
    textAlign: 'center',
  };
  const zellStil: CSSProperties = {
    border: rand,
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    textAlign: 'center',
    ...monoStil(13, 500),
  };

  return (
    <table
      aria-label="Gefahrenmatrix, bewertete Gefahren"
      style={{ borderCollapse: 'collapse', width: '100%', color: rollen.text }}
    >
      <thead>
        <tr>
          <th scope="col" style={{ ...kopfStil, textAlign: 'start' }}>
            Gefahr
          </th>
          {SCHUTZOBJEKTE.map((obj) => {
            const { icon: Icon, kurz } = SPALTENKOPF[obj.wert];
            return (
              <th
                key={obj.wert}
                scope="col"
                aria-label={obj.label}
                title={obj.label}
                style={kopfStil}
              >
                <span
                  style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}
                >
                  <Icon aria-hidden size={14} />
                  <span>{kurz}</span>
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {zeilen.map((g) => (
          <tr key={g.wert}>
            <th
              scope="row"
              style={{ ...kopfStil, textAlign: 'start', fontWeight: 400, color: rollen.text }}
            >
              {g.label}
            </th>
            {SCHUTZOBJEKTE.map((obj) => {
              const name = `${g.label} × ${obj.label}`;
              if (!kombinationGueltig(g.wert, obj.wert)) {
                return (
                  <td
                    key={obj.wert}
                    aria-label={`${name}: nicht anwendbar`}
                    style={{ ...zellStil, fontFamily: undefined, color: rollen.gedaempft }}
                  >
                    n. a.
                  </td>
                );
              }
              const zelle = zelleVon(g.wert, obj.wert);
              if (!zelle) {
                return (
                  <td key={obj.wert} aria-label={`${name}: nicht bewertet`} style={zellStil} />
                );
              }
              const stufe = warnstufeFlaeche[zelle.warnstufe];
              return (
                <td
                  key={obj.wert}
                  data-warnstufe={zelle.warnstufe}
                  aria-label={`${name}: ${stufe.label}`}
                  style={{ ...zellStil, ...zellFlaechenStil(zelle.warnstufe, token) }}
                >
                  {stufe.kuerzel}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
