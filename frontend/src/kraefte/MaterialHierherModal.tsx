import { Form, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { hoechsteTeilmenge, mengeText } from './materialPosten';

interface Werte {
  menge?: number;
}

type Posten = Pick<EinsatzMaterial, 'id' | 'bezeichnung' | 'art' | 'menge' | 'ausgegeben'>;

export interface MaterialHierherModalProps {
  /** Der gewählte, aufteilbare Posten; `null` = zu. */
  posten: Posten | null;
  /** Der bisherige Ort im Wortlaut der Auswahl („Staffel A“, „ohne Ort“). */
  bisherText: string;
  laeuft: boolean;
  speicherung: Speicherung;
  /**
   * Lehnt bei Ablehnung ab (`mutateAsync`). Die ganze Menge holt den Posten, eine kleinere teilt
   * ihn auf; das entscheidet der Aufrufer am Vergleich mit der Menge.
   */
  onHolen: (menge: number) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Gültig ist die ganze Menge oder eine Teilmenge von 1 bis {@link hoechsteTeilmenge}. */
function isValidMenge(n: number | undefined, p: Posten): n is number {
  if (n == null || !Number.isInteger(n)) return false;
  return n === p.menge || (n >= 1 && n <= hoechsteTeilmenge(p));
}

/**
 * „Teilmenge hierher“ als Mengenfrage beim Zuordnen am Ort (t1hvaqzu, design.md D6): wer unter
 * „Material zuordnen …“ ein aufteilbares Verbrauchsgut wählt, bestätigt hier die Menge. Vorbelegt
 * ist die ganze Menge, Enter holt also wie bisher alles; eine kleinere teilt auf und setzt den
 * abgeteilten Teil an diesen Ort, in einem Schritt. Darunter steht, was wo bleibt.
 */
export default function MaterialHierherModal({
  posten,
  bisherText,
  laeuft,
  speicherung,
  onHolen,
  onSchliessen,
}: MaterialHierherModalProps) {
  const [form] = Form.useForm<Werte>();
  const eingabe = Form.useWatch('menge', form);
  // Der Posten in einer Ref (Muster `MaterialMengeModal`): das Nachladen der Liste überschriebe
  // sonst mitten im Tippen.
  const postenRef = useRef(posten);
  useEffect(() => {
    postenRef.current = posten;
  }, [posten]);
  const offenId = posten?.id ?? null;
  useEffect(() => {
    const p = postenRef.current;
    if (offenId == null || !p) return;
    form.setFieldsValue({ menge: p.menge });
  }, [offenId, form]);
  const teil = posten != null && isValidMenge(eingabe, posten) && eingabe < posten.menge;
  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? `${posten.bezeichnung} hierher` : undefined}
      form={form}
      erfassenText="Hierher"
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht zugeordnet"
      speicherFehlerFallback="Zuordnen fehlgeschlagen"
      onErfassen={async (w) => {
        const p = postenRef.current;
        if (p && isValidMenge(w.menge, p)) await onHolen(w.menge);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {posten != null && posten.ausgegeben > 0 && (
        <Typography.Paragraph type="secondary">{mengeText(posten)}</Typography.Paragraph>
      )}
      <Form.Item
        label="Menge hierher"
        name="menge"
        rules={[
          { required: true, message: 'Menge eintragen' },
          {
            validator: (_, n: number | undefined) =>
              n == null || !posten || isValidMenge(n, posten)
                ? Promise.resolve()
                : Promise.reject(
                    new Error(`1 bis ${hoechsteTeilmenge(posten)} oder alle ${posten.menge}`),
                  ),
          },
        ]}
        extra={
          teil ? (
            <Typography.Text data-testid="hierher-danach">
              Danach hier {eingabe}, {bisherText} {posten.menge - eingabe}
            </Typography.Text>
          ) : null
        }
      >
        <MengenFeld beschriftung="Menge hierher" style={{ width: 120 }} />
      </Form.Item>
    </ErfassungsModal>
  );
}
