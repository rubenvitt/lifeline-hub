import { Collapse, Form, Input, InputNumber } from 'antd';
import { useEffect, useRef } from 'react';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import type { PersonEingabe } from '../api/einsatzPerson';

/** Erfassungs-Modi der Personen-Schnellerfassung. `null` = Modal geschlossen. */
export type ErfassungsModus = 'schnell' | 'vermisst' | 'betroffen';

const TITEL: Record<ErfassungsModus, string> = {
  schnell: 'Schnellerfassung',
  vermisst: 'Vermisst melden',
  betroffen: 'Betroffene/n erfassen',
};

interface Props {
  /** Einsatzgrenze des sitzungsweiten Antrefforts. */
  einsatzId: number;
  /** Aktueller Modus (steuert Titel + optionales Vermisst-Feld); `null` schließt das Modal. */
  modus: ErfassungsModus | null;
  /** Läuft die Anlege-Mutation? → beide Speicher-Knöpfe zeigen Ladeanzeige. */
  isPending: boolean;
  /**
   * Speichern. **Muss bei Ablehnung ablehnen** (`mutateAsync`, nicht `mutate`) — sonst leert
   * die Hülle die Felder, obwohl der Datensatz nie ankam. Der Aufrufer leitet den Folgestatus
   * aus `modus` ab.
   */
  onErfassen: (daten: PersonEingabe) => Promise<unknown>;
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
 * ── FELDBUDGET: VIER SICHTBARE FELDER ──────────────────────────────
 *
 * Sichtbar sind Geschlecht, Geschätztes Alter, Antreffort, Name — in dieser Reihenfolge, weil
 * das die Reihenfolge ist, in der an der Aufnahme gesprochen wird. Vorname, Notiz und (nur im
 * Vermisst-Modus) Melder/Kontakt liegen eingeklappt unter „Weitere Angaben". Pflichtfelder gibt
 * es weiterhin keine: eine Person, von der man nichts weiß, muss trotzdem erfassbar sein.
 *
 * **Kein `forceRender` am Panel — gemessen, nicht angenommen.** Der naheliegende Verdacht ist,
 * dass eingeklappte Felder beim Absenden fehlen. Das trifft hier nicht zu, aus zwei
 * unabhängigen Gründen: (1) antds Collapse hängt den Inhalt nach dem ersten Aufklappen NICHT
 * wieder ab (`destroyOnHidden` ist aus), das Feld bleibt also samt Wert registriert; (2) selbst
 * wenn es ihn abhinge, hält antds Form-Speicher den Wert (`preserve` ist an). Ein Feld, das nie
 * aufgeklappt war, kann umgekehrt gar keinen Wert tragen. `forceRender` hätte den Preis, dass
 * die drei Zusatzfelder von Anfang an im Baum stehen — womit „vier sichtbare Felder" nur noch
 * über gerechnete CSS-Sichtbarkeit prüfbar wäre statt über die Anwesenheit im Baum. Der Beleg
 * für (1)/(2) steht als eigener Fall in `PersonErfassungModal.test.tsx`.
 *
 * ── KONTEXT-DEFAULT ────────────────────────────────────────────────
 *
 * `uebernahme={['antreff_ort']}`: bei eingeschaltetem B4-Schalter überlebt der Antreffort den
 * nächsten Serien-Reset. Davon getrennt merkt `erfassungsSitzung` den Ort nach erfolgreicher
 * Mutation bis zum Ende des Browser-Tabs und setzt ihn beim nächsten Öffnen genau einmal ein.
 * Der Sitzungswert wird bewusst nicht zu `initialValues`: sonst füllte jeder Serien-Reset den Ort
 * auch bei ausgeschaltetem „Werte behalten" heimlich wieder auf.
 */
export default function PersonErfassungModal({
  einsatzId, modus, isPending, onErfassen, onFertig, onCancel,
}: Props) {
  const [form] = Form.useForm<PersonEingabe>();
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

  const ortMerken = (daten: PersonEingabe) => {
    if (typeof daten.antreff_ort === 'string') {
      schreibeErfassungsSitzungswert(einsatzId, 'person', 'antreff_ort', daten.antreff_ort);
    }
  };

  const weitereAngaben = (
    <>
      <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
      {modus === 'vermisst' && (
        <Form.Item label="Melder / Kontakt" name="melder_kontakt">
          <Input placeholder="Angehöriger, Kontaktdaten" />
        </Form.Item>
      )}
      <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
    </>
  );

  return (
    <ErfassungsModal<PersonEingabe>
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
      <Form.Item label="Geschlecht" name="geschlecht">
        <Select
          allowClear
          placeholder="unbekannt"
          options={[
            { value: 'maennlich', label: 'männlich' },
            { value: 'weiblich', label: 'weiblich' },
            { value: 'divers', label: 'divers' },
            { value: 'unbekannt', label: 'unbekannt' },
          ]}
        />
      </Form.Item>
      <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt">
        <InputNumber min={0} max={120} style={{ width: 140 }} />
      </Form.Item>
      <Form.Item label="Antreffort" name="antreff_ort">
        <Input placeholder="z. B. Brücke, Sammelstelle" />
      </Form.Item>
      {/* „Name" ist bewusst das LETZTE sichtbare Eingabefeld: Enter darin sendet ab
          (Zusicherung 1 der Hülle), und der Name ist das, was zuletzt gefragt wird. */}
      <Form.Item label="Name" name="name"><Input /></Form.Item>
      <Collapse
        ghost
        items={[{ key: 'weitere', label: 'Weitere Angaben', children: weitereAngaben }]}
      />
    </ErfassungsModal>
  );
}
