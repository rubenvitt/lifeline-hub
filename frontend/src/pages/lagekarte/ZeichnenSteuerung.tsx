import { Button, Card, Space, Typography, theme } from 'antd';

export type ZeichnenPhase = 'zeichnen' | 'bestaetigen';

export interface ZeichnenSteuerungProps {
  aktiv: boolean;
  /** z. B. "Gefahrengebiet · Fläche" oder "Abschnitt". */
  titel: string;
  phase: ZeichnenPhase;
  /** true, wenn in Phase 'bestaetigen' ein Speichern-Request läuft. */
  speichernLaeuft?: boolean;
  onAbschliessen: () => void;
  onAbbrechen: () => void;
  onSpeichern: () => void;
  onVerwerfen: () => void;
}

/**
 * Overlay über der Karte, das den aktiven Zeichen-Zustand sichtbar macht und den
 * Abschluss explizit steuert (LFH-145). Zwei Phasen:
 *  - 'zeichnen'    → Hinweis + „Abschließen" / „Abbrechen"
 *  - 'bestaetigen' → „Speichern" / „Verwerfen" (Entwurf bleibt auf der Karte sichtbar)
 * Präsentationsfrei: keine Karten-/terra-draw-Kenntnis, nur Props + Callbacks.
 */
export default function ZeichnenSteuerung(props: ZeichnenSteuerungProps) {
  const { token } = theme.useToken();
  if (!props.aktiv) return null;
  const bestaetigen = props.phase === 'bestaetigen';
  return (
    <Card
      size="small"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 5,
        boxShadow: token.boxShadowSecondary,
        minWidth: 320,
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text strong>{props.titel}</Typography.Text>
        {bestaetigen ? (
          <>
            <Typography.Text type="secondary">
              Entwurf prüfen und speichern.
            </Typography.Text>
            <Space>
              <Button type="primary" loading={props.speichernLaeuft} onClick={props.onSpeichern}>
                Speichern
              </Button>
              <Button disabled={props.speichernLaeuft} onClick={props.onVerwerfen}>Verwerfen</Button>
            </Space>
          </>
        ) : (
          <>
            <Typography.Text type="secondary">
              Punkte per Klick setzen. Startpunkt klicken, doppelklicken oder „Abschließen".
            </Typography.Text>
            <Space>
              <Button type="primary" onClick={props.onAbschliessen}>
                Abschließen
              </Button>
              <Button onClick={props.onAbbrechen}>Abbrechen</Button>
            </Space>
          </>
        )}
      </Space>
    </Card>
  );
}
