import { Alert, App, AutoComplete, Button, Checkbox, Form, Input, InputNumber, Select, Spin, Switch, Typography } from 'antd';
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
  BasemapModus, EinheitenSystem, EinstellungenUpdate, FachebenenSichtbar,
  Koordinatenformat, ModulOverrideUpdate, Zeitformat,
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

// Anzeige-Konventionen (LFH-136). Kuratierte IANA-Zeitzonen + Freitext (AutoComplete).
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
  { value: 'mgrs', label: 'MGRS' },
  { value: 'utm', label: 'UTM' },
];

/** Formularwerte; Fachebenen als Liste der aktiven Keys (Checkbox.Group). */
interface FormWerte {
  standard_modul?: string;
  basemap_modus?: BasemapModus;
  fachebenen: (keyof FachebenenSichtbar)[];
  zeitzone?: string;
  zeitformat?: Zeitformat;
  einheiten?: EinheitenSystem;
  koordinatenformat?: Koordinatenformat;
  // Verhalten & Automatik (LFH-133).
  etb_nummer_praefix?: string;
  etb_nummer_start?: number;
  meldung_nummer_praefix?: string;
  meldung_nummer_start?: number;
  auftrag_nummer_praefix?: string;
  auftrag_nummer_start?: number;
  meldung_bestaetigung_frist_min?: number;
  auftrag_quittierung_frist_min?: number;
  auto_etb_eintraege: boolean;
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
    zeitzone: einstellungen.zeitzone ?? undefined,
    zeitformat: einstellungen.zeitformat ?? undefined,
    einheiten: einstellungen.einheiten ?? undefined,
    koordinatenformat: einstellungen.koordinatenformat ?? undefined,
    // Verhalten & Automatik (LFH-133).
    etb_nummer_praefix: einstellungen.etb_nummer_praefix ?? undefined,
    etb_nummer_start: einstellungen.etb_nummer_start ?? undefined,
    meldung_nummer_praefix: einstellungen.meldung_nummer_praefix ?? undefined,
    meldung_nummer_start: einstellungen.meldung_nummer_start ?? undefined,
    auftrag_nummer_praefix: einstellungen.auftrag_nummer_praefix ?? undefined,
    auftrag_nummer_start: einstellungen.auftrag_nummer_start ?? undefined,
    meldung_bestaetigung_frist_min: einstellungen.meldung_bestaetigung_frist_min ?? undefined,
    auftrag_quittierung_frist_min: einstellungen.auftrag_quittierung_frist_min ?? undefined,
    // 0 = aus; null/1 = an (Default an).
    auto_etb_eintraege: einstellungen.auto_etb_eintraege !== 0,
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
      // Anzeige-Konventionen (LFH-136); leer = projektweiter Default (null).
      zeitzone: werte.zeitzone?.trim() || null,
      zeitformat: werte.zeitformat ?? null,
      einheiten: werte.einheiten ?? null,
      koordinatenformat: werte.koordinatenformat ?? null,
      // Verhalten & Automatik (LFH-133) — alle Felder durchreichen (Vollersatz-PUT).
      etb_nummer_praefix: werte.etb_nummer_praefix?.trim() || null,
      etb_nummer_start: werte.etb_nummer_start ?? null,
      meldung_nummer_praefix: werte.meldung_nummer_praefix?.trim() || null,
      meldung_nummer_start: werte.meldung_nummer_start ?? null,
      auftrag_nummer_praefix: werte.auftrag_nummer_praefix?.trim() || null,
      auftrag_nummer_start: werte.auftrag_nummer_start ?? null,
      meldung_bestaetigung_frist_min: werte.meldung_bestaetigung_frist_min ?? null,
      auftrag_quittierung_frist_min: werte.auftrag_quittierung_frist_min ?? null,
      auto_etb_eintraege: werte.auto_etb_eintraege,
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

        <Typography.Title level={5}>Anzeige-Konventionen</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          Gemeinsame Darstellung für diesen Einsatz (Lagebild). Leer = Standard.
        </Typography.Paragraph>
        <Form.Item
          label="Zeitzone"
          name="zeitzone"
          tooltip="IANA-Zeitzone (z. B. Europe/Berlin). Leer = lokale Zeit des Geräts."
        >
          <AutoComplete
            allowClear
            options={ZEITZONEN_OPTIONEN}
            placeholder="Europe/Berlin (Standard)"
            filterOption={(eingabe, option) =>
              (option?.value ?? '').toLowerCase().includes(eingabe.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="Zeitformat" name="zeitformat">
          <Select allowClear placeholder="24 Stunden (Standard)" options={ZEITFORMAT_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Einheiten" name="einheiten">
          <Select allowClear placeholder="Metrisch (Standard)" options={EINHEITEN_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Koordinatenformat" name="koordinatenformat">
          <Select allowClear placeholder="WGS84 dezimal (Standard)" options={KOORDINATEN_OPTIONEN} />
        </Form.Item>

        <Typography.Title level={5}>Verhalten &amp; Automatik</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          Nummernkreise (Präfix + Startwert), Default-Fristen und automatische ETB-Einträge für
          diesen Einsatz. Präfixe sind reine Anzeige. Sobald die erste Nummer eines Kreises
          vergeben ist, sind Präfix und Startwert nicht mehr änderbar.
        </Typography.Paragraph>

        {([
          { key: 'etb', label: 'ETB', eingefroren: einstellungen.etb_nummer_eingefroren },
          { key: 'meldung', label: 'Meldungen', eingefroren: einstellungen.meldung_nummer_eingefroren },
          { key: 'auftrag', label: 'Aufträge', eingefroren: einstellungen.auftrag_nummer_eingefroren },
        ] as const).map((nk) => (
          <div key={nk.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Form.Item
              label={`Präfix ${nk.label}`}
              name={`${nk.key}_nummer_praefix`}
              style={{ flex: 1 }}
              tooltip="Wird der laufenden Nummer vorangestellt (z. B. EB-). Max. 8 Zeichen."
              extra={nk.eingefroren ? 'Erste Nummer bereits vergeben — nicht mehr änderbar' : undefined}
            >
              <Input maxLength={8} placeholder="z. B. EB-" disabled={nk.eingefroren} />
            </Form.Item>
            <Form.Item
              label={`Startwert ${nk.label}`}
              name={`${nk.key}_nummer_start`}
              style={{ width: 160 }}
              tooltip="Erste laufende Nummer (Default 1)."
            >
              <InputNumber min={1} max={999999} style={{ width: '100%' }} placeholder="1" disabled={nk.eingefroren} />
            </Form.Item>
          </div>
        ))}

        <Form.Item
          label="Default-Bestätigungsfrist Meldungen (Minuten)"
          name="meldung_bestaetigung_frist_min"
          tooltip="Frist für die Bestätigung pflichtiger Meldungen. Leer = projektweiter Standard."
        >
          <InputNumber min={1} max={10080} style={{ width: 200 }} placeholder="Standard" />
        </Form.Item>
        <Form.Item
          label="Default-Quittierfrist Aufträge (Minuten)"
          name="auftrag_quittierung_frist_min"
          tooltip="Frist für unquittierte Aufträge ohne explizite Frist. Leer = keine automatische Frist."
        >
          <InputNumber min={1} max={10080} style={{ width: 200 }} placeholder="keine" />
        </Form.Item>
        <Form.Item
          label="Automatische ETB-Einträge"
          name="auto_etb_eintraege"
          valuePropName="checked"
          tooltip="Meldungen und Aufträge erzeugen automatisch einen verknüpften ETB-Eintrag. Aus = kein automatischer ETB-Eintrag."
        >
          <Switch />
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
