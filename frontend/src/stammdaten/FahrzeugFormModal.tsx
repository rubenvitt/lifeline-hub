import { App, AutoComplete, Form, Input, InputNumber, Switch } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ErfassungsModal } from '../components/Erfassung';
import { aktualisiereFahrzeug, legeFahrzeugAn, type FahrzeugEingabe } from '../api/fahrzeuge';
import type { Fahrzeug, FahrzeugVorschlaege, Staerke } from '../api/types';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  funkrufname: string;
  fahrzeugtyp?: string;
  traegerorganisation?: string;
  kennzeichen?: string;
  opta?: string;
  standort?: string;
  fms_issi?: string;
  sondersignal: boolean;
  tragenkapazitaet?: number;
  staerke?: Staerke | null;
  bemerkung?: string;
}

export default function FahrzeugFormModal({
  offen,
  fahrzeug,
  vorschlaege,
  onClose,
}: {
  offen: boolean;
  fahrzeug: Fahrzeug | null; // null = neu
  vorschlaege: FahrzeugVorschlaege;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  /**
   * VORBELEGUNG, kein Zurücksetzen (LFH-346/A6 nach dem Muster von `PersonalFormModal`).
   * Der frühere Anlegen-Zweig (`resetFields()` + `sondersignal: false`) ist weg: das
   * Zurücksetzen macht `ErfassungsModal` auf allen vier Auswegen selbst, und der
   * Vorgabewert steht als `initialValues` an der Hülle — von dort holt ihn jedes
   * `resetFields` wieder. Ein zurückgebliebener Aufrufer-Reset wäre doppelt und
   * verdeckte, ob die Hülle ihre Zusicherung überhaupt einlöst.
   */
  useEffect(() => {
    if (!offen || !fahrzeug) return;
    form.setFieldsValue({
      funkrufname: fahrzeug.funkrufname,
      fahrzeugtyp: fahrzeug.fahrzeugtyp ?? undefined,
      traegerorganisation: fahrzeug.traegerorganisation ?? undefined,
      kennzeichen: fahrzeug.kennzeichen ?? undefined,
      opta: fahrzeug.opta ?? undefined,
      standort: fahrzeug.standort ?? undefined,
      fms_issi: fahrzeug.fms_issi ?? undefined,
      sondersignal: fahrzeug.sondersignal,
      tragenkapazitaet: fahrzeug.tragenkapazitaet ?? undefined,
      staerke: fahrzeug.staerke,
      bemerkung: fahrzeug.bemerkung ?? undefined,
    });
  }, [offen, fahrzeug, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      // StaerkeEingabe liefert die Soll-Stärke bereits koerziert ("alle drei oder keiner"):
      // ein vollständiges Tripel oder null. Der Mapper splattet es nur auf die flachen Felder.
      const daten: FahrzeugEingabe = {
        funkrufname: werte.funkrufname.trim(),
        fahrzeugtyp: leerZuNull(werte.fahrzeugtyp),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        kennzeichen: leerZuNull(werte.kennzeichen),
        opta: leerZuNull(werte.opta),
        standort: leerZuNull(werte.standort),
        fms_issi: leerZuNull(werte.fms_issi),
        sondersignal: werte.sondersignal ?? false,
        tragenkapazitaet: werte.tragenkapazitaet ?? null,
        staerke_fuehrer: werte.staerke?.fuehrer ?? null,
        staerke_unterfuehrer: werte.staerke?.unterfuehrer ?? null,
        staerke_mannschaft: werte.staerke?.mannschaft ?? null,
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return fahrzeug ? aktualisiereFahrzeug(fahrzeug.id, daten) : legeFahrzeugAn(daten);
    },
    // Nur noch invalidieren: das Schliessen macht `onFertig`, das Leeren die Hülle.
    // Ein `onClose()` hier schlösse den Dialog auch beim „Speichern und nächstes" —
    // der Serienmodus wäre still wirkungslos.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() });
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeugVorschlaege() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={fahrzeug ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      initialValues={{ sondersignal: false }}
      // `serie` nur im ANLEGEN-Modus: „Speichern und nächste" ergibt beim Bearbeiten
      // eines bestehenden Fahrzeugs keinen Sinn und stünde dort als toter Knopf.
      serie={fahrzeug == null}
      // Nur, was über eine Erfassungsserie hinweg gleich bleibt. Funkrufname,
      // Kennzeichen und OPTA sind je Fahrzeug verschieden und gehören nie dazu.
      uebernahme={['traegerorganisation', 'standort']}
      // `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage BRECHEN, sonst
      // leert die Hülle die Felder trotz 422 und der Wortlaut ist weg (LFH-332).
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item
        label="Funkrufname"
        name="funkrufname"
        rules={[{ required: true, whitespace: true, message: 'Funkrufname darf nicht leer sein' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp">
        <AutoComplete
          options={vorschlaege.fahrzeugtyp.map((t) => ({ value: t }))}
          allowClear
          placeholder="z. B. LF 20, RTW"
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
        />
      </Form.Item>
      <Form.Item label="Trägerorganisation" name="traegerorganisation">
        <AutoComplete
          options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
          allowClear
          placeholder="z. B. Feuerwehr Musterstadt"
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
        />
      </Form.Item>
      <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
      <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
      <Form.Item label="Standort" name="standort">
        <AutoComplete
          options={vorschlaege.standort.map((t) => ({ value: t }))}
          allowClear
          placeholder="z. B. Wache Mitte"
          showSearch={{
            filterOption: (input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
          }}
        />
      </Form.Item>
      <Form.Item label="FMS-ISSI" name="fms_issi"><Input /></Form.Item>
      <Form.Item label="Sonder-/Wegerecht" name="sondersignal" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="Tragenkapazität" name="tragenkapazitaet">
        <InputNumber min={0} style={{ width: '100%', maxWidth: 160 }} />
      </Form.Item>
      <Form.Item label="Soll-Stärke (alle drei oder keiner)" name="staerke">
        <StaerkeEingabe />
      </Form.Item>
      <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
    </ErfassungsModal>
  );
}
