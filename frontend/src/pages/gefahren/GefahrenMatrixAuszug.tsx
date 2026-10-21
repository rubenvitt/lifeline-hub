import type { CSSProperties } from 'react';
import { Typography } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt } from '../../api/types';
import { monoStil, useRollen } from '../../components/instrument';
import { warnstufeFlaeche } from '../../theme/statusFarben';
import { GEFAHRENTYPEN_ALPHABETISCH, SCHUTZOBJEKTE, kombinationGueltig } from './gefahrenSchema';
import { MIT_ERLAEUTERUNG, gesetzteGefahren, hatErlaeuterung } from './erlaeuterungen';
import { ErlaeuterungsMarke, ErlaeuterungsZeichen } from './ErlaeuterungsMarke';
import {
  SPALTENKOPF,
  ZELLE_NICHT_ANWENDBAR,
  schraffurStil,
  zellFlaechenStil,
  zellStufe,
} from './GefahrenMatrix';

/**
 * Auszug der Gefahrenmatrix zum Lesen, für die Gefahrengebiet-Vorschau der Sprungpalette.
 *
 * Zeilen: die Gefahrentypen der gesetzten Gefahren (`gesetzteGefahren`, LLH-1365): mindestens
 * eine Zelle über „keine" oder mit Erläuterung, in derselben Folge; Spalten: alle fünf
 * Schutzobjekte. Ohne solche Zeile steht ein Satz statt einer leeren Tabelle. Keine Bedienung — die
 * volle `GefahrenMatrix` zeigte 13 Zeilen gesperrter Knöpfe. Kopf, Zellfläche, Vorgabe und
 * Schraffur kommen aus `GefahrenMatrix`, damit beide dieselbe Zelle zeigen.
 *
 * Zwei Zellzustände (LLH-1090): gültig → Kürzel der Stufe, ohne Bewertung „–“ für die Vorgabe
 * „keine“; ungültig → Schraffur ohne Text, „nicht anwendbar“ im zugänglichen Namen. Ob die Matrix
 * beurteilt ist, nennt die Vorschau am Gebiet (`GefahrengebietVorschau`).
 *
 * Erläuterungen (LLH-1365): eine Zelle mit Erläuterung trägt die Marke der Matrix in der Ecke und
 * „· mit Erläuterung“ im Namen; den Text selbst zeigt der Auszug nicht (kompakt, design.md E1).
 */
export default function GefahrenMatrixAuszug({ matrix }: { matrix: GefahrBewertung[] }) {
  const { token, rollen } = useRollen();

  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
  // Welche Gefahren und in welcher Folge, sagt nur `gesetzteGefahren` (alphabetisch wie die
  // Matrix, LLH-1102); hier wird nur je Gefahrentyp einmal gezählt.
  const gesetzt = gesetzteGefahren(matrix);
  const typen = new Set(gesetzt.map((z) => z.gefahrentyp));
  const zeilen = [...typen].map(
    (typ) => GEFAHRENTYPEN_ALPHABETISCH.find((g) => g.wert === typ) ?? { wert: typ, label: typ },
  );
  // Jede gültige Zelle mit Erläuterung ist gesetzt: die Legende braucht keine eigene Auswahl.
  const mitMarke = gesetzt.some(hatErlaeuterung);

  if (zeilen.length === 0) {
    // Ohne Zeile gilt „keine“ (LLH-1090): ob jemand hingesehen hat, steht an der Beurteilung.
    return <Typography.Paragraph>Keine Gefahr über Stufe „keine“.</Typography.Paragraph>;
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
    <>
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
                    <td key={obj.wert} style={zellStil}>
                      <span
                        role="img"
                        data-lfh="nicht-anwendbar"
                        aria-label={`${name}: ${ZELLE_NICHT_ANWENDBAR.label}`}
                        style={{
                          display: 'block',
                          height: '1.25em',
                          ...schraffurStil(rollen.steuerRahmen),
                        }}
                      />
                    </td>
                  );
                }
                const zelle = zelleVon(g.wert, obj.wert);
                const wert = zellStufe(zelle);
                const stufe = warnstufeFlaeche[wert];
                const mitErlaeuterung = zelle != null && hatErlaeuterung(zelle);
                return (
                  <td
                    key={obj.wert}
                    data-warnstufe={wert}
                    aria-label={`${name}: ${stufe.label}${mitErlaeuterung ? MIT_ERLAEUTERUNG : ''}`}
                    // `relative`: Bezug der Marke in der Zellecke, wie der Knopf der Matrix.
                    style={{ ...zellStil, ...zellFlaechenStil(wert, token), position: 'relative' }}
                  >
                    {stufe.kuerzel}
                    {mitErlaeuterung && <ErlaeuterungsMarke />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Das Zeichen der Matrix mit seinem Wort, nur wenn eine Zelle es trägt (LLH-1365). */}
      {mitMarke && (
        <Typography.Text
          type="secondary"
          aria-hidden="true"
          data-lfh="auszug-legende-erlaeuterung"
          style={{ display: 'block', marginTop: token.marginXXS, fontSize: 12 }}
        >
          <ErlaeuterungsZeichen lfh="legende-erlaeuterung" /> mit Erläuterung
        </Typography.Text>
      )}
    </>
  );
}
