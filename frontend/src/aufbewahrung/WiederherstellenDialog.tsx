import { App, DatePicker, Form, Switch } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { stelleWiederHer } from '../api/aufbewahrung';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { WiederherstellenBody } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { alsBackendZeit } from '../etb/filterZeit';

/**
 * „Wiederherstellen" während der Karenz (LFH-23, design.md D5/D8) als `ErfassungsModal`.
 *
 * Die neue Frist ist PFLICHT: ohne sie stünde `retention_bis` weiter in der Vergangenheit, und
 * der nächste Purge-Lauf merkte den Einsatz sofort wieder vor. Zwei Felder — der Zeitpunkt und
 * „unbegrenzt" (Schalter, Vorgabe AUS: ein Schalter, der von selbst ansteht, ist benutzt
 * worden, ohne gewählt worden zu sein). Ist er an, geht `null` hinaus, der Zeitpunkt ist dann
 * gesperrt und wird nicht verlangt.
 *
 * **Keine `danger`-Rückfrage:** Wiederherstellen ist umkehrbar (die neue Frist lässt sich
 * wieder ändern) und hebt eine Sperre auf, statt sie zu setzen (LFH-363).
 *
 * **Fehler im Dialog, nicht im Toast (Muster `FreigabeDialog`, LFH-535):** die Mutation hat
 * kein `onError`, `mutateAsync` lehnt ab, die Hülle lässt die Felder stehen. 409 (Karenz
 * abgelaufen oder geschwärzt) und 422 (Frist nicht in der Zukunft) erscheinen mit dem
 * Wortlaut des Servers. Montiert = offen: jede Öffnung hat eine frische Mutation ohne alten
 * Fehler.
 */

interface WiederherstellenWerte {
  frist?: Dayjs | null;
  unbegrenzt?: boolean;
}

const FRIST_VERGANGEN = 'Die neue Frist muss in der Zukunft liegen';

/** Reiner Body-Bau — ohne Render prüfbar. */
export function wiederherstellenBody(werte: WiederherstellenWerte): WiederherstellenBody {
  if (werte.unbegrenzt) return { retention_bis: null };
  if (!werte.frist) throw new Error('Frist fehlt');
  return { retention_bis: alsBackendZeit(werte.frist) };
}

interface WiederherstellenDialogProps {
  einsatzId: number;
  /** Anzeigename des Einsatzes im Titel (Einsatznummer oder Bezeichnung). */
  einsatzLabel: string;
  onSchliessen: () => void;
}

export default function WiederherstellenDialog({
  einsatzId,
  einsatzLabel,
  onSchliessen,
}: WiederherstellenDialogProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<WiederherstellenWerte>();
  const unbegrenzt = Form.useWatch('unbegrenzt', form) === true;

  const mutation = useMutation({
    mutationFn: (body: WiederherstellenBody) => stelleWiederHer(einsatzId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() });
      void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Einsatz wiederhergestellt');
    },
  });

  return (
    <ErfassungsModal<WiederherstellenWerte>
      offen
      titel={`${einsatzLabel} wiederherstellen`}
      form={form}
      initialValues={{ frist: null, unbegrenzt: false }}
      erfassenText="Wiederherstellen"
      laeuft={mutation.isPending}
      onErfassen={async (werte) => {
        await mutation.mutateAsync(wiederherstellenBody(werte));
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Neue Aufbewahrungsfrist"
        name="frist"
        extra="Die Löschvormerkung wird aufgehoben; ab dieser Frist beginnt die Aufbewahrung von vorn."
        rules={[
          {
            validator: (_, wert: Dayjs | null | undefined) => {
              if (form.getFieldValue('unbegrenzt')) return Promise.resolve();
              if (!wert) return Promise.reject(new Error('Zeitpunkt wählen oder „unbegrenzt“'));
              return wert.isAfter(dayjs())
                ? Promise.resolve()
                : Promise.reject(new Error(FRIST_VERGANGEN));
            },
          },
        ]}
        dependencies={['unbegrenzt']}
      >
        <DatePicker
          showTime
          format="YYYY-MM-DD HH:mm"
          disabled={unbegrenzt}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="Unbegrenzt aufbewahren" name="unbegrenzt" valuePropName="checked">
        <Switch />
      </Form.Item>
      <SpeicherFehler fehler={mutation.error} titel="Wiederherstellen fehlgeschlagen" />
    </ErfassungsModal>
  );
}
