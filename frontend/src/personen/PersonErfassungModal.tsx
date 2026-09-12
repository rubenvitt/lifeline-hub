import { Form } from 'antd';
import { useEffect, useRef } from 'react';
import { ErfassungsModal } from '../components/Erfassung';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import AufnahmeFelder, { type AufnahmeEingabe, type AufnahmeModus } from './AufnahmeFelder';

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
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`, nicht `mutate`) — sonst leert
   * die Hülle die Felder, obwohl der Datensatz nie ankam. Der Aufrufer leitet den Folgestatus
   * aus `modus` ab.
   */
  onErfassen: (daten: AufnahmeEingabe) => Promise<unknown>;
  /** Einzel-Erfassen erfolgreich. Der Aufrufer setzt `modus` auf `null`. */
  onFertig: () => void;
  /** Abbrechen/Schließen. Der Aufrufer setzt `modus` auf `null`. */
  onCancel: () => void;
}

/**
 * Schnellerfassungs-Modal für Personen (Schnell/Vermisst/Betroffen), auf dem
 * Schnellerfassungs-Primitiv `ErfassungsModal` (LFH-332 · B4).
 *
 * Der Aufrufer (PersonenPage) hält `modus`-State und die Anlege-Mutation; dieses Modal besitzt
 * nur das Formular. **Zurückgesetzt wird nicht mehr hier** — die Hülle leert auf beiden Wegen
 * (nach dem Erfassen UND beim Abbrechen); ein zusätzlicher Reset an dieser Stelle wäre doppelt
 * und verdeckte Fehler.
 *
 * ── DIE FELDER LIEGEN NICHT MEHR HIER ──────────────────────────────
 *
 * Seit LFH-340 · C5 kommen sie aus `AufnahmeFelder` — dasselbe Bauteil trägt die
 * Aufnahme-Route (`pages/personen/AufnahmePage`). Feldbudget, Reihenfolge, das
 * Sichtungsfeld und seine Abwesenheit im Vermisst-Modus sind dort begründet und gelten für
 * beide Mounts; zwei Kopien wären zwei Stellen, an denen die Sichtung fehlen kann.
 *
 * ── KONTEXT-DEFAULT ────────────────────────────────────────────────
 *
 * `uebernahme={['antreff_ort']}`: bei eingeschaltetem B4-Schalter überlebt der Antreffort den
 * nächsten Serien-Reset. Davon getrennt merkt `erfassungsSitzung` den Ort nach erfolgreicher
 * Mutation bis zum Ende des Browser-Tabs und setzt ihn beim nächsten Öffnen genau einmal ein.
 * Der Sitzungswert wird bewusst nicht zu `initialValues`: sonst füllte jeder Serien-Reset den
 * Ort auch bei ausgeschaltetem „Werte behalten" heimlich wieder auf.
 *
 * Die SICHTUNG steht ausdrücklich NICHT in `uebernahme`: sie ist die eine Angabe, die je
 * Person neu erhoben wird. Sie stehen zu lassen hieße, die vorige Kategorie auf die nächste
 * Person zu übertragen — der teuerste denkbare Übernahmefehler an einer Aufnahme.
 */
export default function PersonErfassungModal({
  einsatzId,
  modus,
  isPending,
  onErfassen,
  onFertig,
  onCancel,
}: Props) {
  const [form] = Form.useForm<AufnahmeEingabe>();
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

  const ortMerken = (daten: AufnahmeEingabe) => {
    if (typeof daten.antreff_ort === 'string') {
      schreibeErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort', daten.antreff_ort);
    }
  };

  return (
    <ErfassungsModal<AufnahmeEingabe>
      offen={modus !== null}
      titel={modus === null ? '' : TITEL[modus]}
      form={form}
      onErfassen={onErfassen}
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
