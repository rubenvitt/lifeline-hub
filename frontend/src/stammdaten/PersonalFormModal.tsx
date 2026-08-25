import { App, AutoComplete, Form, Input } from 'antd';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisierePerson, legePersonAn, POSITION_OPTIONEN, type PersonalEingabe } from '../api/personal';
import { listeQualifikationen } from '../api/qualifikationen';
import { listeBenutzer } from '../api/benutzer';
import type { Personal, PersonalVorschlaege, StaerkePosition } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';

interface FormWerte {
  name: string;
  personalnummer?: string;
  traegerorganisation?: string;
  telefon?: string;
  staerke_position?: StaerkePosition;
  qualifikation_ids: number[];
  benutzer_id?: number;
  bemerkung?: string;
}

export default function PersonalFormModal({
  offen,
  person,
  vorschlaege,
  onClose,
}: {
  offen: boolean;
  person: Personal | null; // null = neu
  vorschlaege: PersonalVorschlaege;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const qualQuery = useQuery({ queryKey: globalKeys.qualifikationen(), queryFn: listeQualifikationen });
  const benutzerQuery = useQuery({ queryKey: globalKeys.benutzer(), queryFn: listeBenutzer });

  /**
   * VORBELEGUNG, kein Zurücksetzen (LFH-332/B4, Regel 3). Der Anlegen-Zweig, der
   * früher hier `resetFields()` + den Leerwert für `qualifikation_ids` setzte, ist
   * weg: das Zurücksetzen macht `ErfassungsModal` auf BEIDEN Wegen (nach dem
   * Speichern und beim Abbrechen), und der Leerwert steht jetzt als `initialValues`
   * an der Hülle — von dort holt ihn jedes `resetFields` wieder. Ein
   * zurückgebliebener Aufrufer-Reset wäre doppelt und würde verdecken, ob die Hülle
   * ihre Zusicherung überhaupt einlöst.
   */
  useEffect(() => {
    if (!offen || !person) return;
    form.setFieldsValue({
      name: person.name,
      personalnummer: person.personalnummer ?? undefined,
      traegerorganisation: person.traegerorganisation ?? undefined,
      telefon: person.telefon ?? undefined,
      staerke_position: person.staerke_position ?? undefined,
      qualifikation_ids: person.qualifikationen.map((q) => q.id),
      benutzer_id: person.benutzer_id ?? undefined,
      bemerkung: person.bemerkung ?? undefined,
    });
  }, [offen, person, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: PersonalEingabe = {
        name: werte.name.trim(),
        benutzer_id: werte.benutzer_id ?? null,
        personalnummer: leerZuNull(werte.personalnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        telefon: leerZuNull(werte.telefon),
        staerke_position: werte.staerke_position ?? null,
        bemerkung: leerZuNull(werte.bemerkung),
        qualifikation_ids: werte.qualifikation_ids ?? [],
      };
      return person ? aktualisierePerson(person.id, daten) : legePersonAn(daten);
    },
    // Nur noch invalidieren: das Schliessen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.personal() });
      qc.invalidateQueries({ queryKey: globalKeys.personalVorschlaege() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  // Aktive Qualifikationen + bereits zugeordnete (auch deaktivierte) als Optionen,
  // damit eine deaktivierte Zuordnung sichtbar/erhaltbar bleibt.
  const aktive = qualQuery.data ?? [];
  const zugeordnete = person?.qualifikationen ?? [];
  const qualOptionen = [
    ...aktive.map((q) => ({ value: q.id, label: q.label })),
    ...zugeordnete
      .filter((z) => !aktive.some((a) => a.id === z.id))
      .map((z) => ({ value: z.id, label: `${z.label} (deaktiviert)` })),
  ];

  const benutzerOptionen = (benutzerQuery.data ?? []).map((b) => ({
    value: b.id,
    label: `${b.anzeigename} (${b.benutzername})`,
  }));

  /*
   * HÜLLEN-PILOT, kein Feldbudget-Ziel (LFH-332/B4). Diese Maske trägt acht Felder
   * und liegt damit weit über der Modal-Leitlinie aus LFH-19 (≤ ~3 Felder). Das ist
   * bekannt und hier bewusst NICHT angefasst: umgestellt wird die Hülle
   * (Enter-Absenden, Fokus, symmetrisches Zurücksetzen), nicht der Feldbestand.
   * `serie` stand hier zunächst bewusst NICHT, weil die Maske auch dem Bearbeiten
   * einer bestehenden Person dient und „Speichern und nächste" dort ein toter Knopf
   * wäre. Dieser Einwand ist mit der Modus-Bedingung erledigt (LFH-346/A6):
   * `serie={person == null}` zeigt den Serienweg genau im Anlegen-Fall — dem, in dem
   * eine Einheit ihr Personal am Stück erfasst. `uebernahme` trägt nur, was über eine
   * Serie hinweg gleich bleibt: die Trägerorganisation, nie Name oder Personalnummer.
   */
  return (
    <ErfassungsModal<FormWerte>
      offen={offen}
      titel={person ? 'Person bearbeiten' : 'Person anlegen'}
      form={form}
      erfassenText="Speichern"
      laeuft={mutation.isPending}
      initialValues={{ qualifikation_ids: [] }}
      serie={person == null}
      uebernahme={['traegerorganisation']}
      onErfassen={(w) => mutation.mutateAsync(w)}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}>
        <Input />
      </Form.Item>
      <Form.Item label="Personalnummer" name="personalnummer"><Input /></Form.Item>
      <Form.Item label="Trägerorganisation" name="traegerorganisation">
        <AutoComplete
          options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
          allowClear
          placeholder="z. B. DRK Musterstadt"
          showSearch={{ filterOption: (input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase()) }}
        />
      </Form.Item>
      <Form.Item label="Telefon" name="telefon"><Input /></Form.Item>
      <Form.Item label="Stärke-Position" name="staerke_position">
        <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
      </Form.Item>
      <Form.Item label="Qualifikationen" name="qualifikation_ids">
        <Select mode="multiple" allowClear options={qualOptionen} placeholder="Qualifikationen wählen" />
      </Form.Item>
      <Form.Item label="Benutzer-Konto (optional)" name="benutzer_id">
        <Select allowClear options={benutzerOptionen} placeholder="kein Konto verknüpft" />
      </Form.Item>
      <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
    </ErfassungsModal>
  );
}
