import { Form, Typography } from 'antd';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { mengeText } from './materialPosten';

interface Werte {
  menge?: number;
}

export interface MaterialAufteilenModalProps {
  /** Der Posten, der aufgeteilt wird; `null` = zu. */
  posten: Pick<EinsatzMaterial, 'id' | 'bezeichnung' | 'menge' | 'ausgegeben'> | null;
  laeuft: boolean;
  speicherung: Speicherung;
  /** Lehnt bei Ablehnung ab (`mutateAsync`). */
  onAufteilen: (menge: number) => Promise<unknown>;
  onSchliessen: () => void;
}

/**
 * Höchste abzuteilende Menge: die Ausgangszeile behält mindestens eins, und abgeteilt wird nur aus
 * dem Rest (LLH-1224 D14: Ausgegebenes bleibt an der Ausgangszeile).
 */
function hoechsteMenge(p: { menge: number; ausgegeben: number }): number {
  return Math.min(p.menge - 1, p.menge - p.ausgegeben);
}

/** Gültige abzuteilende Menge: 1 bis {@link hoechsteMenge}. */
function isValidMenge(n: number | undefined, hoechste: number): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= hoechste;
}

/**
 * „Aufteilen“ (LLH-1093, design.md D8, D12; Entscheidung 13.10.2026 Nr. 4: ohne Zielort): EIN
 * Mengenfeld „Menge abteilen“ (1 bis Menge − 1, höchstens der Rest), darunter das Ergebnis „Danach 30 + 20“. Die neue
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
  const hoechste = posten ? hoechsteMenge(posten) : 0;
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
        if (posten && isValidMenge(w.menge, hoechste)) await onAufteilen(w.menge);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {posten != null && posten.ausgegeben > 0 && (
        <Typography.Paragraph type="secondary">
          {/* Aufteilen gibt es nur für Verbrauchsgut; ein Gerät sperrt das Zeilenmenü. */}
          {mengeText({ art: 'verbrauchsgut', menge, ausgegeben: posten.ausgegeben })}
        </Typography.Paragraph>
      )}
      <Form.Item
        label="Menge abteilen"
        name="menge"
        rules={[
          { required: true, message: 'Menge eintragen' },
          {
            validator: (_, n: number | undefined) =>
              n == null || isValidMenge(n, hoechste)
                ? Promise.resolve()
                : Promise.reject(new Error(`1 bis ${hoechste}`)),
          },
        ]}
        extra={
          isValidMenge(abteilen, hoechste) ? (
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
