import { IconPfeilZurueckGebogen, IconWarndreieck } from '../../icons';
import { Button, Card, Space, Typography } from 'antd';
import { monoStil, useRollen } from '../../components/instrument';
import { GEOMETRIE_STUETZPUNKTE_MAX } from '../../api/eingabegrenzen';
import { grenzeText } from '../../components/zeichenGrenze';
import EscKappe from './EscKappe';
import { bandStil } from './KartenFuss';
import './lagekarte.css';

interface BearbeitenSteuerungProps {
  aktiv: boolean;
  /** z. B. „Absperrbereich «Nord» bearbeiten“. */
  titel: string;
  /** Eckpunkte der Figur über alle Ringe. */
  punkte: number;
  figur: 'flaeche' | 'linie';
  /** Die Zone ist eine Kreiszone: nach dem Übernehmen ist sie es nicht mehr. */
  kreis: boolean;
  /** Die Figur weicht vom Gespeicherten ab; ohne Änderung ist „Übernehmen“ gesperrt. */
  geaendert: boolean;
  /** Ein Punkt ist gewählt und der Ring liegt über dem Minimum. */
  kannEntfernen: boolean;
  /** Es gibt eine Änderung zum Zurücknehmen. */
  kannZurueck: boolean;
  speichernLaeuft?: boolean;
  onEntfernen: () => void;
  onZurueck: () => void;
  onUebernehmen: () => void;
  onAbbrechen: () => void;
}

/**
 * Band im Kartenfuß für die punktweise Bearbeitung einer Zone (LLH-1344, design.md D2). Die
 * Griffe an der Karte verschieben und fügen ein; hier stehen Zähler, „Punkt entfernen“ für den
 * gewählten Punkt, „Letzte Änderung zurück“, „Übernehmen“ und „Abbrechen“. Jeder Weg ist ein
 * Knopf: mit Handschuh braucht keiner eine Geste außer dem Ziehen des Griffs.
 *
 * Präsentationsfrei wie `ZeichnenSteuerung`. Texte nennen Zustände, keine Bedienung (LFH-1078);
 * bei einer Kreiszone steht vorher der eine Satz zur Folge („Danach kein Kreis mehr“).
 */
export default function BearbeitenSteuerung(props: BearbeitenSteuerungProps) {
  const { token, rollen } = useRollen();
  if (!props.aktiv) return null;
  const sperre = !!props.speichernLaeuft;
  // Der Server zählt beim Polygon den Schlusspunkt mit (LFH-937).
  const zuViele = props.punkte + (props.figur === 'flaeche' ? 1 : 0) > GEOMETRIE_STUETZPUNKTE_MAX;
  // Esc ist zweistufig (LFH-712, design.md D5): mit Änderung verwirft es die Änderungen, ohne
  // beendet es wie dieser Knopf.
  const escBeendet = !props.geaendert && !sperre;
  return (
    <Card
      size="small"
      data-lfh="bearbeiten-steuerung"
      style={{
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        minWidth: 'min(320px, 100%)',
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: token.marginXS,
          }}
        >
          <Typography.Text strong>{props.titel}</Typography.Text>
          <Typography.Text data-lfh="bearbeiten-punkte" style={monoStil(token.fontSize)}>
            {props.punkte === 1 ? '1 Punkt' : `${grenzeText(props.punkte)} Punkte`}
          </Typography.Text>
        </div>
        {zuViele && (
          <Typography.Text
            style={{
              color: rollen.alarmText,
              display: 'inline-flex',
              alignItems: 'center',
              gap: token.marginXXS,
            }}
          >
            <IconWarndreieck />
            <span>zu viele Punkte (höchstens {grenzeText(GEOMETRIE_STUETZPUNKTE_MAX)})</span>
          </Typography.Text>
        )}
        {props.kreis && (
          <Typography.Text type="secondary" data-lfh="bearbeiten-kreis-hinweis">
            Danach kein Kreis mehr: Mitte und Radius entfallen.
          </Typography.Text>
        )}
        <Space wrap>
          <Button disabled={sperre || !props.kannEntfernen} onClick={props.onEntfernen}>
            Punkt entfernen
          </Button>
          <Button
            aria-label="Letzte Änderung zurück"
            title="Letzte Änderung zurück"
            icon={
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <IconPfeilZurueckGebogen size={18} />
              </span>
            }
            disabled={sperre || !props.kannZurueck}
            onClick={props.onZurueck}
          />
        </Space>
        <Space wrap>
          <Button
            type="primary"
            disabled={!props.geaendert || zuViele}
            loading={sperre}
            onClick={props.onUebernehmen}
          >
            Übernehmen
          </Button>
          <Button
            disabled={sperre}
            onClick={props.onAbbrechen}
            aria-keyshortcuts={escBeendet ? 'Escape' : undefined}
          >
            Abbrechen{escBeendet && <EscKappe />}
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
