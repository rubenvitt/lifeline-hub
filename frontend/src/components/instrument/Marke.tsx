import { Button } from 'antd';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useRollen } from './rollenwerte';

interface MarkeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style'> {
  children: ReactNode;
  title?: string;
  /**
   * Macht die Marke entfernbar (Filter, gewählter Grund). Dann ist sie ein Bedienelement und
   * trägt einen Rahmen und einen Knopf ✕ in der Dichtehöhe (Spec `status-darstellung`, „Rahmen
   * heißt bedienbar“).
   */
  onEntfernen?: () => void;
  /** Vorgelesener Name des Entfernen-Knopfs; ohne Angabe „<Inhalt> entfernen“. */
  entfernenLabel?: string;
  style?: CSSProperties;
  /** Eigene Kennung statt `marke`, wenn Tests oder Wächter eine bestimmte Marke suchen. */
  'data-lfh'?: string;
  [daten: `data-${string}`]: string | undefined;
}

/**
 * Kennzeichnung ohne Zustand (LLH-1779, Change `eon26eat-status-und-bedienung`, D2): Herkunft
 * („ad-hoc“, „Demo“), Rolle („Einheitsführer“), Typ, Kennung. Neutral, randlos, ohne
 * Formzeichen, zweite Textstufe auf `flaeche2` — so unterscheidet sie sich vom neutralen
 * `Status` (`flaeche3`, `text2`). Nie Blau, denn Blau bedient (Spec `farbrollen-kontrast`,
 * „Eine Marke trägt nicht die Bedienfarbe“).
 *
 * Diese Datei und `personen/SichtungsTag.tsx` sind die einzigen, die antds `Tag` brauchten; die
 * Marke kommt ohne aus.
 */
export function Marke({
  children,
  title,
  onEntfernen,
  entfernenLabel,
  style,
  'data-lfh': lfh = 'marke',
  ...rest
}: MarkeProps) {
  const { token, rollen } = useRollen();
  const bedienbar = onEntfernen != null;
  return (
    <span
      {...rest}
      data-lfh={lfh}
      data-marke=""
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXXS,
        height: bedienbar ? token.controlHeight : 20,
        paddingInlineStart: token.paddingXS,
        paddingInlineEnd: bedienbar ? 0 : token.paddingXS,
        background: rollen.flaeche2,
        color: bedienbar ? rollen.text : rollen.gedaempft,
        border: bedienbar ? `1px solid ${rollen.steuerRahmen}` : undefined,
        fontSize: bedienbar ? 12 : 11,
        fontWeight: 500,
        letterSpacing: bedienbar ? undefined : '0.02em',
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
      {bedienbar && (
        <Button
          type="text"
          aria-label={
            entfernenLabel ??
            (typeof children === 'string' ? `${children} entfernen` : 'Eintrag entfernen')
          }
          onClick={onEntfernen}
          onMouseDown={(e) => e.preventDefault()}
          style={{ color: rollen.gedaempft, paddingInline: token.paddingXS }}
        >
          <span aria-hidden="true">✕</span>
        </Button>
      )}
    </span>
  );
}
