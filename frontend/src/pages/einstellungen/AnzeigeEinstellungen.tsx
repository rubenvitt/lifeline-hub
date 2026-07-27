import { App, AutoComplete, Button, Form, Input } from 'antd';
import { Select } from '../../components/Select';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeOrgEinstellungen, speichereOrgEinstellungen } from '../../api/orgEinstellungen';
import { ApiError } from '../../api/client';
import AdminPage from '../../components/AdminPage';
import { useAuth } from '../../auth/AuthContext';
import type { EinheitenSystem, Koordinatenformat, Zeitformat } from '../../api/types';
import { globalKeys } from '../../api/queryKeys';
import {
  type FormWerteAnzeige,
  initialAnzeige,
  normalisiereAnzeige,
  zuUpdate,
} from './orgEinstellungenForm';

// Anzeige-Konventionen — kuratierte IANA-Zeitzonen + Freitext (AutoComplete).
const ZEITZONEN_OPTIONEN = [
  'Europe/Berlin', 'Europe/London', 'Europe/Paris', 'Europe/Zurich', 'Europe/Vienna',
  'Europe/Warsaw', 'Europe/Moscow', 'UTC', 'America/New_York', 'America/Los_Angeles',
  'Asia/Istanbul', 'Asia/Dubai', 'Asia/Tokyo',
].map((z) => ({ value: z }));

const ZEITFORMAT_OPTIONEN: { value: Zeitformat; label: string }[] = [
  { value: '24h', label: '24 Stunden' },
  { value: '12h', label: '12 Stunden (AM/PM)' },
];

const EINHEITEN_OPTIONEN: { value: EinheitenSystem; label: string }[] = [
  { value: 'metrisch', label: 'Metrisch (m, km)' },
  { value: 'imperial', label: 'Imperial (ft, mi)' },
];

const KOORDINATEN_OPTIONEN: { value: Koordinatenformat; label: string }[] = [
  { value: 'wgs84', label: 'WGS84 dezimal' },
  { value: 'dms', label: 'WGS84 (Grad/Min/Sek)' },
  { value: 'utm', label: 'UTM' },
  { value: 'mgrs', label: 'MGRS' },
  { value: 'gk', label: 'Gauß-Krüger' },
];

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

  const einstellungenQuery = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
  });

  const speichernMutation = useMutation({
    // Arrow-Wrapper: react-query ruft mutationFn mit (variables, context) — den Kontext
    // nicht an speichereOrgEinstellungen durchreichen (sonst 2. Arg im PUT-Wrapper).
    mutationFn: (felder: Parameters<typeof speichereOrgEinstellungen>[0]) =>
      speichereOrgEinstellungen(felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgEinstellungen() });
      message.success('Einstellungen gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
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
      beschreibung="Org-weite Darstellungs-Defaults für alle Einsätze. Leer = hartkodierter Fallback."
      aktionen={
        istAdmin ? (
          <Button type="primary" onClick={() => form.submit()} loading={speichernMutation.isPending}>
            Speichern
          </Button>
        ) : undefined
      }
    >
      <Form<FormWerteAnzeige>
        form={form}
        layout="vertical"
        initialValues={initialAnzeige(einstellungen)}
        onFinish={speichern}
        disabled={!istAdmin}
      >
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
          <Select allowClear placeholder="WGS84 dezimal (Fallback)" options={KOORDINATEN_OPTIONEN} />
        </Form.Item>
        <Form.Item
          label="Geocoder-URL"
          name="geocoder_url"
          tooltip="Nominatim-kompatible Basis-URL für die Ort-Vorschau (Reverse-Geocoding). Leer = öffentlicher Nominatim. Die Einsatz-Koordinate wird an diesen Dienst gesendet — für Produktivlast/Datenschutz eigenen Geocoder hinterlegen."
        >
          <Input placeholder="https://nominatim.openstreetmap.org (Default)" allowClear style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </AdminPage>
  );
}
