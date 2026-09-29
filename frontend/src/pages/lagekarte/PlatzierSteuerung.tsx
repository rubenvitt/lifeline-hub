import { Button, Card, Space, Switch, Typography, theme } from 'antd';
import { monoStil, Segmentleiste } from '../../components/instrument';
import type { GriffModus } from './bildGriffe';
import { bandStil } from './KartenFuss';

/** Laufender Leistenmodus, wie ihn das Band bedient. `null` = keiner, dann rendert es nichts. */
export type PlatzierModus =
  | {
      art: 'platzieren';
      /** z. B. „Einheit: Pumpe Ost" oder „Einsatzort". */
      objekt: string;
      onAbbrechen: () => void;
    }
  | {
      art: 'zeichen';
      serie: boolean;
      onSerieWechsel: (an: boolean) => void;
      /** Bereits gesetzte Zeichen der laufenden Serie; 0 = noch keins. */
      anzahl: number;
      onAbbrechen: () => void;
      onFertig: () => void;
    }
  | {
      art: 'bild';
      name: string;
      griffModus: GriffModus;
      onGriffModus: (modus: GriffModus) => void;
      onFertig: () => void;
    };

/**
 * Bedienung der Leistenmodi (Platzieren, Taktisches Zeichen, Bild einpassen) im Kartenfuß — nur
 * unter `lg` eingehängt (LFH-765). Dort schließt ein laufender Kartenmodus die Leiste, damit Karte
 * zum Tippen bleibt; ihr „Abbrechen"/„Fertig" stand aber in der Leiste. Ab `lg` bleibt es dort,
 * und die Sidebar zeigt unter `lg` an deren Stelle nur einen Hinweis (`modusBedienungImFuss`):
 * je Breite genau ein Knopf je Handlung.
 *
 * Muster und Positionierung wie `ZeichnenSteuerung`: ein Flow-Band des `KartenFuss`, nie absolut.
 * Zusatzangaben (Koordinate, Mittelpunkt numerisch) bleiben Leisteninhalt — „Leiste einblenden".
 */
export default function PlatzierSteuerung({ modus }: { modus: PlatzierModus | null }) {
  const { token } = theme.useToken();
  if (!modus) return null;
  const titel =
    modus.art === 'platzieren'
      ? `Platzieren · ${modus.objekt}`
      : modus.art === 'zeichen'
        ? 'Taktisches Zeichen'
        : `Bild einpassen · ${modus.name}`;
  return (
    <Card
      size="small"
      data-lfh="platzier-steuerung"
      style={{
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        // Wie die Zeichnen-Steuerung: 320 px, aber nie breiter als der Fuß.
        minWidth: 'min(320px, 100%)',
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text strong>{titel}</Typography.Text>
        {modus.art === 'platzieren' && (
          <>
            <Typography.Text type="secondary">
              Tipp auf die Karte setzt die Position.
            </Typography.Text>
            <Button onClick={modus.onAbbrechen}>Abbrechen</Button>
          </>
        )}
        {modus.art === 'zeichen' && (
          <>
            {/* Schalter, Zähler und Beenden teilen eine umbrechende Reihe: jede Zeile mehr hebt
                den Fuß bei 390 px über die Karte. */}
            <Space wrap>
              <Switch
                checked={modus.serie}
                onChange={modus.onSerieWechsel}
                aria-label="Weitere platzieren"
              />
              <Typography.Text>Weitere platzieren</Typography.Text>
              {modus.anzahl > 0 && (
                <Typography.Text type="secondary" style={monoStil(token.fontSize)}>
                  {modus.anzahl} platziert
                </Typography.Text>
              )}
            </Space>
            {/* Dieselbe Regel wie in der Leiste: solange nichts gesetzt ist, verwirft Beenden nur
                die Absicht („Abbrechen"); danach bleibt das Gesetzte, also „Fertig". */}
            {modus.anzahl > 0 ? (
              <Button type="primary" onClick={modus.onFertig}>
                Fertig
              </Button>
            ) : (
              <Button onClick={modus.onAbbrechen}>Abbrechen</Button>
            )}
          </>
        )}
        {modus.art === 'bild' && (
          <Space wrap>
            <Segmentleiste<GriffModus>
              beschriftung="Griffe auf der Karte"
              wert={modus.griffModus}
              onWechsel={modus.onGriffModus}
              optionen={[
                { wert: 'verschieben', label: 'Verschieben' },
                { wert: 'groesse', label: 'Größe' },
                { wert: 'drehen', label: 'Drehen' },
              ]}
            />
            <Button type="primary" onClick={modus.onFertig}>
              Fertig
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}
