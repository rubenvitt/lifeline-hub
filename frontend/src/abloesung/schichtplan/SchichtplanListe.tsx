import { Typography } from 'antd';
import { Fragment } from 'react';
import { monoStil, useRollen } from '../../components/instrument';
import { statusFlaeche, type StatusTon } from '../../components/instrument/statusFlaeche';
import { jetztUndNaechstes, type Ampel, type RasterBlock, type RasterZeile } from './raster';

/**
 * Der Schichtplan auf dem Handy (LLH-1554): statt des Rasters eine Liste je Posten mit „jetzt“
 * und „als Nächstes“. Ein Block ist ein Knopf und öffnet denselben Blockdialog wie im Raster;
 * angelegt wird über „Block anlegen“ der Ansicht. Fachneutral wie das Raster.
 *
 * `alleBloecke` (Vorplanung, LLH-1586): je Posten alle Blöcke nach Beginn statt „jetzt“ und „als
 * Nächstes“; eine Planung liegt meist in der Zukunft, „jetzt“ wäre immer leer.
 */

const AMPEL_TON: Record<Ampel, StatusTon> = {
  besetzt: 'normal',
  luecke: 'achtung',
  befund: 'alarm',
  'ohne-soll': 'neutral',
};

interface SchichtplanListeProps {
  zeilen: readonly RasterZeile[];
  bloecke: readonly RasterBlock[];
  jetzt: number;
  formatZeit: (ms: number) => string;
  onOeffnen: (blockId: number) => void;
  /** Alle Blöcke je Posten nach Beginn, ohne „jetzt“ und „als Nächstes“. */
  alleBloecke?: boolean;
}

export default function SchichtplanListe({
  zeilen,
  bloecke,
  jetzt,
  formatZeit,
  onOeffnen,
  alleBloecke = false,
}: SchichtplanListeProps) {
  const { token, rollen } = useRollen();
  let letzteGruppe: string | null | undefined;
  return (
    <section aria-label="Schichtplan je Posten" data-lfh="schichtplan-liste">
      {zeilen.map((z) => {
        const kopf = z.gruppe !== letzteGruppe && z.gruppe != null;
        letzteGruppe = z.gruppe;
        const { jetzt: laufend, naechstes } = jetztUndNaechstes(bloecke, z.schluessel, jetzt);
        const eigene = alleBloecke
          ? bloecke.filter((b) => b.zeile === z.schluessel).sort((a, b) => a.von - b.von)
          : [];
        const zeile = (wort: string | null, b: RasterBlock | null) => {
          if (!b)
            return (
              <div
                style={{
                  display: 'flex',
                  gap: token.marginXS,
                  minHeight: token.controlHeight,
                  alignItems: 'center',
                }}
              >
                {wort != null && (
                  <span style={{ color: rollen.gedaempft, minWidth: '7em' }}>{wort}</span>
                )}
                <span style={{ color: rollen.gedaempft }}>—</span>
              </div>
            );
          const ton = statusFlaeche(rollen, AMPEL_TON[b.ampel]);
          const zeit = `${formatZeit(b.von)}–${formatZeit(b.bis)}`;
          return (
            <button
              type="button"
              data-lfh="schichtplan-listen-block"
              data-block-id={b.id}
              aria-label={`${z.titel}${wort != null ? ` ${wort}` : ''} ${zeit}, ${b.text}, ${b.ampelWort}`}
              onClick={() => onOeffnen(b.id)}
              style={{
                display: 'flex',
                gap: token.marginXS,
                alignItems: 'center',
                width: '100%',
                minHeight: token.controlHeight,
                padding: 0,
                paddingInline: token.paddingXS,
                margin: 0,
                marginBottom: 2,
                border: `1px solid ${ton.kante}`,
                borderLeftWidth: 3,
                background: ton.grund,
                color: ton.text,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {wort != null && <span style={{ minWidth: '7em' }}>{wort}</span>}
              <span style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>{zeit}</span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {b.text}
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>{b.ampelWort}</span>
            </button>
          );
        };
        return (
          <Fragment key={z.schluessel}>
            {kopf && (
              <Typography.Text
                type="secondary"
                strong
                style={{ display: 'block', marginTop: token.marginSM }}
              >
                {z.gruppe}
              </Typography.Text>
            )}
            <div
              data-lfh="schichtplan-listen-posten"
              data-raster-zeile={z.schluessel}
              style={{
                borderBottom: `1px solid ${rollen.linie}`,
                paddingBlock: token.paddingXS,
              }}
            >
              <Typography.Text strong style={{ display: 'block' }}>
                {z.titel}
              </Typography.Text>
              {alleBloecke ? (
                eigene.length === 0 ? (
                  zeile(null, null)
                ) : (
                  eigene.map((b) => <Fragment key={b.id}>{zeile(null, b)}</Fragment>)
                )
              ) : (
                <>
                  {laufend.length === 0
                    ? zeile('jetzt', null)
                    : laufend.map((b) => <Fragment key={b.id}>{zeile('jetzt', b)}</Fragment>)}
                  {zeile('als Nächstes', naechstes)}
                </>
              )}
            </div>
          </Fragment>
        );
      })}
    </section>
  );
}
