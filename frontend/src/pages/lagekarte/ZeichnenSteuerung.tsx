import { Button, Card, Space, Switch, Typography, theme } from 'antd';
import { TbArrowBackUp } from 'react-icons/tb';
import { monoStil } from '../../components/instrument';
import { bandStil } from './KartenFuss';
import './lagekarte.css';

type ZeichnenPhase = 'zeichnen' | 'bestaetigen';

interface ZeichnenSteuerungProps {
  aktiv: boolean;
  /** z. B. "Gefahrengebiet · Fläche" oder "Abschnitt". */
  titel: string;
  phase: ZeichnenPhase;
  /** true, wenn in Phase 'bestaetigen' ein Speichern-Request läuft. */
  speichernLaeuft?: boolean;
  /** Mindestens drei Punkte sind gesetzt; bis dahin ist der explizite Abschluss gesperrt. */
  abschliessenMoeglich?: boolean;
  onAbschliessen: () => void;
  /** Punkte der laufenden Figur, als Zähler in der Zeichenphase. Nicht gesetzt → kein Zähler. */
  punkte?: number;
  /** Es gibt einen Punkt zum Zurücknehmen; bis dahin ist „Letzten Punkt zurück" gesperrt. */
  punktZurueckMoeglich?: boolean;
  /** „Letzten Punkt zurück". Nicht gesetzt → kein Knopf. */
  onPunktZurueck?: () => void;
  onAbbrechen: () => void;
  onSpeichern: () => void;
  onVerwerfen: () => void;
  /**
   * Serienmodus — nur für Zonen gesetzt. Ohne `onSerieWechsel` gibt es ihn nicht: eine
   * Abschnittsfläche gehört zu genau einem Abschnitt, eine zweite in Folge ergäbe keinen Vorgang.
   */
  serie?: boolean;
  onSerieWechsel?: (an: boolean) => void;
  /** Bereits gespeicherte Objekte der laufenden Serie; 0 = noch keins. */
  serieAnzahl?: number;
  /** Beendet die Serie. Ohne ihn bleibt es beim „Abbrechen". */
  onFertig?: () => void;
}

/**
 * Overlay im Kartenfuß, das den Zeichen-Zustand sichtbar macht und den Abschluss explizit steuert.
 * Zwei Phasen:
 * - 'zeichnen' → Hinweis + Punktzähler + „Abschließen" / „Letzten Punkt zurück" / „Abbrechen"
 * - 'bestaetigen' → „Speichern" / „Verwerfen" (Entwurf bleibt auf der Karte sichtbar)
 *   Präsentationsfrei: keine Karten-/terra-draw-Kenntnis, nur Props + Callbacks.
 */
export default function ZeichnenSteuerung(props: ZeichnenSteuerungProps) {
  const { token } = theme.useToken();
  if (!props.aktiv) return null;
  const bestaetigen = props.phase === 'bestaetigen';
  const gespeichert = props.serieAnzahl ?? 0;
  // Der Serien-Schalter steht in beiden Phasen: vor dem Zeichnen ist er die Ansage, danach die
  // letzte Gelegenheit, sie vor dem Speichern zu widerrufen.
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
  // „Abbrechen" verwirft nur einen Entwurf; ab der ersten gespeicherten Zone heißt Beenden
  // „Fertig", weil das Gespeicherte bleibt.
  //
  // Der Tastaturvertrag steht einmal, hier. Er gilt in beiden Phasen: auch eine fertige,
  // ungespeicherte Figur verwirft das erste Esc. Nur mit feinem Zeiger (`lfh-nur-feiner-zeiger`):
  // Touch hat keine Esc-Taste, und die Zeile kostete dort Höhe, die der Fuß bei 390 px nicht hat.
  const escHinweis = (
    <Typography.Text type="secondary" className="lfh-nur-feiner-zeiger">
      Esc verwirft die Zeichnung, ein zweites Esc beendet das Zeichnen.
    </Typography.Text>
  );
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
        // Die Positionierung gehört dem `KartenFuss`: als Flow-Band kann die SnapshotLeiste sie
        // nicht verdecken. Wer ihr `position: 'absolute'` zurückgibt, holt den Bug mit.
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        // 320 px, aber nie breiter als der Fuß — auf dem Handschirm liefe die Karte sonst über.
        minWidth: 'min(320px, 100%)',
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        {/* Titel und Punktzähler teilen eine Zeile: jede Zeile mehr hebt den Fuß auf dem
            Handschirm über die Karte. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: token.marginXS,
          }}
        >
          <Typography.Text strong>{props.titel}</Typography.Text>
          {!bestaetigen && props.punkte != null && (
            <Typography.Text data-lfh="zeichnen-punkte" style={monoStil(token.fontSize)}>
              {props.punkte === 1 ? '1 Punkt' : `${props.punkte} Punkte`}
            </Typography.Text>
          )}
        </div>
        {bestaetigen ? (
          <>
            <Typography.Text type="secondary">Entwurf prüfen und speichern.</Typography.Text>
            {escHinweis}
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
            {escHinweis}
            {serienZeile}
            {/* Drei Knöpfe in einer Reihe, „zurück" als Symbolknopf (Name über `aria-label` und
                `title`): mit Textetikett brach die Reihe bei Touch-Höhe um. `wrap` bleibt als
                Rückfall für die Handschuhstufe. */}
            <Space wrap>
              <Button
                type="primary"
                disabled={props.abschliessenMoeglich === false}
                onClick={props.onAbschliessen}
              >
                Abschließen
              </Button>
              {props.onPunktZurueck && (
                <Button
                  aria-label="Letzten Punkt zurück"
                  title="Letzten Punkt zurück"
                  icon={
                    <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                      <TbArrowBackUp size={18} />
                    </span>
                  }
                  disabled={props.punktZurueckMoeglich === false}
                  onClick={props.onPunktZurueck}
                />
              )}
              {beenden}
            </Space>
          </>
        )}
      </Space>
    </Card>
  );
}
