import { Form } from 'antd';
import { useEffect, useRef } from 'react';
import type { MaterialPatch } from '../api/einsatzMaterial';
import type { EinsatzMaterial, MaterialArt } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { Segmentleiste } from '../components/instrument';
import { MengenFeld } from '../components/MengenFeld';
import { materialStatus } from '../theme/statusFarben';
import { ART_OPTIONEN, materialStatusOptionen } from './materialPosten';

interface Werte {
  art: MaterialArt;
  menge?: number;
}

type Posten = Pick<
  EinsatzMaterial,
  'id' | 'bezeichnung' | 'art' | 'menge' | 'ausgegeben' | 'status'
>;

/** Wie der Server (LLH-1224 D2) und der Disponier-Dialog: ein Gerät steht je Stück im Einsatz. */
export const GERAET_JE_STUECK = 'Ein Gerät steht je Stück im Einsatz';

/**
 * Nur was sich ändert (LLH-1224 D10): Art und Menge gehen in EINEM PATCH, damit die Zeile nie
 * zwischen zwei Prüfungen steht (Verbrauchsgut mit Menge 1 → Gerät, Gerät → Verbrauchsgut mit 40).
 * Ein Gerät hat immer Menge 1.
 */
export function buildArtPatch(vorher: Posten, w: Werte): MaterialPatch {
  const patch: MaterialPatch = {};
  const menge = w.art === 'geraet' ? 1 : (w.menge ?? vorher.menge);
  if (w.art !== vorher.art) patch.art = w.art;
  if (menge !== vorher.menge) patch.menge = menge;
  return patch;
}

/**
 * Gesperrte Arten mit Grund, aus denselben Regeln wie der Server (D2, D3): zum Gerät nicht mit
 * Ausgabe, zum Verbrauchsgut nicht mit einem Status, den nur ein Gerät kennt.
 */
function artOptionen(p: Posten | null) {
  return ART_OPTIONEN.map((o) => {
    if (!p || o.wert === p.art) return o;
    if (o.wert === 'geraet' && p.ausgegeben > 0) {
      return { ...o, gesperrt: `${p.ausgegeben} ausgegeben` };
    }
    if (o.wert === 'verbrauchsgut' && !materialStatusOptionen('verbrauchsgut').includes(p.status)) {
      return { ...o, gesperrt: `Status „${materialStatus[p.status].label}“` };
    }
    return o;
  });
}

/** Die Segmentleiste als Formularfeld: `Form.Item` reicht `value`/`onChange` hinein. */
function ArtFeld({
  value,
  onChange,
  optionen,
}: {
  value?: MaterialArt;
  onChange?: (art: MaterialArt) => void;
  optionen: ReturnType<typeof artOptionen>;
}) {
  return (
    <Segmentleiste<MaterialArt>
      beschriftung="Art"
      wert={value ?? 'geraet'}
      onWechsel={(art) => onChange?.(art)}
      optionen={optionen}
    />
  );
}

export interface MaterialArtModalProps {
  /** Der Ad-hoc-Posten, dessen Art korrigiert wird; `null` = zu. */
  posten: Posten | null;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); ohne Änderung ruft der Dialog nichts. */
  onSpeichern: (patch: MaterialPatch) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * „Art ändern …“ eines Ad-hoc-Postens (LLH-1224 D10): ein Ad-hoc-Posten mit Menge 1 entsteht als
 * Gerät und brauchte sonst keinen Weg zu mehr Menge. Art als Segment, darunter die Menge; beim
 * Gerät steht sie fest auf 1. Die Menge wechselt nie still die Art — die wählt man hier.
 */
export default function MaterialArtModal({
  posten,
  laeuft,
  speicherung,
  onSpeichern,
  onSchliessen,
}: MaterialArtModalProps) {
  const [form] = Form.useForm<Werte>();
  // Der Posten in einer Ref (Muster `MaterialAngabenModal`): das Nachladen der Liste überschriebe
  // sonst mitten im Tippen.
  const postenRef = useRef(posten);
  useEffect(() => {
    postenRef.current = posten;
  }, [posten]);
  const offenId = posten?.id ?? null;
  useEffect(() => {
    const p = postenRef.current;
    if (offenId == null || !p) return;
    form.setFieldsValue({ art: p.art, menge: p.menge });
  }, [offenId, form]);

  const art = Form.useWatch('art', form);
  const isGeraet = art === 'geraet';
  useEffect(() => {
    if (isGeraet) form.setFieldValue('menge', 1);
  }, [isGeraet, form]);
  const mindestens = Math.max(1, posten?.ausgegeben ?? 0);

  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? `Art von ${posten.bezeichnung} ändern` : undefined}
      form={form}
      erfassenText="Speichern"
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht gespeichert"
      speicherFehlerFallback="Speichern fehlgeschlagen"
      onErfassen={async (w) => {
        const vorher = postenRef.current;
        if (!vorher) return;
        const patch = buildArtPatch(vorher, w);
        if (Object.keys(patch).length > 0) await onSpeichern(patch);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item label="Art" name="art">
        <ArtFeld optionen={artOptionen(posten)} />
      </Form.Item>
      <Form.Item
        label="Menge"
        name="menge"
        rules={[
          { required: true, message: 'Menge eintragen' },
          {
            validator: (_, n: number | undefined) =>
              n == null || n >= mindestens
                ? Promise.resolve()
                : Promise.reject(new Error(`mindestens ${mindestens}`)),
          },
        ]}
        extra={isGeraet ? GERAET_JE_STUECK : undefined}
      >
        <MengenFeld beschriftung="Menge" style={{ width: 120 }} disabled={isGeraet} />
      </Form.Item>
    </ErfassungsModal>
  );
}
