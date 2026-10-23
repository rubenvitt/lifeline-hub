import { Form, Typography } from 'antd';
import { useMemo } from 'react';
import type { EinsatzMaterial, Nachforderung } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { Select } from '../components/Select';
import { teilwortSuche } from '../components/teilwortSuche';
import { useMaterialOrtKontext } from '../kraefte/MaterialOrtAngabe';
import { mengeText, ortText, ortVon } from '../kraefte/materialPosten';
import { uebernahmeBezeichnung, zuordenbarePosten } from './materialUebernahme';

/** Ein Posten, wie der Dialog ihn aus der Material-Query der Seite liest. */
export type ZuordnenPosten = Pick<
  EinsatzMaterial,
  | 'id'
  | 'bezeichnung'
  | 'art'
  | 'menge'
  | 'ausgegeben'
  | 'einheit_id'
  | 'einsatz_fahrzeug_id'
  | 'uhs_id'
  | 'br_id'
  | 'beendet_at'
  | 'nachforderung_id'
>;

interface ZuordnenWerte {
  posten: number;
}

export interface PostenZuordnenModalProps {
  einsatzId: number;
  /** Die Nachforderung im aktuellen Stand; `null` = zu. */
  nachforderung: Pick<Nachforderung, 'id' | 'art' | 'bezeichnung'> | null;
  /**
   * Die Absicht „als weiteren Posten“ (wie bei der Übernahme, LLH-1226 D3), festgehalten beim
   * Öffnen und nach einer 409 von der Seite.
   */
  ergaenzen: boolean;
  /**
   * Bekannte Posten der Seite; der Dialog bietet die aktiven ohne Bezug an. `undefined`: die Liste
   * lädt noch, dann sagt der Dialog das statt „kein Posten“.
   */
  material: readonly ZuordnenPosten[] | undefined;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); der Dialog bleibt dann mit dem Grund offen. */
  onZuordnen: (emId: number) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * „Erfassten Posten zuordnen …“ an einer eingetroffenen Nachforderung (LLH-1259, design.md D5):
 * ein schon von Hand erfasster Posten bekommt den Bezug, statt dass die Übernahme dieselbe
 * Lieferung ein zweites Mal anlegt. Ein Feld, die Posten mit Bezeichnung, Menge und Ort in der
 * Wortwahl der Karte. Steht im Dialog, der beim Schließen abbaut: die Orte lädt die Seite nur,
 * solange zugeordnet wird.
 */
export default function PostenZuordnenModal({
  einsatzId,
  nachforderung,
  ergaenzen,
  material,
  laeuft,
  speicherung,
  onZuordnen,
  onSchliessen,
}: PostenZuordnenModalProps) {
  const [form] = Form.useForm<ZuordnenWerte>();
  const name = nachforderung ? uebernahmeBezeichnung(nachforderung) : '';
  return (
    <ErfassungsModal<ZuordnenWerte>
      offen={nachforderung != null}
      titel={nachforderung ? `Erfassten Posten „${name}“ zuordnen` : undefined}
      form={form}
      erfassenText={ergaenzen ? 'Als weiteren Posten zuordnen' : 'Zuordnen'}
      gesperrt={
        nachforderung != null &&
        (material == null || zuordenbarePosten(nachforderung, material).length === 0)
      }
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht zugeordnet"
      speicherFehlerFallback="Zuordnen fehlgeschlagen"
      onErfassen={(w) => onZuordnen(w.posten)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {nachforderung?.bezeichnung && (
        <Typography.Paragraph type="secondary">{nachforderung.bezeichnung}</Typography.Paragraph>
      )}
      {nachforderung && (
        <PostenFeld einsatzId={einsatzId} nachforderung={nachforderung} material={material} />
      )}
    </ErfassungsModal>
  );
}

/** Die Auswahl als eigene Komponente: die Orte lädt erst der offene Dialog. */
function PostenFeld({
  einsatzId,
  nachforderung,
  material,
}: {
  einsatzId: number;
  nachforderung: Pick<Nachforderung, 'art'>;
  material: readonly ZuordnenPosten[] | undefined;
}) {
  const frei = useMemo(
    () => (material ? zuordenbarePosten(nachforderung, material) : []),
    [nachforderung, material],
  );
  const { kontext } = useMaterialOrtKontext(einsatzId, false, frei);
  const optionen = frei.map((p) => {
    const label = [p.bezeichnung, mengeText(p), ortText(ortVon(p), kontext.namen)].join(' · ');
    return { value: p.id, label, title: label };
  });
  if (material == null) {
    return (
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Posten werden geladen …
      </Typography.Paragraph>
    );
  }
  if (frei.length === 0) {
    return (
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Kein Posten ohne Nachforderung im Einsatz
      </Typography.Paragraph>
    );
  }
  return (
    <Form.Item
      label="Posten"
      name="posten"
      rules={[{ required: true, message: 'Posten wählen' }]}
      style={{ marginBottom: 0 }}
    >
      <Select<number> options={optionen} showSearch={teilwortSuche} />
    </Form.Item>
  );
}
