import type { ReactNode } from 'react';
import { schrift } from '../../theme/tokens';
import { useRollen } from '../instrument/rollenwerte';
import { statusFlaeche } from '../instrument/statusFlaeche';
import type { GrossTon } from './GrossKennzahl';
import { GROSS_BEZUG, grossMass } from './grossMass';

/**
 * Zeilen im Großbild (LLH-1747, Spec `grossbild-ansicht`, „Lesbar aus der Entfernung“: „Ein Wert
 * MUST direkt neben oder unter seiner Bezeichnung stehen“; design.md D4).
 *
 * {@link GrossZeilen} ist ein Raster aus zwei Spalten: die erste so breit wie die längste
 * Bezeichnung, die zweite trägt Wert und Notiz. So beginnt jeder Wert direkt rechts der
 * Bezeichnungen, nie am anderen Rand der Fläche. {@link GrossZeile} legt sich mit
 * `display: contents` in dieses Raster.
 *
 * Eine Farbmarke (Sichtungskategorie, Warnstufe) steht nur vor einer Bezeichnung, die das Wort
 * trägt; sie selbst ist für Vorleser stumm.
 */
export function GrossZeilen({
  beschriftung,
  children,
}: {
  beschriftung: string;
  children: ReactNode;
}) {
  return (
    <div
      role="list"
      aria-label={beschriftung}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
        columnGap: grossMass(GROSS_BEZUG.luft),
        rowGap: grossMass(GROSS_BEZUG.eng),
        alignItems: 'baseline',
        alignContent: 'start',
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

interface GrossZeileProps {
  bezeichnung: string;
  wert: ReactNode;
  notiz?: ReactNode;
  /** `zahl` Mono 72 px, `wort` Text 40 px (bei 1920 × 1080). */
  art?: 'zahl' | 'wort';
  ton?: GrossTon;
  /** Farbe einer Marke vor der Bezeichnung, aus `theme/` (Sichtung, Warnstufe). */
  marke?: string;
}

export function GrossZeile({
  bezeichnung,
  wert,
  notiz,
  art = 'zahl',
  ton = 'neutral',
  marke,
}: GrossZeileProps) {
  const { rollen } = useRollen();
  const tonFarbe = ton === 'neutral' ? undefined : statusFlaeche(rollen, ton);
  return (
    <div role="listitem" style={{ display: 'contents' }}>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: grossMass(GROSS_BEZUG.fuge),
          fontSize: grossMass(GROSS_BEZUG.text),
          lineHeight: 1.2,
          color: rollen.text2,
          minWidth: 0,
        }}
      >
        {marke != null && (
          <span
            data-lfh="gross-marke"
            aria-hidden="true"
            style={{
              display: 'inline-block',
              flexShrink: 0,
              width: grossMass(GROSS_BEZUG.text),
              height: grossMass(GROSS_BEZUG.text),
              background: marke,
              boxShadow: `inset 0 0 0 1px ${rollen.linieStark}`,
            }}
          />
        )}
        {bezeichnung}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span
          style={{
            fontFamily: art === 'zahl' ? schrift.zahl : schrift.text,
            fontVariantNumeric: art === 'zahl' ? 'tabular-nums' : undefined,
            fontSize: grossMass(art === 'zahl' ? GROSS_BEZUG.zahlKlein : GROSS_BEZUG.wort),
            lineHeight: 1.1,
            fontWeight: art === 'zahl' ? 600 : 700,
            color: tonFarbe?.text ?? rollen.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {wert}
        </span>
        {notiz != null && notiz !== '' && (
          <span
            style={{
              fontSize: grossMass(GROSS_BEZUG.text),
              lineHeight: 1.2,
              color: tonFarbe?.text ?? rollen.gedaempft,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {notiz}
          </span>
        )}
      </span>
    </div>
  );
}
