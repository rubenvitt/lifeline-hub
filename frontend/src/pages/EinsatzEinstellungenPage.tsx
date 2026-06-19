import { Alert, App, Button, Checkbox, Form, Select, Spin, Switch, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ladeEinsatz, ladeEinstellungen, speichereEinstellungen,
  ladeModulOverrides, setzeModulOverride,
} from '../api/einsaetze';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { modulRegistry, istModulAusblendbar } from '../einsatz/modulRegistry';
import type {
  BasemapModus, EinstellungenUpdate, FachebenenSichtbar, ModulOverrideUpdate,
} from '../api/types';

/** Optionen für die benötigte Rolle eines Moduls; '' = frei (für alle sichtbaren). */
const ROLLEN_OPTIONEN: { value: string; label: string }[] = [
  { value: '', label: 'Frei (alle)' },
  { value: 'fuehrungskraft', label: 'Führungskraft' },
  { value: 'admin', label: 'Admin' },
];

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
  const overridesQuery = useQuery({
    queryKey: ['modulOverrides', einsatzId],
    queryFn: () => ladeModulOverrides(einsatzId),
  });

  const overrideMutation = useMutation({
    mutationFn: (vars: { modulKey: string; update: ModulOverrideUpdate }) =>
      setzeModulOverride(einsatzId, vars.modulKey, vars.update),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modulOverrides', einsatzId] });
      message.success('Modul-Einstellung gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
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

  if (einsatzQuery.isLoading || einstellungenQuery.isLoading || overridesQuery.isLoading) {
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
  // Modul-Overrides darf nur die Einsatzleitung oder ein System-Admin verwalten
  // (deckt das Backend-Gate einsatzleitung|admin ab).
  const darfModuleVerwalten = istAktiv && (einsatz.meine_rolle === 'einsatzleitung' || istAdmin);
  const overrides = overridesQuery.data ?? {};

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

      <Typography.Title level={5} style={{ marginTop: 32 }}>
        Modul-Sichtbarkeit &amp; Berechtigungen
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Module für diesen Einsatz ausblenden oder auf eine Rolle beschränken. Einsatzdaten und
        Einstellungen lassen sich nicht ausblenden. Änderungen werden sofort gespeichert.
      </Typography.Paragraph>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, opacity: 0.6 }}>
          <span style={{ flex: 1 }}>Modul</span>
          <span style={{ width: 64, textAlign: 'center' }}>Sichtbar</span>
          <span style={{ width: 180 }}>Benötigte Rolle</span>
        </div>
        {modulRegistry.map((m) => {
          const ausblendbar = istModulAusblendbar(m.key);
          const ov = overrides[m.key];
          const sichtbar = ausblendbar ? ov?.sichtbar ?? true : true;
          const rolle = ov?.benoetigte_rolle ?? null;
          return (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1 }}>{m.label}</span>
              <div style={{ width: 64, textAlign: 'center' }}>
                <Switch
                  aria-label={`Sichtbar: ${m.label}`}
                  checked={sichtbar}
                  disabled={!darfModuleVerwalten || !ausblendbar || overrideMutation.isPending}
                  onChange={(checked) =>
                    overrideMutation.mutate({
                      modulKey: m.key,
                      update: { sichtbar: checked, benoetigte_rolle: rolle },
                    })
                  }
                />
              </div>
              <Select
                aria-label={`Benötigte Rolle: ${m.label}`}
                style={{ width: 180 }}
                value={rolle ?? ''}
                disabled={!darfModuleVerwalten || !ausblendbar || overrideMutation.isPending}
                options={ROLLEN_OPTIONEN}
                onChange={(val) =>
                  overrideMutation.mutate({
                    modulKey: m.key,
                    update: {
                      sichtbar,
                      benoetigte_rolle: (val || null) as ModulOverrideUpdate['benoetigte_rolle'],
                    },
                  })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
