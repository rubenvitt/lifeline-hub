import { Alert, App, Button, Checkbox, Form, Select, Spin, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, ladeEinstellungen, speichereEinstellungen } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { modulRegistry } from '../einsatz/modulRegistry';
import type { BasemapModus, EinstellungenUpdate, FachebenenSichtbar } from '../api/types';

const BASEMAP_OPTIONEN: { value: BasemapModus; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'blind', label: 'Blindkarte' },
];

const FACHEBENEN_OPTIONEN: { value: keyof FachebenenSichtbar; label: string }[] = [
  { value: 'nina', label: 'NINA (Warnungen)' },
  { value: 'dwd', label: 'DWD (Wetter)' },
  { value: 'pegelonline', label: 'Pegelonline (Hochwasser)' },
  { value: 'kritis', label: 'KRITIS' },
];

/** Formularwerte; Fachebenen als Liste der aktiven Keys (Checkbox.Group). */
interface FormWerte {
  standard_modul?: string;
  basemap_modus?: BasemapModus;
  fachebenen: (keyof FachebenenSichtbar)[];
}

export default function EinsatzEinstellungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einstellungenQuery = useQuery({
    queryKey: ['einsatz-einstellungen', einsatzId],
    queryFn: () => ladeEinstellungen(einsatzId),
  });

  const speichernMutation = useMutation({
    mutationFn: (felder: EinstellungenUpdate) => speichereEinstellungen(einsatzId, felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz-einstellungen', einsatzId] });
      message.success('Einstellungen gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  if (einsatzQuery.isLoading || einstellungenQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data || einstellungenQuery.isError || !einstellungenQuery.data) {
    return <Alert type="error" message="Einstellungen nicht ladbar oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const einstellungen = einstellungenQuery.data;

  const istAdmin = benutzer?.system_rolle === 'admin';
  const istAktiv = einsatz.status === 'aktiv';
  const darfBearbeiten =
    istAktiv &&
    (einsatz.meine_rolle === 'einsatzleitung' ||
      einsatz.meine_rolle === 'fuehrungspersonal' ||
      istAdmin);

  // Nur fertige Module sind als Default-Modul wählbar (Pre-Mortem: kein Sprung
  // auf geplante/WIP-Module).
  const standardModulOptionen = modulRegistry
    .filter((m) => m.status === 'fertig')
    .map((m) => ({ value: m.key, label: m.label }));

  const aktiveFachebenen = einstellungen.fachebenen_sichtbar;
  const initialWerte: FormWerte = {
    standard_modul: einstellungen.standard_modul ?? undefined,
    basemap_modus: einstellungen.basemap_modus ?? undefined,
    fachebenen: aktiveFachebenen
      ? FACHEBENEN_OPTIONEN.map((o) => o.value).filter((k) => aktiveFachebenen[k])
      : [],
  };

  function speichern(werte: FormWerte) {
    const gewaehlt = new Set(werte.fachebenen ?? []);
    const fachebenen_sichtbar: FachebenenSichtbar = {
      nina: gewaehlt.has('nina'),
      dwd: gewaehlt.has('dwd'),
      pegelonline: gewaehlt.has('pegelonline'),
      kritis: gewaehlt.has('kritis'),
    };
    const felder: EinstellungenUpdate = {
      standard_modul: werte.standard_modul || null,
      basemap_modus: werte.basemap_modus ?? null,
      // Start-Zoom wird hier (noch) nicht erhoben — Anwendung im Karten-Kern folgt im
      // Anzeige-Konventionen-Folge-Subtask; Spalte bleibt als Fundament erhalten.
      karten_zoom_start: einstellungen.karten_zoom_start,
      fachebenen_sichtbar,
    };
    speichernMutation.mutate(felder);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Einstellungen
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Einsatzbezogene Einstellungen für „{einsatz.bezeichnung}". Gelten nur für diesen Einsatz.
      </Typography.Paragraph>

      {!istAktiv && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Einsatz abgeschlossen — Einstellungen sind eingefroren und können nicht mehr geändert werden."
        />
      )}

      <Form<FormWerte>
        form={form}
        layout="vertical"
        initialValues={initialWerte}
        onFinish={speichern}
        disabled={!darfBearbeiten}
      >
        <Typography.Title level={5}>Einstieg</Typography.Title>
        <Form.Item
          label="Standard-Modul (Einstieg)"
          name="standard_modul"
          tooltip="Modul, das beim Öffnen des Einsatzes angezeigt wird. Leer = Standard (Lage-Dashboard bzw. ETB)."
        >
          <Select
            allowClear
            placeholder="Standard (Lage-Dashboard bzw. ETB)"
            options={standardModulOptionen}
          />
        </Form.Item>

        <Typography.Title level={5}>Karten-Defaults</Typography.Title>
        <Form.Item
          label="Basemap-Vorwahl"
          name="basemap_modus"
          tooltip="Kartenhintergrund beim ersten Öffnen der Lagekarte. Leer = automatische Wahl."
        >
          <Select allowClear placeholder="Automatisch (Verfügbarkeit)" options={BASEMAP_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Aktive Lage-Layer" name="fachebenen">
          <Checkbox.Group options={FACHEBENEN_OPTIONEN} />
        </Form.Item>

        <Button type="primary" htmlType="submit" loading={speichernMutation.isPending} disabled={!darfBearbeiten}>
          Speichern
        </Button>
      </Form>
    </div>
  );
}
