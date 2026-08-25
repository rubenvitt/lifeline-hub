import { App, Button, Form, Space, Typography } from 'antd';
import AdminPage from '../components/AdminPage';
import { Select } from '../components/Select';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeOrganisation, setzeOrgDefault } from '../api/organisation';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

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
  /**
   * Diese Sektion hatte als EINZIGE der elf gar kein Rechte-Gate (LFH-346 · A2, M45) —
   * `PATCH /api/organisation` lehnt zwar serverseitig ab, aber die Absage kam erst nach
   * dem Klick und verschwand als Toast wieder. Jetzt: Formular und Knopf gesperrt, der
   * Grund steht im Hinweis-Slot.
   */
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
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
    /**
     * KEIN `onError` mehr (derselbe Befund wie LFH-345 · C10 / H14, eine Datei weiter):
     * nach rund drei Sekunden war der Toast weg, das ausgefüllte Formular stand unverändert
     * da und wirkte gespeichert. Der Fehler hängt jetzt als Alert an der SEITE
     * (`speichern.error` im `hinweis`-Slot) und räumt sich beim nächsten Absenden selbst
     * weg — react-query setzt `error` beim Übergang nach `pending` zurück. Der ERFOLG
     * bleibt beim Toast: er quittiert eine abgeschlossene Handlung.
     */
  });

  return (
    /* KEIN `aktionen`-Slot (LFH-346 · A3): der Speichern-Knopf gehört INS `<form>` und
       trägt `htmlType="submit"` — der Kopf-Slot von `AdminPage` liegt außerhalb jedes
       `<form>` und könnte nichts übermitteln (Erfassungs-Norm B4/LFH-332). */
    <AdminPage
      titel="Organisation"
      hinweis={
        <SeitenHinweise
          fehler={speichern.error}
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%', maxWidth: 480 }}>
        <Typography.Paragraph type="secondary">
          Standard-Organisation für taktische Zeichen; pro Objekt überschreibbar.
        </Typography.Paragraph>
        {/* `disabled` am Formular sperrt die Felder, `disabled` am Knopf den Absendeweg —
            der Knopf VERSCHWINDET nicht (M16). */}
        <Form<FormWerte>
          form={form}
          layout="vertical"
          disabled={!istAdmin}
          onFinish={(w) => speichern.mutate(w)}
        >
          <Form.Item label="DV-102-Organisation" name="tz_organisation">
            <Select
              options={ORG_OPTIONEN}
              placeholder="Organisation wählen"
              loading={orgQuery.isLoading}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              disabled={!istAdmin}
              loading={speichern.isPending}
            >
              Speichern
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </AdminPage>
  );
}
