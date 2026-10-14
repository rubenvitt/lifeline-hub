import { Form, Typography } from 'antd';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';

interface Werte {
  menge?: number;
}

export interface MaterialAufteilenModalProps {
  /** Der Posten, der aufgeteilt wird; `null` = zu. */
  posten: Pick<EinsatzMaterial, 'id' | 'bezeichnung' | 'menge'> | null;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`). */
  onAufteilen: (menge: number) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Gültige abzuteilende Menge: 1 bis Menge − 1 (die Ausgangszeile behält mindestens eins). */
function isValidMenge(n: number | undefined, menge: number): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n < menge;
}

/**
 * „Aufteilen“ (LLH-1093, design.md D8, D12; Entscheidung 13.10.2026 Nr. 4: ohne Zielort): EIN
 * Mengenfeld „Menge abteilen“ (1 bis Menge − 1), darunter das Ergebnis „Danach 30 + 20“. Die neue
 * Zeile kommt über die Invalidierung der Liste; ihren Ort ändert man danach in der Spalte „Ort“.
 * Die Grenzen prüft das Feld vor dem Senden; was der Server dennoch ablehnt, steht im Dialog.
 */
export default function MaterialAufteilenModal({
  posten,
  laeuft,
  speicherung,
  onAufteilen,
  onSchliessen,
}: MaterialAufteilenModalProps) {
  const [form] = Form.useForm<Werte>();
  const abteilen = Form.useWatch('menge', form);
  const menge = posten?.menge ?? 0;
  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? `${posten.bezeichnung} aufteilen` : undefined}
      form={form}
      erfassenText="Aufteilen"
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht aufgeteilt"
      speicherFehlerFallback="Aufteilen fehlgeschlagen"
      onErfassen={async (w) => {
        if (posten && isValidMenge(w.menge, posten.menge)) await onAufteilen(w.menge);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Menge abteilen"
        name="menge"
        rules={[
          { required: true, message: 'Menge eintragen' },
          {
            validator: (_, n: number | undefined) =>
              n == null || isValidMenge(n, menge)
                ? Promise.resolve()
                : Promise.reject(new Error(`1 bis ${menge - 1}`)),
          },
        ]}
        extra={
          isValidMenge(abteilen, menge) ? (
            <Typography.Text data-testid="aufteilen-danach">
              Danach {menge - abteilen} + {abteilen}
            </Typography.Text>
          ) : null
        }
      >
        <MengenFeld beschriftung="Menge abteilen" style={{ width: 120 }} />
      </Form.Item>
    </ErfassungsModal>
  );
}
