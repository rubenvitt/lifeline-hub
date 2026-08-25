import { App, AutoComplete, Form, Input, Typography } from 'antd';
import { Link } from 'react-router';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisierePerson, legePersonAn } from '../api/personal';
import { listeQualifikationen } from '../api/qualifikationen';
import type { Personal, PersonalVorschlaege } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import { personalDetailPfad } from './stammdatenDetail';

/**
 * SCHNELLERFASSUNG, kein Vollformular mehr (LFH-346 · A7, Befund H36) — dieselbe
 * Entscheidung und dieselbe Begründung wie bei `FahrzeugFormModal`.
 *
 * Sichtbar bleiben Name, Personalnummer, Trägerorganisation und Qualifikationen. Telefon,
 * Stärke-Position, Benutzer-Konto und Bemerkung stehen auf `PersonalDetailPage`.
 */
interface FormWerte {
  name: string;
  personalnummer?: string;
  traegerorganisation?: string;
  qualifikation_ids: number[];
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
      qualifikation_ids: person.qualifikationen.map((q) => q.id),
    });
  }, [offen, person, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      /**
       * NUR die vier sichtbaren Felder — beim BEARBEITEN ist das tragend: der PATCH ist ein
       * echter Teil-Patch (LFH-306), ein `telefon: null` für ein Feld, das diese Maske gar
       * nicht zeigt, löschte die Nummer. Beim Anlegen gibt es nichts zu erhalten.
       */
      const daten = {
        name: werte.name.trim(),
        personalnummer: leerZuNull(werte.personalnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
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

  /*
   * Diese Maske war der HÜLLEN-PILOT aus LFH-332/B4 und trug dabei bewusst weiter acht
   * Felder — umgestellt wurde damals die Hülle, nicht der Feldbestand. Das Feldbudget
   * löst A7: vier sichtbare Felder, der Rest auf der Detailseite.
   *
   * `serie={person == null}` zeigt den Serienweg genau im Anlegen-Fall — dem, in dem eine
   * Einheit ihr Personal am Stück erfasst; beim Bearbeiten wäre er ein toter Knopf.
   * `uebernahme` trägt nur, was über eine Serie hinweg gleich bleibt: die
   * Trägerorganisation, nie Name oder Personalnummer.
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
      <Form.Item label="Qualifikationen" name="qualifikation_ids">
        <Select mode="multiple" allowClear options={qualOptionen} placeholder="Qualifikationen wählen" />
      </Form.Item>
      {/* NUR im Bearbeiten-Modus — beim Anlegen gibt es noch keine id und damit keine Route. */}
      {person && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          <Link to={personalDetailPfad(person.id)}>
            Mehr Details… (Telefon, Stärke-Position, Benutzer-Konto, Bemerkung)
          </Link>
        </Typography.Paragraph>
      )}
    </ErfassungsModal>
  );
}
