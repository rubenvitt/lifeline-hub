import type { ReactNode } from 'react';
import { rahmenFarben, schrift } from '../theme/tokens';
import { eingaengeZahlText } from './eingaenge';

/**
 * Ein Zeichen mit der Zahl der ungelesenen Eingänge als Plakette darüber (LLH-1143). Die
 * Plakette nimmt keine Breite: der Knopf bleibt so breit wie ein Zeichenknopf, eine eintreffende
 * Meldung lässt den Kopf weder springen noch umbrechen (LLH-1158). Farben aus `rahmenFarben`
 * (Rahmen dauerdunkel), Text und Grund invertiert, also ≥ 7 : 1 (LFH-434). Rein darstellend; den
 * Namen trägt der Knopf.
 */
export default function EingaengeZahl({ zahl, children }: { zahl: number; children: ReactNode }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      {children}
      {zahl > 0 ? (
        <span
          aria-hidden="true"
          data-lfh="eingaenge-zahl"
          style={{
            position: 'absolute',
            insetBlockStart: -7,
            insetInlineStart: '55%',
            minWidth: 16,
            height: 16,
            paddingInline: 3,
            borderRadius: 8,
            background: rahmenFarben.text,
            color: rahmenFarben.grund,
            fontFamily: schrift.zahl,
            fontVariantNumeric: 'tabular-nums',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {eingaengeZahlText(zahl)}
        </span>
      ) : null}
    </span>
  );
}
