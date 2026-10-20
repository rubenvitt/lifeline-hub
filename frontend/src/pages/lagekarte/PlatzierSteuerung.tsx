import { Button, Card, Space, Switch, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { monoStil, Segmentleiste } from '../../components/instrument';
import type { GriffModus } from './bildGriffe';
import { bandStil } from './KartenFuss';

/**
 * Rückmeldung nach dem Verorten (LLH-1125, Spec `lagekarte-verortungsauftrag`): „<Kennung>
 * verortet“, primär „Zurück zu <Kennung>“ (nur mit Herkunft), daneben „Auf der Karte bleiben“.
 */
export interface VerortetMeldung {
  /** z. B. „R-005“; `null`, wenn das Objekt nicht geladen ist — dann „Objekt verortet“. */
  kennung: string | null;
  /** Rückweg zur Seite des Datensatzes; `null` ohne Herkunft (kein `?zurueck=1`). */
  onZurueck: (() => void) | null;
  onBleiben: () => void;
}

/**
 * Titel und Knöpfe der Rückmeldung — ein Baustein für das Fuß-Band (unter `lg`) und die Leiste
 * (ab `lg`), damit beide denselben Wortlaut tragen. Gerendert wird er je Breite nur an einer Stelle.
 */
export function VerortetInhalt({ meldung }: { meldung: VerortetMeldung }) {
  const { kennung, onZurueck, onBleiben } = meldung;
  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text strong>
        {kennung ? `${kennung} verortet` : 'Objekt verortet'}
      </Typography.Text>
      <Space wrap>
        {onZurueck && (
          <Button type="primary" onClick={onZurueck}>
            {kennung ? `Zurück zu ${kennung}` : 'Zurück'}
          </Button>
        )}
        <Button onClick={onBleiben}>Auf der Karte bleiben</Button>
      </Space>
    </Space>
  );
}

/** Laufender Leistenmodus, wie ihn das Band bedient. `null` = keiner, dann rendert es nichts. */
export type PlatzierModus =
  | { art: 'verortet'; meldung: VerortetMeldung }
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

/** Titel eines laufenden Leistenmodus — im Fuß-Band und im Modus-Band der Leiste derselbe. */
export function modusTitel(modus: Exclude<PlatzierModus, { art: 'verortet' }>): string {
  return modus.art === 'platzieren'
    ? `Platzieren · ${modus.objekt}`
    : modus.art === 'zeichen'
      ? 'Taktisches Zeichen'
      : `Bild einpassen · ${modus.name}`;
}

/**
 * Titel, Zusatzangaben und Knöpfe eines Leistenmodus — EIN Baustein für das Fuß-Band (unter `lg`)
 * und das Modus-Band der Leiste (ab `lg`, `ModusBand.tsx`), damit beide dieselbe Bedienung mit
 * demselben Wortlaut tragen. Gerendert wird die Bedienung je Breite nur an einer Stelle.
 *
 * `bedienung = false` lässt die Knöpfe weg (Modus-Band unter `lg`: dort stehen sie im Fuß); es
 * bleiben Titel und `zusatz` (Koordinate, Mittelpunkt).
 */
export function ModusBedienung({
  modus,
  zusatz,
  bedienung = true,
}: {
  modus: PlatzierModus;
  zusatz?: ReactNode;
  bedienung?: boolean;
}) {
  const { token } = theme.useToken();
  if (modus.art === 'verortet')
    return bedienung ? <VerortetInhalt meldung={modus.meldung} /> : null;
  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text strong>{modusTitel(modus)}</Typography.Text>
      {zusatz}
      {bedienung && modus.art === 'platzieren' && (
        <Button onClick={modus.onAbbrechen}>Abbrechen</Button>
      )}
      {bedienung && modus.art === 'zeichen' && (
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
          {/* Solange nichts gesetzt ist, verwirft Beenden nur die Absicht („Abbrechen"); danach
              bleibt das Gesetzte, also „Fertig". */}
          {modus.anzahl > 0 ? (
            <Button type="primary" onClick={modus.onFertig}>
              Fertig
            </Button>
          ) : (
            <Button onClick={modus.onAbbrechen}>Abbrechen</Button>
          )}
        </>
      )}
      {bedienung && modus.art === 'bild' && (
        <Space wrap>
          {/* Ein Umschalter statt zehn gleichzeitig scharfer Griffe: in Fingergröße lägen Ecken,
              Kanten, Drehung und Mitte auf einem kleinen Bild übereinander. */}
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
  );
}

/**
 * Bedienung der Leistenmodi (Platzieren, Taktisches Zeichen, Bild einpassen) im Kartenfuß — nur
 * unter `lg` eingehängt (LFH-765). Dort schließt ein laufender Kartenmodus die Leiste, damit Karte
 * zum Tippen bleibt. Ab `lg` steht dieselbe Bedienung im Modus-Band der Leiste (`ModusBand.tsx`),
 * und das Band zeigt unter `lg` an deren Stelle nur Titel und Zusatzangaben: je Breite genau ein
 * Knopf je Handlung.
 *
 * Muster und Positionierung wie `ZeichnenSteuerung`: ein Flow-Band des `KartenFuss`, nie absolut.
 * Zusatzangaben (Koordinate, Mittelpunkt numerisch) bleiben Leisteninhalt — „Leiste einblenden".
 */
export default function PlatzierSteuerung({ modus }: { modus: PlatzierModus | null }) {
  const { token } = theme.useToken();
  if (!modus) return null;
  return (
    <Card
      size="small"
      data-lfh="platzier-steuerung"
      data-testid={modus.art === 'verortet' ? 'verortet-rueckmeldung' : undefined}
      style={{
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        // Wie die Zeichnen-Steuerung: 320 px, aber nie breiter als der Fuß.
        minWidth: 'min(320px, 100%)',
      }}
    >
      <ModusBedienung modus={modus} />
    </Card>
  );
}
