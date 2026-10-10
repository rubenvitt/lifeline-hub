import { theme, type GlobalToken } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import Markdown from '../../components/Markdown';
import { monoStil } from '../../components/instrument';
import type { Abschnitt, Einsatzbericht, Inhalt, Zeile } from './verdichtung';
import '../druckansichtSchmal.css';

/**
 * Die gewählten Blöcke des Einsatzberichts auf Papier (LFH-726, Auswahl LFH-902). Bildet nur das
 * verdichtete Objekt ab (design.md D5) und kann deshalb nichts zeigen, was die Verdichtung nicht
 * hineingegeben hat — auch keinen abgewählten Block.
 *
 * Gliederung: der Druckkopf trägt `h2` („Einsatzbericht“), die Blöcke `h3`, ihre Abschnitte `h4`,
 * die Abschnitte des Lageberichts `h5`. Umbruchregeln (Überschrift bleibt beim Text, Zeile nicht
 * zerrissen, Tabellenkopf je Seite) kommen aus `druck/druck.css`.
 *
 * Titel stehen im Titelblock (LFH-1098, `druck/AGENTS.md`): Firefox setzt `break-after: avoid`
 * nicht um, ein Titel bliebe dort allein am Seitenende. Deshalb reichen Block und Abschnitt ihre
 * Titel an das erste Inhaltsstück weiter ({@link Titel}), und das stellt sie mit seinem ersten Teil
 * in eine Hülle `data-lfh="titelblock"`: die erste Zeile einer Liste, den Vermerk, den ersten Block
 * des Lageberichtstexts (über `Markdown titel`) oder, nur in Firefox, eine kurze Tabelle ganz. Eine
 * lange Tabelle wanderte ganz mit und ließe davor eine fast leere Seite; vor ihr stehen die Titel
 * mit Kopf und erster Zeile in einem Deckel ({@link Deckel}, LFH-1124).
 *
 * Tabellen sind schlichtes HTML wie im ETB-Druck (`etb/EtbDruckTabelle.tsx`, benannte Ausnahme):
 * ein Vordruck ohne Sortierung, Filter oder Zeilenaktion, kein Bedienort. Am schmalen Schirm
 * steht eine Zeit zweizeilig, und was dann noch nicht passt, rollt in der Tabelle statt in der
 * Seite (`druck/druckansichtSchmal.css`, LFH-956).
 */

/** Ziffern vorn (Zahl, Zeit, Stärke, Dauer) setzen Mono mit Tabellenziffern (`frontend/AGENTS.md`). */
const BEGINNT_MIT_ZIFFER = /^\d/;
/** Reine Nummer, Datum oder Uhrzeit bricht nicht um; Freitext (auch ein Titel) immer. */
const NUR_ZAHL_ODER_ZEIT = /^[\d.: ]+$/;
/**
 * Bis zu so vielen Zeilen wandert eine Tabelle in Firefox mit ihrem Titel ganz auf die nächste
 * Seite. Mehr hielte er nicht zusammen, ohne davor eine halbe Seite leer zu lassen.
 */
export const KURZE_TABELLE = 12;

/** Ein Titel vor dem Inhalt; die Abstände braucht der Titelblock einer Liste einzeln. */
interface Titel {
  ebene: 3 | 4 | 5;
  text: string;
  stil: CSSProperties;
  oben: number;
  unten: number;
}

function TitelZeile({ titel, oben, unten }: { titel: Titel; oben: number; unten: number }) {
  const { token } = theme.useToken();
  const Tag = `h${titel.ebene}` as const;
  // Die Zeilenhöhe ausdrücklich: im Titelplatz des Markdowns erbte der Titel sonst dessen 1,65.
  return (
    <Tag style={{ lineHeight: token.lineHeight, ...titel.stil, margin: `${oben}px 0 ${unten}px` }}>
      {titel.text}
    </Tag>
  );
}

/** Titel im Fluss: jeder mit seinen Abständen, die Ränder fallen zusammen wie ohne Hülle. */
function Titelfolge({ titel }: { titel: readonly Titel[] }) {
  return (
    <>
      {titel.map((t, i) => (
        <TitelZeile key={`${t.text}-${i}`} titel={t} oben={t.oben} unten={t.unten} />
      ))}
    </>
  );
}

/**
 * Titel im Fluss vor dem Inhalt in einer Hülle, die `druck/druck.css` nicht brechen lässt. Ohne
 * Titel nur der Inhalt. Die Hülle hat weder Rand noch Polster: die Abstände bleiben die alten.
 *
 * Um eine Tabelle heißt die Hülle `titelblock-tabelle` und hält nur in Firefox zusammen
 * (`druck.css`): Chromium hält Titel, Kopf und erste Zeile schon über `break-after: avoid`
 * zusammen und bricht die Tabelle danach; eine ganze Tabelle mitzunehmen, änderte dort das Blatt.
 */
function Titelblock({
  titel,
  tabelle = false,
  children,
}: {
  titel: readonly Titel[];
  tabelle?: boolean;
  children: ReactNode;
}) {
  if (titel.length === 0) return <>{children}</>;
  return (
    <div data-lfh={tabelle ? 'titelblock-tabelle' : 'titelblock'}>
      <Titelfolge titel={titel} />
      {children}
    </div>
  );
}

function ZeilenEintraege({ zeilen }: { zeilen: Zeile[] }) {
  const { token } = theme.useToken();
  return (
    <>
      {zeilen.map((z, i) => (
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
    </>
  );
}

/**
 * Eine Liste aus Etikett und Wert. Mit Titeln stehen sie mit der ersten Zeile im Titelblock; die
 * übrigen Zeilen folgen in einer zweiten Liste. Beide sind Subgrids desselben Rasters, damit die
 * Etikettspalte über die Trennung hinweg gleich breit bleibt. Im Raster fallen Ränder nicht
 * zusammen: die Abstände der Titel sind hier ausgerechnet, der erste und der letzte sitzen am
 * Raster selbst, damit sie wie im Fluss mit den Nachbarn zusammenfallen.
 */
function ZeilenListe({ titel, zeilen }: { titel: readonly Titel[]; zeilen: Zeile[] }) {
  const { token } = theme.useToken();
  const raster: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(10em, max-content) 1fr',
    columnGap: token.marginSM,
    rowGap: 2,
  };
  if (titel.length === 0 || zeilen.length === 0) {
    return (
      <>
        <Titelfolge titel={titel} />
        <dl style={{ ...raster, margin: `0 0 ${token.marginXS}px` }}>
          <ZeilenEintraege zeilen={zeilen} />
        </dl>
      </>
    );
  }
  const teil: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    gridColumn: '1 / -1',
    margin: 0,
  };
  return (
    <div style={{ ...raster, margin: `${titel[0].oben}px 0 ${token.marginXS}px` }}>
      <div data-lfh="titelblock" style={teil}>
        {titel.map((t, i) => (
          <div key={`${t.text}-${i}`} style={{ gridColumn: '1 / -1' }}>
            <TitelZeile
              titel={t}
              oben={i === 0 ? 0 : Math.max(titel[i - 1].unten, t.oben)}
              unten={i === titel.length - 1 ? t.unten : 0}
            />
          </div>
        ))}
        <dl style={teil}>
          <ZeilenEintraege zeilen={zeilen.slice(0, 1)} />
        </dl>
      </div>
      {zeilen.length > 1 && (
        <dl style={{ ...teil, rowGap: 2 }}>
          <ZeilenEintraege zeilen={zeilen.slice(1)} />
        </dl>
      )}
    </div>
  );
}

/**
 * Rolle einer Tabelle am Deckel (LFH-1124): `einfach` ohne Deckel; `deckel` die Kopie im Deckel
 * (Kopf, erste Zeile, Maßzeilen); `unter-deckel` die echte Tabelle dahinter.
 */
type TabellenRolle = 'einfach' | 'deckel' | 'unter-deckel';

/**
 * Zeilenhöhe des Kopfes in px. Am Deckel setzt `druck.css` sie im Firefox-Druck an den Kopf beider
 * Tabellen, und aus ihr ist die Kopfhöhe gerechnet, um die die echte Tabelle unter den Deckel rückt.
 */
function kopfZeilenhoehe(token: GlobalToken): number {
  return Math.round(token.fontSize * token.lineHeight);
}

function TabellenAnzeige({
  inhalt,
  rolle = 'einfach',
}: {
  inhalt: Extract<Inhalt, { art: 'tabelle' }>;
  rolle?: TabellenRolle;
}) {
  const { token } = theme.useToken();
  const zelle: CSSProperties = {
    textAlign: 'start',
    verticalAlign: 'top',
    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
    borderBlockEnd: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
  };
  const zeilenhoehe = kopfZeilenhoehe(token);
  /** Markierung einer Zeile: Maßzeile im Deckel, erste Zeile der echten Tabelle. */
  const marke = (i: number): string | undefined =>
    rolle === 'deckel' && i > 0
      ? 'masszeile'
      : rolle === 'unter-deckel' && i === 0
        ? 'deckel-erste-zeile'
        : undefined;
  // Zeilenhöhe des Kopfes für `druck.css`; außerhalb des Firefox-Drucks liest sie niemand.
  const kopfzeile = { '--druck-kopfzeile': `${zeilenhoehe}px` } as CSSProperties;
  const tabelle = (
    <table
      data-lfh={rolle === 'deckel' ? 'deckel-tabelle' : undefined}
      aria-hidden={rolle === 'deckel' ? true : undefined}
      style={{
        // Die Kopie zeigt nur der Firefox-Druck (`druck/druck.css`).
        ...(rolle === 'deckel' ? { display: 'none', ...kopfzeile } : {}),
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: token.fontSize,
        marginBlockEnd: rolle === 'deckel' ? 0 : token.marginXS,
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
                borderBlockEnd: `${token.lineWidth}px solid ${token.colorBorder}`,
                fontWeight: 600,
              }}
            >
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {inhalt.zeilen.map((zeile, i) => {
          const m = marke(i);
          return (
            <tr key={i} data-lfh={m}>
              {zeile.map((wert, j) => (
                <td
                  key={j}
                  className={NUR_ZAHL_ODER_ZEIT.test(wert) ? 'druckansicht-zeit' : undefined}
                  style={{
                    ...zelle,
                    whiteSpace: NUR_ZAHL_ODER_ZEIT.test(wert) ? 'nowrap' : 'pre-wrap',
                    ...(BEGINNT_MIT_ZIFFER.test(wert) ? monoStil(token.fontSize) : {}),
                  }}
                >
                  {/* Die Hülle verliert im Firefox-Druck ihre Höhe, nicht ihre Breite. Inline,
                      damit Text und Kopieren am Bildschirm bleiben, wie sie waren. */}
                  {m ? <span>{wert}</span> : wert}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  // Die Kopie ohne eigene Hülle: ein leerer Block zwischen Titel und Tabelle trennte in Chromium
  // den Titel von der Tabelle.
  if (rolle === 'deckel') return tabelle;
  return (
    <div
      className="druckansicht-bildlauf"
      data-lfh={rolle === 'unter-deckel' ? 'unter-deckel' : undefined}
      style={
        rolle === 'unter-deckel'
          ? ({
              ...kopfzeile,
              '--druck-kopfhoehe': `${zeilenhoehe + 2 * token.paddingXXS + token.lineWidth}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {tabelle}
    </div>
  );
}

/**
 * Titel vor einer langen Tabelle (LFH-1124). Firefox lässt einen Titel und selbst den Spaltenkopf
 * allein am Seitenende; nähme eine Hülle die ganze Tabelle mit, bliebe davor fast eine Seite leer.
 * Der Deckel trägt deshalb die Titel und eine Kopie der Tabelle, von der nur Kopf und erste Zeile
 * Höhe haben; die übrigen Zeilen stehen als Maßzeilen darin, damit beide Tabellen dieselben
 * Spalten bekommen. Die echte Tabelle folgt. Im Firefox-Druck bricht der Deckel nicht, deckt mit
 * Papiergrund und liegt über der echten Tabelle, die um ihre Kopfhöhe hochgezogen ist und deren
 * erste Zeile dort keine Höhe hat; sie bricht zwischen ihren Zeilen und wiederholt den Kopf.
 * Überall sonst ist die Kopie ausgeblendet und die echte Tabelle steht wie ohne Deckel
 * (`druck/druck.css`, Herleitung
 * `openspec/changes/lfh-1124-firefox-titel-lange-tabelle/design.md`).
 */
function Deckel({
  titel,
  inhalt,
}: {
  titel: readonly Titel[];
  inhalt: Extract<Inhalt, { art: 'tabelle' }>;
}) {
  return (
    <>
      {/* Ohne Box außerhalb des Firefox-Drucks: dort hielte Chromium den Titel über
          `break-after: avoid` nicht mehr bei der Tabelle, wenn eine Hülle dazwischen stünde. */}
      <div data-lfh="titelblock-deckel" style={{ display: 'contents' }}>
        <Titelfolge titel={titel} />
        <TabellenAnzeige inhalt={inhalt} rolle="deckel" />
      </div>
      <TabellenAnzeige inhalt={inhalt} rolle="unter-deckel" />
    </>
  );
}

/** `titel`: die Titel davor (Block, Abschnitt), nur am ersten Inhaltsstück eines Abschnitts. */
function InhaltAnzeige({ inhalt, titel }: { inhalt: Inhalt; titel: readonly Titel[] }) {
  const { token } = theme.useToken();
  switch (inhalt.art) {
    case 'zeilen': {
      const eigener: Titel[] = inhalt.titel
        ? [
            {
              ebene: 5,
              text: inhalt.titel,
              stil: { fontSize: token.fontSize },
              oben: token.marginXS,
              unten: 2,
            },
          ]
        : [];
      return <ZeilenListe titel={[...titel, ...eigener]} zeilen={inhalt.zeilen} />;
    }
    case 'tabelle':
      if (inhalt.zeilen.length > KURZE_TABELLE) {
        if (titel.length === 0) return <TabellenAnzeige inhalt={inhalt} />;
        return <Deckel titel={titel} inhalt={inhalt} />;
      }
      return (
        <Titelblock titel={titel} tabelle>
          <TabellenAnzeige inhalt={inhalt} />
        </Titelblock>
      );
    case 'vermerk':
      return (
        <Titelblock titel={titel}>
          <p style={{ margin: `0 0 ${token.marginXS}px`, fontStyle: 'italic' }}>{inhalt.text}</p>
        </Titelblock>
      );
    case 'markdown':
      return (
        <>
          {inhalt.abschnitte.map((a, i) => {
            const eigener: Titel = {
              ebene: 5,
              text: a.titel,
              stil: { fontSize: token.fontSize },
              oben: token.marginXS,
              unten: 0,
            };
            // Der Abschnittstitel (und vor dem ersten die Titel davor) steht über `Markdown titel`
            // im Titelblock mit dem ersten Block des Textes (`components/markdownTitelbloecke.ts`).
            return (
              <section key={`${a.titel}-${i}`}>
                <Markdown
                  unterEbene={5}
                  titel={<Titelfolge titel={i === 0 ? [...titel, eigener] : [eigener]} />}
                >
                  {a.text}
                </Markdown>
              </section>
            );
          })}
        </>
      );
  }
}

function AbschnittAnzeige({ abschnitt, titel }: { abschnitt: Abschnitt; titel: readonly Titel[] }) {
  const { token } = theme.useToken();
  const alle: Titel[] = abschnitt.titel
    ? [
        ...titel,
        {
          ebene: 4,
          text: abschnitt.titel,
          stil: { fontSize: token.fontSizeLG },
          oben: token.marginSM,
          unten: token.marginXXS,
        },
      ]
    : [...titel];
  return (
    <section>
      {abschnitt.inhalt.length === 0 && <Titelfolge titel={alle} />}
      {abschnitt.inhalt.map((inhalt, i) => (
        <InhaltAnzeige key={i} inhalt={inhalt} titel={i === 0 ? alle : []} />
      ))}
    </section>
  );
}

export default function Bloecke({ bericht }: { bericht: Einsatzbericht }) {
  const { token } = theme.useToken();
  return (
    <>
      {bericht.bloecke.map((b) => {
        const titel: Titel = {
          ebene: 3,
          text: b.titel,
          stil: {
            fontSize: token.fontSizeHeading5,
            borderBlockEnd: `1px solid ${token.colorBorder}`,
          },
          oben: token.marginLG,
          unten: token.marginXS,
        };
        return (
          <section key={b.schluessel} data-lfh={`einsatzbericht-block-${b.schluessel}`}>
            {b.abschnitte.length === 0 && <Titelfolge titel={[titel]} />}
            {b.abschnitte.map((a, i) => (
              <AbschnittAnzeige
                key={`${a.titel ?? ''}-${i}`}
                abschnitt={a}
                titel={i === 0 ? [titel] : []}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}
