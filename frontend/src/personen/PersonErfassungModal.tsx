import { Form } from 'antd';
import { useEffect, useRef } from 'react';
import { ErfassungsModal } from '../components/Erfassung';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import AufnahmeFelder, {
  aufnahmeZuEingabe,
  type AufnahmeEingabe,
  type AufnahmeModus,
  type AufnahmeWerte,
} from './AufnahmeFelder';

/** Erfassungs-Modi der Personen-Schnellerfassung. `null` = Modal geschlossen. */
export type ErfassungsModus = AufnahmeModus;

const TITEL: Record<ErfassungsModus, string> = {
  schnell: 'Schnellerfassung',
  vermisst: 'Vermisst melden',
  betroffen: 'Betroffene/n erfassen',
};

interface Props {
  /** Einsatzgrenze des sitzungsweiten Antrefforts. */
  einsatzId: number;
  /** Aktueller Modus (steuert Titel, Sichtungsfeld und Melder-Feld); `null` schließt das Modal. */
  modus: ErfassungsModus | null;
  /** Läuft die Anlege-Mutation? → beide Speicher-Knöpfe zeigen Ladeanzeige. */
  isPending: boolean;
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`) — sonst leert die Hülle die
   * Felder, obwohl nichts ankam. Den Folgestatus leitet der Aufrufer aus `modus` ab.
   */
  onErfassen: (daten: AufnahmeEingabe) => Promise<unknown>;
  /** Einzel-Erfassen erfolgreich. Der Aufrufer setzt `modus` auf `null`. */
  onFertig: () => void;
  /** Abbrechen/Schließen. Der Aufrufer setzt `modus` auf `null`. */
  onCancel: () => void;
}

/**
 * Schnellerfassungs-Modal für Personen (Schnell/Vermisst/Betroffen) auf `ErfassungsModal`.
 * Der Aufrufer hält `modus` und die Anlege-Mutation, das Modal nur das Formular; zurückgesetzt
 * wird von der Hülle. Die Felder kommen aus `AufnahmeFelder` (dort begründet).
 *
 * `uebernahme={['antreff_ort']}`: bei „Werte behalten" überlebt der Antreffort den
 * Serien-Reset. Davon getrennt merkt `erfassungsSitzung` den Ort bis Tab-Ende und setzt ihn beim
 * nächsten Öffnen einmal ein — bewusst nicht als `initialValues`, sonst füllte jeder Reset ihn
 * auch bei ausgeschaltetem Schalter wieder auf.
 *
 * Die SICHTUNG steht NICHT in `uebernahme`: sie wird je Person neu erhoben; die vorige Kategorie
 * zu übertragen wäre der teuerste denkbare Übernahmefehler.
 */
export default function PersonErfassungModal({
  einsatzId,
  modus,
  isPending,
  onErfassen,
  onFertig,
  onCancel,
}: Props) {
  const [form] = Form.useForm<AufnahmeWerte>();
  const geladeneOeffnung = useRef<string | null>(null);

  useEffect(() => {
    const oeffnung = modus === null ? null : `${einsatzId}:person`;
    if (oeffnung === null) {
      geladeneOeffnung.current = null;
      return;
    }
    if (geladeneOeffnung.current === oeffnung) return;
    geladeneOeffnung.current = oeffnung;
    const ort = liesErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort');
    if (ort !== undefined) form.setFieldValue('antreff_ort', ort);
  }, [einsatzId, form, modus]);

  const ortMerken = (daten: AufnahmeWerte) => {
    if (typeof daten.antreff_ort === 'string') {
      schreibeErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort', daten.antreff_ort);
    }
  };

  return (
    <ErfassungsModal<AufnahmeWerte>
      offen={modus !== null}
      titel={modus === null ? '' : TITEL[modus]}
      form={form}
      // Die Koordinate ist im Formular EIN Textfeld; zerlegt wird hier (dieselbe Funktion wie an der
      // Aufnahme-Route).
      onErfassen={(werte) => onErfassen(aufnahmeZuEingabe(werte))}
      onErfasst={ortMerken}
      onFertig={onFertig}
      onAbbrechen={onCancel}
      laeuft={isPending}
      serie
      uebernahme={['antreff_ort']}
    >
      <AufnahmeFelder modus={modus ?? 'schnell'} />
    </ErfassungsModal>
  );
}
