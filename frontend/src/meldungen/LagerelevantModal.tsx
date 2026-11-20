import { Form, Input } from 'antd';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import type { Meldung } from '../api/types';
import KoordinatenFeld from '../anzeige/KoordinatenFeld';
import { alsLatLon, type KoordinatenWert } from '../anzeige/koordinatenWert';
import { Feld } from '../components/instrument';

export interface LagerelevantDaten {
  text?: string;
  lat?: number;
  lon?: number;
}

interface Props {
  offen: boolean;
  meldung: Meldung | null;
  senden: boolean;
  einsatzId: number;
  onAbbrechen: () => void;
  /**
   * Übernehmen. **Muss bei Ablehnung ablehnen** (`mutateAsync`): erst der Erfolg leert den
   * Dialog, eine Ablehnung lässt die Eingaben stehen. Geschlossen wird im `onSuccess` des
   * Aufrufers.
   */
  onUebergeben: (d: LagerelevantDaten) => Promise<unknown>;
  /**
   * Die Übergabe-Mutation (LFH-1077): ihr Fehler steht im Dialog, bis zum nächsten Übergeben;
   * Öffnen und Abbrechen räumen ihn. Solange sie läuft, ist jeder Ausweg gesperrt.
   */
  speicherung?: Speicherung;
}

interface FormWerte {
  text?: string;
  koord?: KoordinatenWert;
}

/**
 * In die Lage übernehmen: optionaler Lage-Text und optionale Verortung. Ohne Koordinate bleibt
 * die Meldung ein Listen-Lageobjekt, verortet erscheint sie zusätzlich als Marker. Die Aktion
 * ist einmalig (MeldungListe blendet sie danach aus).
 *
 * Über die Erfassungshülle (LLH-2010, `frontend/AGENTS.md`, „Erfassungs-Norm“): die Maske schließt
 * nie, ein geänderter Lage-Text fragt vor dem Verwerfen. Der Meldungsinhalt ist Startwert
 * (`initialValues`), zählt also allein nicht als Änderung.
 */
export default function LagerelevantModal({
  offen,
  meldung,
  senden,
  einsatzId,
  onAbbrechen,
  onUebergeben,
  speicherung,
}: Props) {
  const [form] = Form.useForm<FormWerte>();

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel="In die Lage übernehmen"
      form={form}
      breite={460}
      initialValues={{ text: meldung?.inhalt ?? '', koord: null }}
      erfassenText="Übernehmen"
      laeuft={senden}
      speicherung={speicherung}
      speicherFehlerTitel="Nicht übernommen"
      onErfassen={(w) => {
        const text = w.text?.trim() ? w.text.trim() : undefined;
        const koord = alsLatLon(w.koord);
        return onUebergeben({ text, lat: koord?.lat, lon: koord?.lon });
      }}
      // Geschlossen hat der Aufrufer schon in seinem `onSuccess`.
      onFertig={() => {}}
      onAbbrechen={onAbbrechen}
    >
      <Feld name="text" label="Lage-Text">
        <Input.TextArea rows={3} placeholder="Kurzbeschreibung für die Lage" />
      </Feld>
      <KoordinatenFeld name="koord" label="Verortung (optional)" einsatzId={einsatzId} />
    </ErfassungsModal>
  );
}
