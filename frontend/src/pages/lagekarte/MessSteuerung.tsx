import { Button, Card, Space, Typography } from 'antd';
import { Segmentleiste, monoStil, useRollen } from '../../components/instrument';
import { bandStil } from './KartenFuss';
import { messErgebnis, type MessForm } from './messung';
import { useMessStand, type MessQuelle } from './messQuelle';

export interface MessSteuerungProps {
  /** Aktive Form; `null` = nicht messen, dann rendert nichts. */
  form: MessForm | null;
  /** Laufender Stand aus der Karte — abonniert HIER, nicht in der Seite (`messQuelle.ts`). */
  quelle: MessQuelle;
  onForm: (form: MessForm) => void;
  onAbschliessen: () => void;
  onNeu: () => void;
  onBeenden: () => void;
}

const FORMEN = [
  { wert: 'strecke', label: 'Strecke' },
  { wert: 'flaeche', label: 'Fläche' },
] as const;

/**
 * Band im Kartenfuß fürs Messwerkzeug (LFH-616) — Geschwister der `ZeichnenSteuerung`,
 * gleiche Bauform (Flow-Band, LFH-355), aber OHNE Speichern: eine Messung ist ein Blick auf
 * die Karte, kein Lageobjekt.
 *
 * Der ausdrückliche „Abschließen"-Knopf ist die Antwort auf den Handschuh-Kontext: ein
 * Doppelklick ist dort keine verlässliche Geste (CLAUDE.md, Führungs-Tablet). Präsentations-
 * frei wie das Geschwister — keine Karten- oder terra-draw-Kenntnis, nur Props.
 */
export default function MessSteuerung(props: MessSteuerungProps) {
  const { token, rollen } = useRollen();
  const stand = useMessStand(props.quelle);
  if (!props.form) return null;
  const ergebnis = messErgebnis(props.form, stand.geometrie);
  const fertig = stand.fertig;
  const hatWert = ergebnis.haupt !== '—';
  return (
    <Card
      size="small"
      data-lfh="mess-steuerung"
      style={{
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        minWidth: 'min(320px, 100%)',
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Segmentleiste<MessForm>
          optionen={FORMEN}
          wert={props.form}
          onWechsel={props.onForm}
          beschriftung="Messform"
        />
        {/* `<output>`: der Wert ist das Ergebnis einer Bedienung, keine Überschrift. Bewusst
            ohne `aria-live` — er ändert sich bei jeder Zeigerbewegung. */}
        <output data-lfh="messwert" style={{ display: 'block' }}>
          <span style={{ ...monoStil(20, 500), color: rollen.text }}>{ergebnis.haupt}</span>
          {ergebnis.neben && (
            <span
              style={{
                ...monoStil(12),
                color: rollen.gedaempft,
                marginInlineStart: token.marginSM,
              }}
            >
              {ergebnis.neben}
            </span>
          )}
        </output>
        <Typography.Text type="secondary">
          {fertig
            ? 'Gemessen. Ein neuer Klick beginnt eine neue Messung.'
            : 'Punkte per Klick setzen, doppelklicken oder „Abschließen".'}
        </Typography.Text>
        <Space>
          {fertig ? (
            <Button onClick={props.onNeu}>Neu messen</Button>
          ) : (
            <Button type="primary" disabled={!hatWert} onClick={props.onAbschliessen}>
              Abschließen
            </Button>
          )}
          <Button onClick={props.onBeenden}>Beenden</Button>
        </Space>
      </Space>
    </Card>
  );
}
