import { Form, Typography } from 'antd';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { Select } from '../components/Select';
import type { buildOrtOptions } from './materialOrtWahl';
import {
  hoechsteTeilmenge,
  mengeText,
  ortVon,
  parseOrtValue,
  toOrtValue,
  type MaterialOrtRef,
} from './materialPosten';

interface Werte {
  menge?: number;
  /** Ort des abgeteilten Teils als Auswahlwert ({@link toOrtValue}). */
  ort?: string;
}

export interface MaterialAufteilenModalProps {
  /** Der Posten, der aufgeteilt wird; `null` = zu. */
  posten: Pick<
    EinsatzMaterial,
    | 'id'
    | 'bezeichnung'
    | 'menge'
    | 'ausgegeben'
    | 'einheit_id'
    | 'einsatz_fahrzeug_id'
    | 'uhs_id'
    | 'br_id'
  > | null;
  /**
   * Angebot des Felds „Ort“ (`buildOrtOptions` mit dem Ort des Postens als `aktuell`), dieselben
   * Gruppen wie die Spalte „Ort“.
   */
  ortOptionen: ReturnType<typeof buildOrtOptions>;
  laeuft: boolean;
  speicherung: Speicherung;
  /**
   * Lehnt bei Ablehnung ab (`mutateAsync`). `ziel` ist der gewählte Ort des abgeteilten Teils,
   * `null` = ohne Ort; die Felder baut `useMaterialOrt().teileAufNach`.
   */
  onAufteilen: (menge: number, ziel: MaterialOrtRef | null) => Promise<unknown>;
  onSchliessen: () => void;
}

/** Gültige abzuteilende Menge: 1 bis {@link hoechsteTeilmenge}. */
function isValidMenge(n: number | undefined, hoechste: number): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= hoechste;
}

/**
 * „Aufteilen“ (LLH-1093, design.md D8, D12): EIN Mengenfeld „Menge abteilen“ (1 bis Menge − 1,
 * höchstens der Rest), darunter das Ergebnis „Danach 30 + 20“, und das Feld „Ort“ für den
 * abgeteilten Teil, vorbelegt mit dem Ort des Postens (t1hvaqzu, design.md D5; löst die
 * Entscheidung vom 13.10.2026 Nr. 4 „ohne Zielort“ ab). Ein anderer Ort geht im selben Request
 * mit, Aufteilen und Ortswechsel sind ein ETB-Eintrag. Die Grenzen prüft das Feld vor dem Senden;
 * was der Server dennoch ablehnt (auch ein nicht mehr wählbares Ziel), steht im Dialog.
 */
export default function MaterialAufteilenModal({
  posten,
  ortOptionen,
  laeuft,
  speicherung,
  onAufteilen,
  onSchliessen,
}: MaterialAufteilenModalProps) {
  const [form] = Form.useForm<Werte>();
  const abteilen = Form.useWatch('menge', form);
  const menge = posten?.menge ?? 0;
  const hoechste = posten ? hoechsteTeilmenge({ ...posten, art: 'verbrauchsgut' }) : 0;
  const bisher = posten ? ortVon(posten) : null;
  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? `${posten.bezeichnung} aufteilen` : undefined}
      form={form}
      erfassenText="Aufteilen"
      initialValues={{ ort: toOrtValue(bisher) }}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht aufgeteilt"
      speicherFehlerFallback="Aufteilen fehlgeschlagen"
      onErfassen={async (w) => {
        if (!posten || !isValidMenge(w.menge, hoechste)) return;
        const ziel = w.ort == null ? undefined : parseOrtValue(w.ort);
        await onAufteilen(w.menge, ziel === undefined ? bisher : ziel);
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
      <Form.Item label="Ort" name="ort" extra="Ort des abgeteilten Teils">
        <Select<string> options={ortOptionen} popupMatchSelectWidth={false} />
      </Form.Item>
    </ErfassungsModal>
  );
}
