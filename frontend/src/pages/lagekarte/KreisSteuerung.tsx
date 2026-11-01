import { Button, Card, Space, Switch, Typography } from 'antd';
import { Select } from '../../components/Select';
import { monoStil, useRollen } from '../../components/instrument';
import RadiusEingabe from '../../components/RadiusEingabe';
import type { ZoneTyp } from '../../api/types';
import EscKappe from './EscKappe';
import { bandStil } from './KartenFuss';
import { radiusGueltig, type GeoPunkt } from './geo';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN, zoneTypLabel } from './zonenStil';
import './lagekarte.css';

/** Die Zonenarten, die ein Kreis sein können — jede mit Fläche (nicht die Absperrgrenze). */
export const KREIS_TYPEN = ZONE_TYPEN.filter((t) => t.geometrie !== 'LineString');

interface KreisSteuerungProps {
  aktiv: boolean;
  typ: ZoneTyp;
  /** Art wechseln; die freie Skizze bringt ihre Vorgabefarbe mit. */
  onTyp: (typ: ZoneTyp, farbe?: string) => void;
  mitte: GeoPunkt | null;
  /** Die Mitte im eingestellten Koordinatensystem; nur mit `mitte`. */
  mitteText: string | null;
  /** Wo die Mitte auf Knopfdruck herkommen kann; ein fehlender Ort hat keinen Knopf. */
  einsatzort?: GeoPunkt | null;
  suchnadel?: GeoPunkt | null;
  onMitte: (mitte: GeoPunkt) => void;
  radiusM: number | null;
  onRadius: (radiusM: number | null) => void;
  speichernLaeuft?: boolean;
  onUebernehmen: () => void;
  onAbbrechen: () => void;
  serie?: boolean;
  onSerieWechsel?: (an: boolean) => void;
  serieAnzahl?: number;
  onFertig?: () => void;
  /**
   * Der Kreis einer bestehenden Zone (LLH-1344, design.md D3): die Art steht fest (Text statt
   * Auswahl), „Übernehmen“ braucht eine Änderung, und Esc beendet nur ohne Änderung.
   */
  bearbeiten?: { geaendert: boolean };
  /**
   * Der Kreis ist die Fläche dieses Evakuierungsbezirks (LLH-1346, Auftrag mit `bezirk=`): die Art
   * steht fest, der Kopf nennt den Bezirk wie das Band einer gezeichneten Fläche.
   */
  bezirk?: string;
}

/**
 * Band im Kartenfuß für den Kreis um einen Punkt (LLH-1043, design.md D5): Art, Mitte, Radius als
 * Zahl mit Schnellwahl, „Übernehmen“. Der Hauptweg ist handschuhtauglich: kein Ziehen nötig, jeder
 * Wert ist ein Knopf oder eine Zahl. Die Mitte kommt außerdem aus einem Tipp auf die Karte, der
 * Radius aus dem Griff am Kreis — beides meldet die Karte, das Band zeigt nur den Stand.
 *
 * Präsentationsfrei wie `ZeichnenSteuerung`: keine Kartenkenntnis, nur Props und Callbacks. Die
 * Texte nennen Zustände, keine Bedienung (LFH-1078): „Mitte —“, nicht „Tippen Sie …“.
 */
export default function KreisSteuerung(props: KreisSteuerungProps) {
  const { token, rollen } = useRollen();
  if (!props.aktiv) return null;
  const sperre = !!props.speichernLaeuft;
  const bearbeiten = props.bearbeiten;
  const bereit =
    props.mitte != null && radiusGueltig(props.radiusM) && (!bearbeiten || bearbeiten.geaendert);
  const gespeichert = props.serieAnzahl ?? 0;
  // Esc ohne Mitte beendet wie der Knopf (LFH-712); mit Mitte verwirft es nur die Mitte. Am Kreis
  // einer bestehenden Zone ist die Änderung die Figur (LLH-1344, D5).
  const escBeendet = (bearbeiten ? !bearbeiten.geaendert : props.mitte == null) && !sperre;
  const beenden =
    gespeichert > 0 && props.onFertig ? (
      <Button onClick={props.onFertig} aria-keyshortcuts={escBeendet ? 'Escape' : undefined}>
        Fertig{escBeendet && <EscKappe />}
      </Button>
    ) : (
      <Button onClick={props.onAbbrechen} aria-keyshortcuts={escBeendet ? 'Escape' : undefined}>
        Abbrechen{escBeendet && <EscKappe />}
      </Button>
    );
  const zeile = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: token.marginXS,
  } as const;
  return (
    <Card
      size="small"
      data-lfh="kreis-steuerung"
      style={{
        ...bandStil('mitte'),
        boxShadow: token.boxShadowSecondary,
        minWidth: 'min(320px, 100%)',
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <div style={zeile}>
          <Typography.Text strong>
            {props.bezirk != null ? `Bezirk ${props.bezirk} · Kreis` : 'Kreis'}
          </Typography.Text>
          {props.bezirk != null ? null : bearbeiten ? (
            <Typography.Text>{zoneTypLabel(props.typ)}</Typography.Text>
          ) : (
            <Select<ZoneTyp>
              aria-label="Art"
              value={props.typ}
              disabled={sperre}
              style={{ minWidth: 168 }}
              options={KREIS_TYPEN.map((t) => ({ value: t.typ, label: t.label }))}
              onChange={(typ) =>
                props.onTyp(typ, typ === 'freie_skizze' ? FREIE_SKIZZE_VORGABEFARBE : undefined)
              }
            />
          )}
        </div>
        <div style={zeile} data-lfh="kreis-mitte">
          <Typography.Text type="secondary">Mitte</Typography.Text>
          <Typography.Text style={{ ...monoStil(token.fontSize), color: rollen.text }}>
            {props.mitte && props.mitteText ? props.mitteText : '—'}
          </Typography.Text>
          {props.einsatzort && (
            <Button disabled={sperre} onClick={() => props.onMitte(props.einsatzort!)}>
              Einsatzort
            </Button>
          )}
          {props.suchnadel && (
            <Button disabled={sperre} onClick={() => props.onMitte(props.suchnadel!)}>
              Suchnadel
            </Button>
          )}
        </div>
        <div style={zeile} data-lfh="kreis-radius">
          <RadiusEingabe
            value={props.radiusM}
            onChange={props.onRadius}
            disabled={sperre}
            onPressEnter={() => {
              if (bereit && !sperre) props.onUebernehmen();
            }}
          />
        </div>
        {props.onSerieWechsel && (
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
        )}
        <Space wrap>
          <Button type="primary" disabled={!bereit} loading={sperre} onClick={props.onUebernehmen}>
            Übernehmen
          </Button>
          {beenden}
        </Space>
      </Space>
    </Card>
  );
}
