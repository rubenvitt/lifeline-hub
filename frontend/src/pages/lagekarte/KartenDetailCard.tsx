import { Button, Card } from 'antd';
import type { ReactNode } from 'react';

export interface KartenDetailCardProps {
  /** Karten-Titel (bricht bei Bedarf um statt abzuschneiden). */
  titel: ReactNode;
  /** Farbiger Akzent-Rand im Header — spiegelt die Objekt-/Quellenfarbe. */
  akzentFarbe: string;
  onSchliessen: () => void;
  /** Panel-Breite (Default 300). */
  width?: number;
  children: ReactNode;
}

/**
 * Einheitliche, über der Karte schwebende Detail-Karte (Marker-, Zonen-,
 * Fachebenen-Inspector). Sorgt für konsistentes Aussehen: Akzent-Rand in
 * Objektfarbe, Schließen-Button, Positionierung oben rechts, Scrollen bei
 * langen Inhalten, dezenter Schatten.
 */
export default function KartenDetailCard({
  titel,
  akzentFarbe,
  onSchliessen,
  width = 300,
  children,
}: KartenDetailCardProps) {
  return (
    <Card
      size="small"
      title={titel}
      extra={
        /* Die Klein-Angabe bleibt an der `Card` (Polsterung, keine Trefffläche), fällt aber
           am Schließen-Knopf weg: er ist das einzige Bedienziel dieser Karte und muss der
           Dichte-Staffel folgen (LFH-366 · B5f). */
        <Button type="text" onClick={onSchliessen} aria-label="Schließen">
          ×
        </Button>
      }
      style={{
        position: 'absolute',
        right: 12,
        top: 12,
        width,
        zIndex: 5,
        maxHeight: 'calc(100% - 24px)',
        overflowY: 'auto',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
      }}
      styles={{
        header: { borderLeft: `4px solid ${akzentFarbe}` },
        title: { whiteSpace: 'normal' },
      }}
    >
      {children}
    </Card>
  );
}
