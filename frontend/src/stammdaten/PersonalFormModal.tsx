import { App, AutoComplete, Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisierePerson, legePersonAn, POSITION_OPTIONEN, type PersonalEingabe } from '../api/personal';
import { listeQualifikationen } from '../api/qualifikationen';
import { listeBenutzer } from '../api/benutzer';
import type { Personal, PersonalVorschlaege, StaerkePosition } from '../api/types';

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

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
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

  const qualQuery = useQuery({ queryKey: ['qualifikationen'], queryFn: listeQualifikationen });
  const benutzerQuery = useQuery({ queryKey: ['benutzer'], queryFn: listeBenutzer });

  useEffect(() => {
    if (!offen) return;
    if (person) {
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
    } else {
      form.resetFields();
      form.setFieldsValue({ qualifikation_ids: [] });
    }
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] });
      qc.invalidateQueries({ queryKey: ['personal-vorschlaege'] });
      onClose();
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

  return (
    <Modal
      open={offen}
      title={person ? 'Person bearbeiten' : 'Person anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Personalnummer" name="personalnummer"><Input /></Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <AutoComplete
            options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
            allowClear
            placeholder="z. B. DRK Musterstadt"
            filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item label="Telefon" name="telefon"><Input /></Form.Item>
        <Form.Item label="Stärke-Position" name="staerke_position">
          <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Qualifikationen" name="qualifikation_ids">
          <Select mode="multiple" allowClear options={qualOptionen} optionFilterProp="label" placeholder="Qualifikationen wählen" />
        </Form.Item>
        <Form.Item label="Benutzer-Konto (optional)" name="benutzer_id">
          <Select allowClear showSearch options={benutzerOptionen} optionFilterProp="label" placeholder="kein Konto verknüpft" />
        </Form.Item>
        <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
