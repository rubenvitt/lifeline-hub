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

/**
 * Admin-Sektion `/admin/einstellungen/anzeige` — org-weite Darstellungs-Defaults + Geocoder.
 * Edit nur system_rolle=admin; Führungskräfte sehen read-only. PUT ist Vollersatz → beim
 * Speichern wird der volle Payload aus geladenen Daten + eigenen Feldern gemerged.
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
    // Arrow-Wrapper: react-query ruft mutationFn mit (variables, context) — den Kontext
    // nicht an speichereOrgEinstellungen durchreichen (sonst 2. Arg im PUT-Wrapper).
    mutationFn: (felder: Parameters<typeof speichereOrgEinstellungen>[0]) =>
      speichereOrgEinstellungen(felder),
    // KEIN `onError`-Toast mehr (LFH-345 · C10, H14): der Fehler hängt an `mutation.error`
    // und steht als `<SeitenHinweise>` über dem Formular. Ein Toast verfällt nach ~3 s.
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
      {/* Der Speichern-Knopf liegt seit dem Neuentwurf IM `<form>` (sticky Leiste unten,
          `htmlType="submit"`) statt im Kopf-Slot: der Kopf trägt, was ÖFFNET, nie was
          ABSENDET (LFH-346 · C11) — und nur im `<form>` sendet Enter ab (Erfassungs-Norm B4).
          Der Knopf VERSCHWINDET ohne Recht nicht (LFH-345 · C10, M16) — gesperrt mit Grund. */}
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
              showSearch={{
                filterOption: (eingabe, option) =>
                  (option?.value ?? '').toLowerCase().includes(eingabe.toLowerCase()),
              }}
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
