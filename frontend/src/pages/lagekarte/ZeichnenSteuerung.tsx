import { Button, Card, Space, Switch, Typography, theme } from 'antd';

export type ZeichnenPhase = 'zeichnen' | 'bestaetigen';

export interface ZeichnenSteuerungProps {
  aktiv: boolean;
  /** z. B. "Gefahrengebiet · Fläche" oder "Abschnitt". */
  titel: string;
  phase: ZeichnenPhase;
  /** true, wenn in Phase 'bestaetigen' ein Speichern-Request läuft. */
  speichernLaeuft?: boolean;
  /** Mindestens drei Punkte sind gesetzt; bis dahin ist der explizite Abschluss gesperrt. */
  abschliessenMoeglich?: boolean;
  onAbschliessen: () => void;
  onAbbrechen: () => void;
  onSpeichern: () => void;
  onVerwerfen: () => void;
  /**
   * Serienmodus (LFH-332/M76) — nur für ZONEN gesetzt.
   *
   * `onSerieWechsel` ist der Schalter für „gibt es das hier überhaupt": fehlt er, rendert
   * die Steuerung exakt wie zuvor. Das Abschnitt-Zeichnen läuft über dieselbe Komponente,
   * hat aber keinen Serienmodus — eine Abschnittsfläche gehört zu genau einem Abschnitt,
   * die zweite in Folge zu zeichnen ergäbe keinen Vorgang.
   */
  serie?: boolean;
  onSerieWechsel?: (an: boolean) => void;
  /** Bereits gespeicherte Objekte der laufenden Serie; 0 = noch keins. */
  serieAnzahl?: number;
  /** Beendet die Serie. Ohne ihn bleibt es beim „Abbrechen". */
  onFertig?: () => void;
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
  const gespeichert = props.serieAnzahl ?? 0;
  // Der Serien-Schalter steht in BEIDEN Phasen: vor dem Zeichnen ist er die Ansage, danach
  // die letzte Gelegenheit, sie vor dem Speichern zu widerrufen.
  const serienZeile = props.onSerieWechsel && (
    <Space>
      <Switch
        checked={!!props.serie}
        onChange={props.onSerieWechsel}
        aria-label="Weitere zeichnen"
      />
      <Typography.Text>Weitere zeichnen</Typography.Text>
      {gespeichert > 0 && (
        <Typography.Text type="secondary">{gespeichert} gespeichert</Typography.Text>
      )}
    </Space>
  );
  // Ein Knopf, zwei Wahrheiten (wie in der Sidebar): „Abbrechen" verwirft nur einen Entwurf.
  // Ab der ersten gespeicherten Zone der Serie bliebe das Gespeicherte stehen — dann heißt
  // Beenden „Fertig".
  const beenden =
    gespeichert > 0 && props.onFertig ? (
      <Button onClick={props.onFertig}>Fertig</Button>
    ) : (
      <Button onClick={props.onAbbrechen}>Abbrechen</Button>
    );
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
            <Typography.Text type="secondary">Entwurf prüfen und speichern.</Typography.Text>
            {serienZeile}
            <Space>
              <Button type="primary" loading={props.speichernLaeuft} onClick={props.onSpeichern}>
                Speichern
              </Button>
              <Button disabled={props.speichernLaeuft} onClick={props.onVerwerfen}>
                Verwerfen
              </Button>
            </Space>
          </>
        ) : (
          <>
            <Typography.Text type="secondary">
              Punkte per Klick setzen. Startpunkt klicken, doppelklicken oder „Abschließen".
            </Typography.Text>
            {serienZeile}
            <Space>
              <Button
                type="primary"
                disabled={props.abschliessenMoeglich === false}
                onClick={props.onAbschliessen}
              >
                Abschließen
              </Button>
              {beenden}
            </Space>
          </>
        )}
      </Space>
    </Card>
  );
}
