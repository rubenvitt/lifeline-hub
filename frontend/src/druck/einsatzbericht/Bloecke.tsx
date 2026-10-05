import { theme } from 'antd';
import type { CSSProperties } from 'react';
import Markdown from '../../components/Markdown';
import { monoStil } from '../../components/instrument';
import type { Abschnitt, Einsatzbericht, Inhalt } from './verdichtung';

/**
 * Die gewählten Blöcke des Einsatzberichts auf Papier (LFH-726, Auswahl LFH-902). Bildet nur das
 * verdichtete Objekt ab (design.md D5) und kann deshalb nichts zeigen, was die Verdichtung nicht
 * hineingegeben hat — auch keinen abgewählten Block.
 *
 * Gliederung: der Druckkopf trägt `h2` („Einsatzbericht“), die Blöcke `h3`, ihre Abschnitte `h4`,
 * die Abschnitte des Lageberichts `h5`. Umbruchregeln (Überschrift bleibt beim Text, Zeile nicht
 * zerrissen, Tabellenkopf je Seite) kommen aus `druck/druck.css`.
 *
 * Tabellen sind schlichtes HTML wie im ETB-Druck (`etb/EtbDruckTabelle.tsx`, benannte Ausnahme):
 * ein Vordruck ohne Sortierung, Filter oder Zeilenaktion, kein Bedienort.
 */

/** Ziffern vorn (Zahl, Zeit, Stärke, Dauer) setzen Mono mit Tabellenziffern (`frontend/AGENTS.md`). */
const BEGINNT_MIT_ZIFFER = /^\d/;
/** Reine Nummer, Datum oder Uhrzeit bricht nicht um; Freitext (auch ein Titel) immer. */
const NUR_ZAHL_ODER_ZEIT = /^[\d.: ]+$/;

function InhaltAnzeige({ inhalt }: { inhalt: Inhalt }) {
  const { token } = theme.useToken();
  const zelle: CSSProperties = {
    textAlign: 'start',
    verticalAlign: 'top',
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
  };
  switch (inhalt.art) {
    case 'zeilen':
      return (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(10em, max-content) 1fr',
            columnGap: token.marginSM,
            rowGap: 2,
            margin: `0 0 ${token.marginXS}px`,
          }}
        >
          {inhalt.zeilen.map((z, i) => (
            <div key={`${z.etikett}-${i}`} style={{ display: 'contents' }}>
              <dt style={{ color: token.colorTextSecondary }}>{z.etikett}</dt>
              <dd
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  ...(BEGINNT_MIT_ZIFFER.test(z.wert) ? monoStil(token.fontSize) : {}),
                }}
              >
                {z.wert}
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'tabelle':
      return (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: token.fontSize,
            marginBlockEnd: token.marginXS,
          }}
        >
          <thead>
            <tr>
              {inhalt.kopf.map((k) => (
                <th
                  key={k}
                  scope="col"
                  style={{
                    ...zelle,
                    borderBlockEnd: `1px solid ${token.colorBorder}`,
                    fontWeight: 600,
                  }}
                >
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inhalt.zeilen.map((zeile, i) => (
              <tr key={i}>
                {zeile.map((wert, j) => (
                  <td
                    key={j}
                    style={{
                      ...zelle,
                      whiteSpace: NUR_ZAHL_ODER_ZEIT.test(wert) ? 'nowrap' : 'pre-wrap',
                      ...(BEGINNT_MIT_ZIFFER.test(wert) ? monoStil(token.fontSize) : {}),
                    }}
                  >
                    {wert}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'vermerk':
      return (
        <p style={{ margin: `0 0 ${token.marginXS}px`, fontStyle: 'italic' }}>{inhalt.text}</p>
      );
    case 'markdown':
      return (
        <>
          {inhalt.abschnitte.map((a, i) => (
            <section key={`${a.titel}-${i}`}>
              <h5 style={{ fontSize: token.fontSize, margin: `${token.marginXS}px 0 0` }}>
                {a.titel}
              </h5>
              <Markdown unterEbene={5}>{a.text}</Markdown>
            </section>
          ))}
        </>
      );
  }
}

function AbschnittAnzeige({ abschnitt }: { abschnitt: Abschnitt }) {
  const { token } = theme.useToken();
  return (
    <section>
      {abschnitt.titel && (
        <h4
          style={{
            fontSize: token.fontSizeLG,
            margin: `${token.marginSM}px 0 ${token.marginXXS}px`,
          }}
        >
          {abschnitt.titel}
        </h4>
      )}
      {abschnitt.inhalt.map((inhalt, i) => (
        <InhaltAnzeige key={i} inhalt={inhalt} />
      ))}
    </section>
  );
}

export default function Bloecke({ bericht }: { bericht: Einsatzbericht }) {
  const { token } = theme.useToken();
  return (
    <>
      {bericht.bloecke.map((b) => (
        <section key={b.schluessel} data-lfh={`einsatzbericht-block-${b.schluessel}`}>
          <h3
            style={{
              fontSize: token.fontSizeHeading5,
              margin: `${token.marginLG}px 0 ${token.marginXS}px`,
              borderBlockEnd: `1px solid ${token.colorBorder}`,
            }}
          >
            {b.titel}
          </h3>
          {b.abschnitte.map((a, i) => (
            <AbschnittAnzeige key={`${a.titel ?? ''}-${i}`} abschnitt={a} />
          ))}
        </section>
      ))}
    </>
  );
}
