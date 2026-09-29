import { App, AutoComplete, Button, Form, Input, theme } from 'antd';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeOrgEinstellungen, speichereOrgEinstellungen } from '../../api/orgEinstellungen';
import AdminPage from '../../components/AdminPage';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { globalKeys } from '../../api/queryKeys';
import {
  EINHEITEN_OPTIONEN,
  KOORDINATEN_OPTIONEN,
  ZEITFORMAT_OPTIONEN,
  ZEITZONEN_OPTIONEN,
} from './optionen';
import {
  type FormWerteAnzeige,
  initialAnzeige,
  normalisiereAnzeige,
  zuUpdate,
} from './orgEinstellungenForm';
import { speicherLeisteStil } from '../../components/speicherLeiste';
import { Formularpaneel } from '../../components/instrument';
import { teilwortSuche } from '../../components/teilwortSuche';

/**
 * Admin-Sektion `/admin/einstellungen/anzeige` — org-weite Darstellungs-Defaults + Geocoder.
 * Bearbeiten nur `system_rolle=admin`. Der PUT ist Vollersatz: der Payload wird aus geladenen Daten
 * + eigenen Feldern gemerged.
 */
export default function AnzeigeEinstellungen() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteAnzeige>();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const { token } = theme.useToken();

  const einstellungenQuery = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
  });

  const speichernMutation = useMutation({
    // Arrow-Wrapper: react-query ruft mutationFn mit (variables, context) — der Kontext darf nicht
    // als
    // 2. Argument im PUT-Wrapper landen.
    mutationFn: (felder: Parameters<typeof speichereOrgEinstellungen>[0]) =>
      speichereOrgEinstellungen(felder),
    // Kein `onError`-Toast: der Fehler steht als `<SeitenHinweise>` über dem Formular.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgEinstellungen() });
      message.success('Einstellungen gespeichert');
    },
  });

  if (einstellungenQuery.isLoading) {
    return <SeitenSkeleton />;
  }

  if (einstellungenQuery.isError || !einstellungenQuery.data) {
    return (
      <SeitenFehler
        text="Einstellungen nicht ladbar oder kein Zugriff"
        onWiederholen={() => void einstellungenQuery.refetch()}
      />
    );
  }

  const einstellungen = einstellungenQuery.data;

  function speichern(werte: FormWerteAnzeige) {
    // Vollersatz-PUT: Basis aus geladenen Daten, Anzeige-Felder überschreiben.
    speichernMutation.mutate({ ...zuUpdate(einstellungen), ...normalisiereAnzeige(werte) });
  }

  return (
    <AdminPage
      titel="Anzeige-Konventionen"
      breite="schmal"
      beschreibung="Org-weite Darstellungs-Defaults für alle Einsätze. Leer = hartkodierter Fallback."
      hinweis={
        <SeitenHinweise
          fehler={speichernMutation.error}
          rechteFehlt={!istAdmin}
          rechteText="Nur Benutzer mit der Systemrolle „Admin“ dürfen die Anzeige-Konventionen ändern — die Werte stehen hier zum Nachlesen."
        />
      }
    >
      {/* Der Speichern-Knopf liegt im `<form>` (sticky Leiste unten, `htmlType="submit"`), nicht
          im Kopf-Slot: nur im `<form>` sendet Enter ab. Ohne Recht steht er gesperrt da, mit
          Grund. */}
      <Form<FormWerteAnzeige>
        form={form}
        layout="vertical"
        initialValues={initialAnzeige(einstellungen)}
        onFinish={speichern}
        disabled={!istAdmin}
      >
        <Formularpaneel titel="Darstellung">
          <Form.Item
            label="Zeitzone"
            name="zeitzone"
            tooltip="IANA-Zeitzone (z. B. Europe/Berlin). Leer = lokale Zeit des Geräts."
          >
            <AutoComplete
              allowClear
              options={ZEITZONEN_OPTIONEN}
              placeholder="Europe/Berlin (Fallback)"
              showSearch={teilwortSuche}
            />
          </Form.Item>
          <Form.Item label="Zeitformat" name="zeitformat">
            <Select allowClear placeholder="24 Stunden (Fallback)" options={ZEITFORMAT_OPTIONEN} />
          </Form.Item>
          <Form.Item label="Einheiten" name="einheiten">
            <Select allowClear placeholder="Metrisch (Fallback)" options={EINHEITEN_OPTIONEN} />
          </Form.Item>
          <Form.Item label="Koordinatenformat" name="koordinatenformat">
            <Select
              allowClear
              placeholder="WGS84 dezimal (Fallback)"
              options={KOORDINATEN_OPTIONEN}
            />
          </Form.Item>
        </Formularpaneel>
        <Formularpaneel titel="Ort-Vorschau">
          <Form.Item
            label="Geocoder-URL"
            name="geocoder_url"
            tooltip="Nominatim-kompatible Basis-URL für die Ort-Vorschau (Reverse-Geocoding). Leer = öffentlicher Nominatim. Die Einsatz-Koordinate wird an diesen Dienst gesendet — für Produktivlast/Datenschutz eigenen Geocoder hinterlegen."
          >
            <Input
              placeholder="https://nominatim.openstreetmap.org (Default)"
              allowClear
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Formularpaneel>
        <div style={speicherLeisteStil(token)}>
          <Button
            type="primary"
            htmlType="submit"
            loading={speichernMutation.isPending}
            disabled={!istAdmin}
          >
            Speichern
          </Button>
        </div>
      </Form>
    </AdminPage>
  );
}
