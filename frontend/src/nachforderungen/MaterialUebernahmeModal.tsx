import { Form, Typography } from 'antd';
import { useEffect, useMemo, useRef } from 'react';
import type { EinsatzMaterial, MaterialArt, Nachforderung } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { Select } from '../components/Select';
import { Segmentleiste } from '../components/instrument';
import { useMaterialOrtKontext } from '../kraefte/MaterialOrtAngabe';
import { buildOrtOptions } from '../kraefte/materialOrtWahl';
import { ART_OPTIONEN, OHNE_ORT_WERT } from '../kraefte/materialPosten';
import {
  uebernahmeBezeichnung,
  uebernahmeVorbelegung,
  type UebernahmeWerte,
} from './materialUebernahme';

type NachforderungImDialog = Pick<
  Nachforderung,
  'id' | 'art' | 'bezeichnung' | 'anzahl' | 'material_ids'
>;

export interface MaterialUebernahmeModalProps {
  einsatzId: number;
  /** Die Nachforderung im aktuellen Stand; `null` = zu. */
  nachforderung: NachforderungImDialog | null;
  /**
   * Die Absicht „Weiteren Posten übernehmen“ (D3), festgehalten beim Öffnen und nach einer 409 von
   * der Seite; ein Live-Abgleich ändert sie nicht.
   */
  ergaenzen: boolean;
  /** Bekannte Posten (aktive und aus dem Einsatz genommene) für den Rest der Anzahl. */
  material: readonly Pick<EinsatzMaterial, 'id' | 'menge'>[];
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); der Dialog bleibt dann mit dem Grund offen. */
  onUebernehmen: (werte: UebernahmeWerte) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Die Segmente „Art“; Gerät oder Verbrauchsgut, Wörter aus `ART_OPTIONEN` (LLH-1224 D1). */
function ArtFeld({
  value,
  onChange,
}: {
  value?: MaterialArt;
  onChange?: (a: MaterialArt) => void;
}) {
  return (
    <Segmentleiste<MaterialArt>
      beschriftung="Art"
      wert={value ?? 'geraet'}
      onWechsel={(art) => onChange?.(art)}
      optionen={ART_OPTIONEN}
    />
  );
}

/**
 * Die Ort-Auswahl der Materialliste als Formularfeld (D11, LLH-1225 D7): dieselben Optionen
 * ({@link buildOrtOptions}) aus denselben Abrufen. Steht im Dialog, der beim Schließen abbaut
 * (`destroyOnHidden`): die Orte lädt die Seite nur, solange übernommen wird.
 */
function OrtFeld({
  einsatzId,
  id,
  value,
  onChange,
}: {
  einsatzId: number;
  id?: string;
  value?: string;
  onChange?: (wert: string) => void;
}) {
  const { kontext } = useMaterialOrtKontext(einsatzId, true);
  const optionen = useMemo(() => buildOrtOptions(kontext.quellen), [kontext.quellen]);
  return (
    <Select<string>
      id={id}
      value={value}
      onChange={(v) => onChange?.(v ?? OHNE_ORT_WERT)}
      options={optionen}
    />
  );
}

/**
 * „Als Material übernehmen“ an einer eingetroffenen Nachforderung (LLH-1226, design.md D10) auf
 * der Erfassungs-Hülle. Drei Felder (Feldbudget Modal): Art, Menge, Ort. Die Bezeichnung ist die
 * Art der Nachforderung und steht im Titel, der Bedarf als Text darunter; korrigiert wird sie
 * danach über „Angaben ändern“ an der Materialzeile (LLH-1093 D6). Kein Serienmodus.
 *
 * Vorbelegt wird beim Öffnen und beim Wechsel der Absicht (409 → „Weiteren Posten übernehmen“ mit
 * neu gerechneter Menge), nie bei einem Live-Abgleich: der überschriebe mitten im Tippen.
 */
export default function MaterialUebernahmeModal({
  einsatzId,
  nachforderung,
  ergaenzen,
  material,
  laeuft,
  speicherung,
  onUebernehmen,
  onSchliessen,
}: MaterialUebernahmeModalProps) {
  const [form] = Form.useForm<UebernahmeWerte>();
  // Stand in einer Ref: der Vorbeleg-Effekt hängt nur an Öffnen und Absicht (Muster
  // `MaterialAngabenModal`).
  const stand = useRef({ nachforderung, material });
  useEffect(() => {
    stand.current = { nachforderung, material };
  }, [nachforderung, material]);
  const offenId = nachforderung?.id ?? null;
  useEffect(() => {
    const n = stand.current.nachforderung;
    if (offenId == null || !n) return;
    const { art, menge, ort } = uebernahmeVorbelegung(n, stand.current.material);
    form.setFieldsValue({ art, menge, ort });
  }, [offenId, ergaenzen, form]);

  // Ein Gerät steht je Stück im Einsatz (LLH-1224 D2): Menge fest 1, Feld gesperrt.
  const art = Form.useWatch('art', form);
  const isGeraet = art === 'geraet';
  useEffect(() => {
    if (isGeraet) form.setFieldValue('menge', 1);
  }, [isGeraet, form]);

  const name = nachforderung ? uebernahmeBezeichnung(nachforderung) : '';
  return (
    <ErfassungsModal<UebernahmeWerte>
      offen={nachforderung != null}
      titel={
        nachforderung
          ? ergaenzen
            ? `Weiteren Posten „${name}“ übernehmen`
            : `„${name}“ als Material übernehmen`
          : undefined
      }
      form={form}
      erfassenText={ergaenzen ? 'Weiteren Posten übernehmen' : 'Übernehmen'}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht übernommen"
      speicherFehlerFallback="Übernehmen fehlgeschlagen"
      onErfassen={(w) => onUebernehmen(w)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {nachforderung && (
        <Typography.Paragraph type="secondary">{nachforderung.bezeichnung}</Typography.Paragraph>
      )}
      <Form.Item label="Art" name="art">
        <ArtFeld />
      </Form.Item>
      <Form.Item
        label="Menge"
        name="menge"
        rules={[{ required: true }]}
        extra={isGeraet ? 'Ein Gerät steht je Stück im Einsatz' : undefined}
      >
        <MengenFeld beschriftung="Menge" style={{ width: 120 }} disabled={isGeraet} />
      </Form.Item>
      <Form.Item label="Ort" name="ort" style={{ marginBottom: 0 }}>
        <OrtFeld einsatzId={einsatzId} />
      </Form.Item>
    </ErfassungsModal>
  );
}
