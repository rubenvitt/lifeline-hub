import type { ReactNode } from 'react';
import { schrift } from '../../theme/tokens';
import { useRollen } from '../instrument/rollenwerte';
import { statusFlaeche } from '../instrument/statusFlaeche';
import { GROSS_BEZUG, grossMass } from './grossMass';

/** Töne einer Großbild-Zahl: dieselben wie an der `Kennzahl` (`KennzahlTon`). */
export type GrossTon = 'neutral' | 'normal' | 'bedien' | 'achtung' | 'alarm';
export type GrossZustand = 'daten' | 'laden' | 'fehler';

/** Wörter wie an der `Kennzahl` (`components/instrument/Kennzahl.tsx`, Datenzustände). */
export const GROSS_LADEN = 'wird abgerufen';
export const GROSS_FEHLER = 'Stand unbekannt';

/**
 * Kante je Ton: abgestuft wie an der `Kennzahl` (3 bzw. 6 px bei 1920 × 1080), zweiter Kanal neben
 * der Farbe. `normal` und `bedien` färben nur die Zahl: ein Zustand ohne Handlungsbedarf bekommt
 * keine Kante.
 */
const KANTE = { neutral: 0, normal: 0, bedien: 0, achtung: 3, alarm: 6 } as const;

interface GrossKennzahlProps {
  titel: string;
  wert: ReactNode;
  /** Kurz hinter der Zahl, in Textgröße („h“, „m“). */
  einheit?: string;
  notiz?: ReactNode;
  ton?: GrossTon;
  zustand?: GrossZustand;
  groesse?: 'zahl' | 'zahlKlein';
}

/**
 * Eine Kennzahl im Großbild (LLH-1747, Spec `grossbild-ansicht`; design.md D4 in
 * `openspec/changes/ckl1wbvz-grossbild-lage/`): Bezeichnung, darunter die Zahl (Mono, feste Ziffern,
 * 96 bzw. 72 px bei 1920 × 1080), darunter die Notiz. Alle Größen aus {@link grossMass}, also
 * mitwachsend.
 *
 * Nur zum Ansehen: kein Ziel, kein Link, kein Tooltip. Eine gesperrte Quelle reicht der Aufrufer als
 * „—“ mit Grund herein; `laden` und `fehler` sehen aus wie an der `Kennzahl` und behaupten keinen
 * Ton.
 */
export default function GrossKennzahl({
  titel,
  wert,
  einheit,
  notiz,
  ton = 'neutral',
  zustand = 'daten',
  groesse = 'zahl',
}: GrossKennzahlProps) {
  const { rollen } = useRollen();
  const wirksam: GrossTon = zustand === 'daten' ? ton : 'neutral';
  const tonFarbe = wirksam === 'neutral' ? undefined : statusFlaeche(rollen, wirksam);
  const zahl = zustand === 'laden' ? '····' : zustand === 'fehler' ? '?' : wert;
  const notizText = zustand === 'laden' ? GROSS_LADEN : zustand === 'fehler' ? GROSS_FEHLER : notiz;
  return (
    <div
      data-lfh="gross-kennzahl"
      data-ton={wirksam}
      data-zustand={zustand}
      aria-busy={zustand === 'laden' ? true : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: grossMass(GROSS_BEZUG.eng / 2),
        minWidth: 0,
        // Die Kante als Innenschatten wie an der `Kennzahl`: null Layout, die Zahl springt nicht,
        // wenn der Ton wechselt. Der Einzug hält Platz für die breiteste Kante.
        paddingInlineStart: grossMass(GROSS_BEZUG.fuge + KANTE.alarm),
        boxShadow:
          tonFarbe != null && KANTE[wirksam] > 0
            ? `inset ${grossMass(KANTE[wirksam])} 0 0 0 ${tonFarbe.kante}`
            : undefined,
      }}
    >
      <span
        style={{
          fontSize: grossMass(GROSS_BEZUG.text),
          lineHeight: 1.2,
          color: rollen.text2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {titel}
      </span>
      <span
        style={{
          fontFamily: schrift.zahl,
          fontVariantNumeric: 'tabular-nums',
          fontSize: grossMass(GROSS_BEZUG[groesse]),
          lineHeight: 1.1,
          fontWeight: 600,
          color: tonFarbe?.text ?? rollen.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {zahl}
        {zustand === 'daten' && einheit != null && (
          <span
            style={{
              fontSize: grossMass(GROSS_BEZUG.text),
              fontWeight: 400,
              color: rollen.gedaempft,
              marginInlineStart: grossMass(GROSS_BEZUG.eng),
            }}
          >
            {einheit}
          </span>
        )}
      </span>
      {notizText != null && notizText !== '' && (
        <span
          title={zustand === 'daten' && typeof notizText === 'string' ? notizText : undefined}
          style={{
            fontSize: grossMass(GROSS_BEZUG.text),
            lineHeight: 1.2,
            color: tonFarbe?.text ?? rollen.gedaempft,
            fontWeight: tonFarbe ? 600 : 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {notizText}
        </span>
      )}
    </div>
  );
}
