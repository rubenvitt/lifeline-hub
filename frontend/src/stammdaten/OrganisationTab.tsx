import { App, Button, Form, Space, Typography } from 'antd';
import AdminPage from '../components/AdminPage';
import { Select } from '../components/Select';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ladeOrganisation, setzeOrgDefault } from '../api/organisation';
import { globalKeys } from '../api/queryKeys';

interface FormWerte {
  tz_organisation: string;
}

const ORG_OPTIONEN = [
  { value: 'feuerwehr', label: 'Feuerwehr' },
  { value: 'thw', label: 'THW' },
  { value: 'hilfsorganisation', label: 'Hilfsorganisation' },
  { value: 'polizei', label: 'Polizei' },
  { value: 'gefahrenabwehr', label: 'Gefahrenabwehr' },
  { value: 'bundeswehr', label: 'Bundeswehr' },
  { value: 'zivil', label: 'Zivil' },
  { value: 'fuehrung', label: 'Führung' },
];

export default function OrganisationTab() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();

  const orgQuery = useQuery({ queryKey: globalKeys.organisation(), queryFn: ladeOrganisation });

  useEffect(() => {
    if (orgQuery.data?.tz_organisation) {
      form.setFieldsValue({ tz_organisation: orgQuery.data.tz_organisation });
    }
  }, [orgQuery.data, form]);

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => setzeOrgDefault(werte.tz_organisation),
    onSuccess: () => {
      message.success('DV-102-Organisation gespeichert');
      qc.invalidateQueries({ queryKey: globalKeys.organisation() });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    /* KEIN `aktionen`-Slot (LFH-346 · A3): der Speichern-Knopf gehört INS `<form>` und
       trägt `htmlType="submit"` — der Kopf-Slot von `AdminPage` liegt außerhalb jedes
       `<form>` und könnte nichts übermitteln (Erfassungs-Norm B4/LFH-332). */
    <AdminPage titel="Organisation">
      <Space orientation="vertical" size="middle" style={{ width: '100%', maxWidth: 480 }}>
        <Typography.Paragraph type="secondary">
          Standard-Organisation für taktische Zeichen; pro Objekt überschreibbar.
        </Typography.Paragraph>
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="DV-102-Organisation" name="tz_organisation">
            <Select
              options={ORG_OPTIONEN}
              placeholder="Organisation wählen"
              loading={orgQuery.isLoading}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={speichern.isPending}>
              Speichern
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </AdminPage>
  );
}
