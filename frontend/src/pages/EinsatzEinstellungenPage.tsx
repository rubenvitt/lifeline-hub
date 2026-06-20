import { Alert, App, AutoComplete, Button, Checkbox, Form, Input, InputNumber, Select, Spin, Switch, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ladeEinsatz, ladeEinstellungen, speichereEinstellungen,
  ladeModulOverrides, setzeModulOverride,
} from '../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../api/orgEinstellungen';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { modulRegistry, istModulAusblendbar } from '../einsatz/modulRegistry';
import type {
  BasemapModus, EinheitenSystem, EinstellungenUpdate, FachebenenSichtbar,
  Koordinatenformat, ModulOverrideUpdate, OrgModulEinstellungen, Zeitformat,
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
  { value: 'dms', label: 'WGS84 (Grad/Min/Sek)' },
  { value: 'utm', label: 'UTM' },
  { value: 'mgrs', label: 'MGRS' },
  { value: 'gk', label: 'Gauß-Krüger' },
];

/** Tristate-Optionen für automatische ETB-Einträge (null=erbt Org, true=An, false=Aus). */
const AUTO_ETB_OPTIONEN: { value: boolean; label: string }[] = [
  { value: true, label: 'An' },
  { value: false, label: 'Aus' },
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
  // undefined = Org-Standard erben; true = An; false = Aus.
  auto_etb_eintraege: boolean | undefined;
  // Aufbewahrung & Archiv (LFH-135).
  retention_dauer_tage?: number;
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
  // Org-Modul-Rollen-Defaults (optional, nicht-blockierend).
  const orgModulQuery = useQuery({
    queryKey: ['orgModulEinstellungen'],
    queryFn: () => ladeOrgModulEinstellungen(),
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
  const orgDefaults = einstellungen.org_defaults;
  const orgModulDefaults: OrgModulEinstellungen = orgModulQuery.data ?? {};

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
    // null = Org-Standard erben (tristate); 0 = Aus; 1 = An.
    auto_etb_eintraege:
      einstellungen.auto_etb_eintraege === null
        ? undefined
        : einstellungen.auto_etb_eintraege === 0
          ? false
          : true,
    // Aufbewahrung & Archiv (LFH-135).
    retention_dauer_tage: einstellungen.retention_dauer_tage ?? undefined,
  };

  /** Gibt „Standard (Org): X" zurück wenn ein Org-Default gesetzt ist, sonst undefined. */
  function orgHinweisWert(wert: string | number | null | undefined, suffix?: string): string | undefined {
    if (wert == null) return undefined;
    return `Standard (Org): ${wert}${suffix ? ` ${suffix}` : ''}`;
  }

  function orgHinweisSelect<T extends string>(
    wert: T | null | undefined,
    optionen: { value: T; label: string }[],
  ): string | undefined {
    if (wert == null) return undefined;
    const opt = optionen.find((o) => o.value === wert);
    return opt ? `Standard (Org): ${opt.label}` : undefined;
  }

  /** Hint für auto_etb_eintraege: 0 = Aus, 1/andere = An. */
  function orgHinweisAutoEtb(wert: number | null | undefined): string | undefined {
    if (wert == null) return undefined;
    return `Standard (Org): ${wert === 0 ? 'Aus' : 'An'}`;
  }

  /** Org-Rollen-Hinweis im Modul-Override (z.B. „Org: Führungskraft"). */
  function orgRollenHinweis(rolle: 'admin' | 'fuehrungskraft' | null | undefined): string | undefined {
    if (rolle == null) return undefined;
    if (rolle === 'fuehrungskraft') return 'Org: Führungskraft';
    if (rolle === 'admin') return 'Org: Admin';
    return undefined;
  }

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
      // undefined (Org-Standard) → null im Payload (Backend-Semantik: erbt Org-Default).
      auto_etb_eintraege: werte.auto_etb_eintraege ?? null,
      // Aufbewahrung & Archiv (LFH-135); leer = keine Auto-Frist (null).
      retention_dauer_tage: werte.retention_dauer_tage ?? null,
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
          extra={orgHinweisWert(orgDefaults?.zeitzone)}
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
        <Form.Item
          label="Zeitformat"
          name="zeitformat"
          extra={orgHinweisSelect(orgDefaults?.zeitformat, ZEITFORMAT_OPTIONEN)}
        >
          <Select allowClear placeholder="24 Stunden (Standard)" options={ZEITFORMAT_OPTIONEN} />
        </Form.Item>
        <Form.Item
          label="Einheiten"
          name="einheiten"
          extra={orgHinweisSelect(orgDefaults?.einheiten, EINHEITEN_OPTIONEN)}
        >
          <Select allowClear placeholder="Metrisch (Standard)" options={EINHEITEN_OPTIONEN} />
        </Form.Item>
        <Form.Item
          label="Koordinatenformat"
          name="koordinatenformat"
          extra={orgHinweisSelect(orgDefaults?.koordinatenformat, KOORDINATEN_OPTIONEN)}
        >
          <Select allowClear placeholder="WGS84 dezimal (Standard)" options={KOORDINATEN_OPTIONEN} />
        </Form.Item>

        <Typography.Title level={5}>Verhalten &amp; Automatik</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          Nummernkreise (Präfix + Startwert), Default-Fristen und automatische ETB-Einträge für
          diesen Einsatz. Präfixe sind reine Anzeige. Sobald die erste Nummer eines Kreises
          vergeben ist, sind Präfix und Startwert nicht mehr änderbar.
        </Typography.Paragraph>

        {([
          {
            key: 'etb', label: 'ETB', eingefroren: einstellungen.etb_nummer_eingefroren,
            orgPraefix: orgDefaults?.etb_nummer_praefix,
          },
          {
            key: 'meldung', label: 'Meldungen', eingefroren: einstellungen.meldung_nummer_eingefroren,
            orgPraefix: orgDefaults?.meldung_nummer_praefix,
          },
          {
            key: 'auftrag', label: 'Aufträge', eingefroren: einstellungen.auftrag_nummer_eingefroren,
            orgPraefix: orgDefaults?.auftrag_nummer_praefix,
          },
        ] as const).map((nk) => (
          <div key={nk.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Form.Item
              label={`Präfix ${nk.label}`}
              name={`${nk.key}_nummer_praefix`}
              style={{ flex: 1 }}
              tooltip="Wird der laufenden Nummer vorangestellt (z. B. EB-). Max. 8 Zeichen."
              extra={
                nk.eingefroren
                  ? 'Erste Nummer bereits vergeben — nicht mehr änderbar'
                  : orgHinweisWert(nk.orgPraefix)
              }
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
          extra={orgHinweisWert(orgDefaults?.meldung_bestaetigung_frist_min, 'Min.')}
        >
          <InputNumber min={1} max={10080} style={{ width: 200 }} placeholder="Standard" />
        </Form.Item>
        <Form.Item
          label="Default-Quittierfrist Aufträge (Minuten)"
          name="auftrag_quittierung_frist_min"
          tooltip="Frist für unquittierte Aufträge ohne explizite Frist. Leer = keine automatische Frist."
          extra={orgHinweisWert(orgDefaults?.auftrag_quittierung_frist_min, 'Min.')}
        >
          <InputNumber min={1} max={10080} style={{ width: 200 }} placeholder="keine" />
        </Form.Item>
        <Form.Item
          label="Automatische ETB-Einträge"
          name="auto_etb_eintraege"
          tooltip="Meldungen und Aufträge erzeugen automatisch einen verknüpften ETB-Eintrag. Leer = Org-Standard erben."
          extra={orgHinweisAutoEtb(orgDefaults?.auto_etb_eintraege)}
        >
          <Select
            allowClear
            placeholder="Org-Standard"
            options={AUTO_ETB_OPTIONEN}
            style={{ width: 200 }}
          />
        </Form.Item>

        <Typography.Title level={5}>Aufbewahrung &amp; Archiv</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          Aufbewahrungs-Dauer in Tagen für diesen Einsatz. Die Frist greift erst beim
          Abschluss (sie wird daraus als Zeitpunkt berechnet) und wirkt nie auf den
          laufenden Einsatz. Nach Fristablauf wird der Einsatz zunächst gesperrt und
          später unwiderruflich von Personendaten bereinigt (ETB und Statistik bleiben
          erhalten). Leer = keine automatische Frist. Eine spätere Verkürzung einer
          bereits gesetzten Frist ist gesondert (manuelle Frist) bestätigungspflichtig.
        </Typography.Paragraph>
        <Form.Item
          label="Aufbewahrungs-Dauer (Tage)"
          name="retention_dauer_tage"
          tooltip="1 bis 3650 Tage. Leer = keine automatische Aufbewahrungsfrist."
          extra={orgHinweisWert(orgDefaults?.retention_dauer_tage, 'Tage')}
        >
          <InputNumber min={1} max={3650} style={{ width: 200 }} placeholder="keine" />
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
          const orgRolleHinweis = orgRollenHinweis(orgModulDefaults[m.key]);
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                {orgRolleHinweis && (
                  <span style={{ fontSize: 11, color: 'var(--ant-color-text-secondary, rgba(0,0,0,0.45))' }}>
                    {orgRolleHinweis}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
