import { Form, Typography } from 'antd';
import { useState } from 'react';
import type { EinsatzMaterial } from '../api/types';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import { restText } from './materialPosten';

interface Werte {
  menge?: number;
}

export type AusgabeModus = 'ausgeben' | 'zuruecknehmen';

type Posten = Pick<EinsatzMaterial, 'id' | 'bezeichnung' | 'menge' | 'ausgegeben'>;

export interface MaterialAusgabeModalProps {
  /** Das Verbrauchsgut; `null` = zu. */
  posten: Posten | null;
  modus: AusgabeModus;
  laeuft: boolean;
  speicherung: Speicherung;
  /**
   * Neuer Gesamtwert der Ausgabe (LLH-1224 D4: absolut) und die eingetragene Menge (für den Toast).
   * Lehnt bei Ablehnung ab.
   */
  onSpeichern: (ausgegeben: number, menge: number) => Promise<unknown>;
  onSchliessen: () => void;
}

const WORT: Record<
  AusgabeModus,
  { titel: (b: string) => string; feld: string; knopf: string; vorzeichen: 1 | -1 }
> = {
  ausgeben: {
    titel: (b) => `${b} ausgeben`,
    feld: 'Menge ausgeben',
    knopf: 'Ausgeben',
    vorzeichen: 1,
  },
  zuruecknehmen: {
    titel: (b) => `Ausgabe von ${b} zurücknehmen`,
    feld: 'Menge zurücknehmen',
    knopf: 'Zurücknehmen',
    vorzeichen: -1,
  },
};

/** Höchste Menge: beim Ausgeben der Rest, beim Zurücknehmen die Ausgabe. */
function hoechsteMenge(p: Posten, modus: AusgabeModus): number {
  return modus === 'ausgeben' ? p.menge - p.ausgegeben : p.ausgegeben;
}

function isValidMenge(n: number | undefined, hoechste: number): n is number {
  return n != null && Number.isInteger(n) && n >= 1 && n <= hoechste;
}

/**
 * „Ausgeben“ und „Ausgabe zurücknehmen …“ eines Verbrauchsguts (LLH-1225, design.md D5) auf der
 * Erfassungs-Hülle: EIN Mengenfeld (1 bis Rest bzw. 1 bis Ausgabe), darunter der Zustand danach
 * („Danach 20 von 50 übrig“). Man zählt, was rausgeht („20 Decken“), nicht den neuen Stand.
 *
 * Gerechnet und gesendet wird mit dem STAND BEIM ÖFFNEN (`ausgegeben = Stand ± n`, absolut, 1224
 * D4): ändert ein anderer Platz die Ausgabe, während der Dialog offen ist, sieht die Person weiter
 * die Zahlen, auf die sie sich bezieht; das ETB nennt beide Einträge (Risiko im design.md, CAS ist
 * Folgeaufgabe aus 1224). Keine Rückfrage: der Rückweg ist der andere Modus.
 */
export default function MaterialAusgabeModal({
  posten,
  modus,
  laeuft,
  speicherung,
  onSpeichern,
  onSchliessen,
}: MaterialAusgabeModalProps) {
  const [form] = Form.useForm<Werte>();
  const n = Form.useWatch('menge', form);
  // Stand beim Öffnen als abgeleiteter Zustand: gesetzt, wenn ein (anderer) Posten öffnet,
  // geleert beim Schließen; spätere Stände desselben Postens ändern ihn nicht.
  const [stand, setStand] = useState<Posten | null>(null);
  if (posten == null && stand != null) setStand(null);
  else if (posten != null && stand?.id !== posten.id) setStand(posten);
  const basis = stand?.id === posten?.id ? stand : posten;
  const wort = WORT[modus];
  const hoechste = basis ? hoechsteMenge(basis, modus) : 0;
  return (
    <ErfassungsModal<Werte>
      offen={posten != null}
      titel={posten ? wort.titel(posten.bezeichnung) : undefined}
      form={form}
      erfassenText={wort.knopf}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht gespeichert"
      speicherFehlerFallback="Speichern fehlgeschlagen"
      onErfassen={async (w) => {
        if (basis && isValidMenge(w.menge, hoechste)) {
          await onSpeichern(basis.ausgegeben + wort.vorzeichen * w.menge, w.menge);
        }
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label={wort.feld}
        name="menge"
        rules={[
          { required: true, message: 'Menge eintragen' },
          {
            validator: (_, v: number | undefined) =>
              v == null || isValidMenge(v, hoechste)
                ? Promise.resolve()
                : Promise.reject(new Error(`1 bis ${hoechste}`)),
          },
        ]}
        extra={
          basis && isValidMenge(n, hoechste) ? (
            <Typography.Text data-testid="ausgabe-danach">
              Danach{' '}
              {restText({ menge: basis.menge, ausgegeben: basis.ausgegeben + wort.vorzeichen * n })}
            </Typography.Text>
          ) : null
        }
      >
        <MengenFeld beschriftung={wort.feld} style={{ width: 120 }} />
      </Form.Item>
    </ErfassungsModal>
  );
}
