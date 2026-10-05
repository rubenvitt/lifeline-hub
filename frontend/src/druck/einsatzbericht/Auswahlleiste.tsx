import { useId, type ReactNode } from 'react';
import { Button, Checkbox, Typography, theme } from 'antd';
import { Paneel } from '../../components/instrument';
import { BLOECKE, STANDARDUMFANG, istStandardumfang, ordneAuswahl } from './auswahl';
import type { BlockDef, BlockSchluessel } from './auswahl';

/**
 * Auswahl der Blöcke des Einsatzberichts (LFH-902, design.md D4). Bedienung, nicht Blatt: die
 * Leiste steht außerhalb der Druckwurzel, `druck/druck.css` blendet sie im Ausdruck aus.
 *
 * Jede Zeile ist als Ganzes Bedienziel (Höhe aus `controlHeight`, wächst mit der Dichte-Staffel bis
 * Handschuh). Der zuletzt gewählte Block ist gesperrt: ein Bericht ohne Block gibt es nicht.
 */
export default function Auswahlleiste({
  auswahl,
  onAendern,
}: {
  auswahl: readonly BlockSchluessel[];
  onAendern: (neu: BlockSchluessel[]) => void;
}) {
  const { token } = theme.useToken();
  const umschalten = (b: BlockSchluessel, an: boolean) =>
    onAendern(ordneAuswahl(an ? [...auswahl, b] : auswahl.filter((x) => x !== b)));

  const gruppe = (titel: string, bloecke: readonly BlockDef[]) => (
    <Gruppe titel={titel}>
      {bloecke.map((b) => {
        const gewaehlt = auswahl.includes(b.schluessel);
        return (
          <Checkbox
            key={b.schluessel}
            checked={gewaehlt}
            disabled={gewaehlt && auswahl.length === 1}
            onChange={(e) => umschalten(b.schluessel, e.target.checked)}
            style={haekchenStil(token)}
          >
            {b.titel}
            {b.schluessel === 'personal-kopf' && (
              <Typography.Text type="secondary">
                {' '}
                – enthält Namen von Einsatzkräften
              </Typography.Text>
            )}
          </Checkbox>
        );
      })}
    </Gruppe>
  );

  return (
    <Paneel
      titel="Blöcke"
      koerperPolster
      aktion={
        <Button
          onClick={() => onAendern([...STANDARDUMFANG])}
          disabled={istStandardumfang(auswahl)}
        >
          Standardumfang
        </Button>
      }
      style={{ marginBlockEnd: token.marginLG }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: token.marginXL }}>
        {gruppe(
          'Bericht',
          BLOECKE.filter((b) => b.standard),
        )}
        {gruppe(
          'Anlagen',
          BLOECKE.filter((b) => !b.standard),
        )}
      </div>
    </Paneel>
  );
}

/**
 * Ein Häkchen samt Beschriftung ist EIN Bedienziel (`frontend/AGENTS.md`, „Handgebautes
 * Bedienziel“, LFH-365): Höhe aus `controlHeight`, Polsterung aus `paddingSM`/`padding`; antds
 * Randabstand zwischen Häkchen entfällt, den Abstand trägt {@link zielAbstand}.
 */
export function haekchenStil(token: { controlHeight: number; paddingSM: number; padding: number }) {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
    marginInlineStart: 0,
  } as const;
}

/**
 * Abstand zwischen zwei Häkchen, in beiden Richtungen (Bedien-Leitlinie Kriterium 2, wie
 * `components/instrument/zielEinzug.ts`): `komfortabel` ≥ 8 px, `handschuh` ≥ 16 px; `kompakt`
 * (Fükw, Maus) hat die Spacing-Ausnahme. Literale, damit die Böden prüfbar bleiben.
 */
export function zielAbstand(token: { controlHeight: number }): number {
  if (token.controlHeight >= 72) return 16;
  if (token.controlHeight >= 48) return 8;
  return 4;
}

function Gruppe({ titel, children }: { titel: string; children: ReactNode }) {
  const id = useId();
  const { token } = theme.useToken();
  return (
    <div role="group" aria-labelledby={id} style={{ minWidth: 0 }}>
      <Typography.Text id={id} type="secondary">
        {titel}
      </Typography.Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: zielAbstand(token) }}>{children}</div>
    </div>
  );
}
