import { Button, Card, Space, Switch, Typography, theme } from 'antd';
import { TbArrowBackUp } from 'react-icons/tb';
import { monoStil } from '../../components/instrument';
import { bandStil } from './KartenFuss';
import './lagekarte.css';

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
  /**
   * Punkte der laufenden Figur (LFH-712) — als Zähler in der Zeichenphase. Nicht gesetzt →
   * kein Zähler.
   */
  punkte?: number;
  /** Es gibt einen Punkt zum Zurücknehmen; bis dahin ist „Letzten Punkt zurück" gesperrt. */
  punktZurueckMoeglich?: boolean;
  /** „Letzten Punkt zurück" (LFH-712). Nicht gesetzt → kein Knopf. */
  onPunktZurueck?: () => void;
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
 *  - 'zeichnen'    → Hinweis + Punktzähler + „Abschließen" / „Letzten Punkt zurück" / „Abbrechen"
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
  // Der Tastaturvertrag steht EINMAL, hier — nicht im Knopf, nicht als Tooltip (CLAUDE.md,
  // „Ein Tastaturvertrag steht EINMAL"). Er gilt in beiden Phasen: auch eine fertige,
  // ungespeicherte Figur verwirft das erste Esc (LFH-712, design.md D2). Nur mit feinem Zeiger
  // (`lfh-nur-feiner-zeiger`): ein reines Touch-Gerät hat keine Esc-Taste, und die Zeile kostete
  // dort die Höhe, die der Fuß auf der halbierten Karte bei 390 px nicht hat (LFH-713,
  // `e2e/lagekarte-touch.spec.ts`).
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
        // Positionierung gehört dem `KartenFuss` (LFH-355), nicht dieser Karte: sie lag
        // hier absolut auf `zIndex: 5` und wurde von der gleich hohen, später gerenderten
        // SnapshotLeiste verdeckt. Als Flow-Band in der Fuß-Spalte kann das nicht wieder
        // passieren — wer ihr `position: 'absolute'` zurückgibt, holt den Bug mit.
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        // 320 px, aber nie breiter als der Fuß: auf dem Handschirm (390 px) liefe die Karte
        // sonst waagerecht über (Neuentwurf S5, die Karte trägt dort die volle Breite).
        minWidth: 'min(320px, 100%)',
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        {/* Titel und Punktzähler teilen eine Zeile: jede Zeile mehr hebt den Fuß über die Karte,
            sobald sie auf dem Handschirm halbiert ist (LFH-713). */}
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
            {/* Drei Knöpfe in EINER Reihe: „zurück" als Symbolknopf, beschriftet über den
                zugänglichen Namen und `title`. Mit Textetikett brach die Reihe bei Touch-Höhe
                um und hob den Fuß um eine Knopfhöhe (LFH-713). `wrap` bleibt als Rückfall für
                die Handschuhstufe. */}
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
