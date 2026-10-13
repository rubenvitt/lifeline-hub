import { theme } from 'antd';
import type { CSSProperties } from 'react';
import { monoStil } from '../components/instrument';
import './druckansichtSchmal.css';

/**
 * Etikett-Wert-Listen der Druckstücke mit ihren Titeln (Einsatzbericht LFH-726/LFH-1098, Auftrag
 * LLH-1171). Aus `druck/einsatzbericht/Bloecke.tsx` hierher gezogen, damit der Auftragsdruck
 * dieselbe Mechanik nimmt statt einer Kopie (Change `ianaw5k1-auftrag-drucken`, design.md D5).
 *
 * Titel stehen im Titelblock (`druck/AGENTS.md`, LFH-1008): Firefox setzt `break-after: avoid`
 * nicht um, ein Titel bliebe dort allein am Seitenende. Die Liste stellt ihre Titel deshalb mit
 * der ersten Zeile in eine Hülle `data-lfh="titelblock"`, die `druck/druck.css` nicht brechen
 * lässt.
 */

/** Ziffern vorn (Zahl, Zeit, Stärke, Dauer) setzen Mono mit Tabellenziffern (`frontend/AGENTS.md`). */
export const BEGINNT_MIT_ZIFFER = /^\d/;

/** Eine Angabe der Liste. */
export interface Zeile {
  etikett: string;
  wert: string;
}

/** Ein Titel vor dem Inhalt; die Abstände braucht der Titelblock einer Liste einzeln. */
export interface Titel {
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
export function Titelfolge({ titel }: { titel: readonly Titel[] }) {
  return (
    <>
      {titel.map((t, i) => (
        <TitelZeile key={`${t.text}-${i}`} titel={t} oben={t.oben} unten={t.unten} />
      ))}
    </>
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
export function ZeilenListe({ titel, zeilen }: { titel: readonly Titel[]; zeilen: Zeile[] }) {
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
