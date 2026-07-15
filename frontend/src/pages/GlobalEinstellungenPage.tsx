import { Alert, App, AutoComplete, Button, Form, Input, InputNumber, Select, Spin, Switch, Tooltip } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ladeOrgEinstellungen, speichereOrgEinstellungen,
  ladeOrgModulEinstellungen, setzeOrgModulEinstellung,
} from '../api/orgEinstellungen';
import { providerListe, providerSchalten } from '../api/auth';
import { ApiError } from '../api/client';
import AdminPage from '../components/AdminPage';
import SegmentSektionen from '../components/SegmentSektionen';
import SektionHeader from '../components/SektionHeader';
import { useAuth } from '../auth/AuthContext';
import { modulRegistry, istModulAusblendbar } from '../einsatz/modulRegistry';
import type { EinheitenSystem, Koordinatenformat, OrgEinstellungenUpdate, Zeitformat } from '../api/types';

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

/** Optionen für den Modul-Rollen-Default; '' = kein Rollen-Zwang (frei). */
const ROLLEN_OPTIONEN: { value: string; label: string }[] = [
  { value: '', label: 'Frei (alle)' },
  { value: 'fuehrungskraft', label: 'Führungskraft' },
  { value: 'admin', label: 'Admin' },
];

interface FormWerte {
  zeitzone?: string;
  zeitformat?: Zeitformat;
  einheiten?: EinheitenSystem;
  koordinatenformat?: Koordinatenformat;
  retention_dauer_tage?: number;
  etb_nummer_praefix?: string;
  meldung_nummer_praefix?: string;
  auftrag_nummer_praefix?: string;
  meldung_bestaetigung_frist_min?: number;
  auftrag_quittierung_frist_min?: number;
  auto_etb_eintraege: boolean;
  geocoder_url?: string;
}

/**
 * Admin-Seite: org-weite Einstellungs-Defaults unter /admin/einstellungen.
 * Edit-Recht: nur system_rolle=admin; Führungskräfte sehen die Werte read-only.
 * Gliederung in vertikale Tabs (Anzeige / Einsatz-Defaults / Anmeldeverfahren, LFH-280).
 */
export default function GlobalEinstellungenPage() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();

  const istAdmin = benutzer?.system_rolle === 'admin';

  const einstellungenQuery = useQuery({
    queryKey: ['org-einstellungen'],
    queryFn: ladeOrgEinstellungen,
  });

  const modulQuery = useQuery({
    queryKey: ['org-modul-einstellungen'],
    queryFn: ladeOrgModulEinstellungen,
  });

  const speichernMutation = useMutation({
    mutationFn: (felder: OrgEinstellungenUpdate) => speichereOrgEinstellungen(felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-einstellungen'] });
      message.success('Einstellungen gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const modulMutation = useMutation({
    mutationFn: (vars: { modulKey: string; rolle: 'admin' | 'fuehrungskraft' | null }) =>
      setzeOrgModulEinstellung(vars.modulKey, vars.rolle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-modul-einstellungen'] });
      message.success('Modul-Default gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  // Anmeldeverfahren (Auth-Provider an/aus, LFH-280). Eigene Query — die LoginPage lädt die
  // Liste unabhängig bei jedem Mount, es gibt keinen geteilten Cache zu invalidieren.
  const providerQuery = useQuery({
    queryKey: ['auth-provider'],
    queryFn: providerListe,
  });

  const schaltenMutation = useMutation({
    mutationFn: (vars: { id: string; aktiviert: boolean }) =>
      providerSchalten(vars.id, vars.aktiviert),
    onSuccess: (liste) => {
      // Server-Wahrheit (inkl. abgelehntem Zustand) direkt übernehmen.
      qc.setQueryData(['auth-provider'], liste);
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Umschalten fehlgeschlagen'),
  });

  if (einstellungenQuery.isLoading || modulQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (einstellungenQuery.isError || !einstellungenQuery.data) {
    return <Alert type="error" title="Einstellungen nicht ladbar oder kein Zugriff" showIcon />;
  }

  const einstellungen = einstellungenQuery.data;
  const orgModul = modulQuery.data ?? {};
  const provider = providerQuery.data ?? [];

  const initialWerte: FormWerte = {
    zeitzone: einstellungen.zeitzone ?? undefined,
    zeitformat: einstellungen.zeitformat ?? undefined,
    einheiten: einstellungen.einheiten ?? undefined,
    koordinatenformat: einstellungen.koordinatenformat ?? undefined,
    retention_dauer_tage: einstellungen.retention_dauer_tage ?? undefined,
    etb_nummer_praefix: einstellungen.etb_nummer_praefix ?? undefined,
    meldung_nummer_praefix: einstellungen.meldung_nummer_praefix ?? undefined,
    auftrag_nummer_praefix: einstellungen.auftrag_nummer_praefix ?? undefined,
    meldung_bestaetigung_frist_min: einstellungen.meldung_bestaetigung_frist_min ?? undefined,
    auftrag_quittierung_frist_min: einstellungen.auftrag_quittierung_frist_min ?? undefined,
    // 0 = aus; null/1 = an (Default an).
    auto_etb_eintraege: einstellungen.auto_etb_eintraege !== 0,
    geocoder_url: einstellungen.geocoder_url ?? undefined,
  };

  function speichern(werte: FormWerte) {
    const felder: OrgEinstellungenUpdate = {
      zeitzone: werte.zeitzone?.trim() || null,
      zeitformat: werte.zeitformat ?? null,
      einheiten: werte.einheiten ?? null,
      koordinatenformat: werte.koordinatenformat ?? null,
      retention_dauer_tage: werte.retention_dauer_tage ?? null,
      etb_nummer_praefix: werte.etb_nummer_praefix?.trim() || null,
      meldung_nummer_praefix: werte.meldung_nummer_praefix?.trim() || null,
      auftrag_nummer_praefix: werte.auftrag_nummer_praefix?.trim() || null,
      meldung_bestaetigung_frist_min: werte.meldung_bestaetigung_frist_min ?? null,
      auftrag_quittierung_frist_min: werte.auftrag_quittierung_frist_min ?? null,
      auto_etb_eintraege: werte.auto_etb_eintraege,
      geocoder_url: werte.geocoder_url?.trim() || null,
    };
    speichernMutation.mutate(felder);
  }

  // ── Tab 1: Anzeige-Konventionen ────────────────────────────────
  const anzeigeTab = (
    <>
      <SektionHeader
        titel="Anzeige-Konventionen"
        beschreibung="Gemeinsame Darstellungs-Defaults (Lagebild). Leer = hartkodierter Fallback."
      />

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
    </>
  );

  // ── Tab 2: Einsatz-Defaults (Aufbewahrung + Verhalten + Modul-Rollen) ──
  const einsatzTab = (
    <>
      <SektionHeader
        titel="Aufbewahrung"
        beschreibung="Default-Aufbewahrungs-Dauer für neue Einsätze. Leer = keine automatische Frist."
      />

      <Form.Item
        label="Aufbewahrungs-Dauer (Tage)"
        name="retention_dauer_tage"
        tooltip="1 bis 3650 Tage. Leer = keine automatische Aufbewahrungsfrist."
      >
        <InputNumber min={1} max={3650} style={{ width: 200 }} placeholder="keine" />
      </Form.Item>

      <SektionHeader
        titel="Verhalten & Automatik"
        beschreibung="Nummernkreis-Präfixe und Default-Fristen für neue Einsätze. Präfixe sind reine Anzeige. Leer = kein Default (hartkodierter Fallback)."
      />

      <Form.Item
        label="Präfix ETB"
        name="etb_nummer_praefix"
        tooltip="Wird der laufenden ETB-Nummer vorangestellt (z. B. EB-). Max. 8 Zeichen."
      >
        <Input maxLength={8} placeholder="z. B. EB-" style={{ width: 200 }} />
      </Form.Item>
      <Form.Item
        label="Präfix Meldungen"
        name="meldung_nummer_praefix"
        tooltip="Wird der laufenden Meldungs-Nummer vorangestellt. Max. 8 Zeichen."
      >
        <Input maxLength={8} placeholder="z. B. M-" style={{ width: 200 }} />
      </Form.Item>
      <Form.Item
        label="Präfix Aufträge"
        name="auftrag_nummer_praefix"
        tooltip="Wird der laufenden Auftrags-Nummer vorangestellt. Max. 8 Zeichen."
      >
        <Input maxLength={8} placeholder="z. B. A-" style={{ width: 200 }} />
      </Form.Item>

      <Form.Item
        label="Default-Bestätigungsfrist Meldungen (Minuten)"
        name="meldung_bestaetigung_frist_min"
        tooltip="Frist für die Bestätigung pflichtiger Meldungen. Leer = kein Default."
      >
        <InputNumber min={1} max={10080} style={{ width: 200 }} placeholder="kein Default" />
      </Form.Item>
      <Form.Item
        label="Default-Quittierungsfrist Aufträge (Minuten)"
        name="auftrag_quittierung_frist_min"
        tooltip="Frist für unquittierte Aufträge ohne explizite Frist. Leer = kein Default."
      >
        <InputNumber min={1} max={10080} style={{ width: 200 }} placeholder="kein Default" />
      </Form.Item>

      <Form.Item
        label="Automatische ETB-Einträge"
        name="auto_etb_eintraege"
        valuePropName="checked"
        tooltip="Meldungen und Aufträge erzeugen automatisch einen verknüpften ETB-Eintrag."
      >
        <Switch />
      </Form.Item>

      {/* ── Modul-Rollen-Default (Sofort-Speichern, kein Form-Feld) ──────── */}
      <div style={{ marginTop: 32 }}>
        <SektionHeader
          titel="Modul-Rollen-Default"
          beschreibung="Org-weiter Default für die benötigte Rolle je Modul. Kann pro Einsatz überschrieben werden. Änderungen werden sofort gespeichert."
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 12, opacity: 0.6,
          }}
        >
          <span style={{ flex: 1 }}>Modul</span>
          <span style={{ width: 180 }}>Benötigte Rolle (Default)</span>
        </div>
        {modulRegistry.map((m) => {
          const rolle = orgModul[m.key] ?? null;
          const ausblendbar = istModulAusblendbar(m.key);
          return (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1 }}>{m.label}</span>
              <Select
                aria-label={`Benötigte Rolle: ${m.label}`}
                style={{ width: 180 }}
                value={rolle ?? ''}
                disabled={!istAdmin || !ausblendbar || modulMutation.isPending}
                options={ROLLEN_OPTIONEN}
                onChange={(val) =>
                  modulMutation.mutate({
                    modulKey: m.key,
                    rolle: (val || null) as 'admin' | 'fuehrungskraft' | null,
                  })
                }
              />
            </div>
          );
        })}
      </div>
    </>
  );

  // ── Tab 3: Anmeldeverfahren (Auth-Provider an/aus, LFH-280) ─────────
  const anmeldeverfahrenTab = (
    <>
      <SektionHeader
        titel="Anmeldeverfahren"
        beschreibung="Verfügbare Login-Wege an- und abschalten. Nur beim Serverstart konfigurierte Verfahren erscheinen hier. Änderungen werden sofort gespeichert."
      />

      {providerQuery.isLoading ? (
        <Spin />
      ) : providerQuery.isError ? (
        <Alert type="error" title="Anmeldeverfahren nicht ladbar" showIcon />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
          {provider.map((p) => {
            const istPasswort = p.id === 'passwort';
            const schalter = (
              <Switch
                aria-label={`Anmeldeverfahren: ${p.anzeigename}`}
                checked={p.aktiviert}
                disabled={!istAdmin || istPasswort || schaltenMutation.isPending}
                onChange={(aktiviert) => schaltenMutation.mutate({ id: p.id, aktiviert })}
              />
            );
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1 }}>{p.anzeigename}</span>
                {istPasswort ? (
                  <Tooltip title="Garantierter Admin-Login-Weg — nicht deaktivierbar">
                    <span>{schalter}</span>
                  </Tooltip>
                ) : (
                  schalter
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <AdminPage
      titel="Globale Einstellungen"
      beschreibung="Org-weite Defaults für alle Einsätze. Einsatzspezifische Einstellungen überschreiben diese Werte. Bearbeitung nur für System-Admins."
      aktionen={
        istAdmin ? (
          <Button type="primary" onClick={() => form.submit()} loading={speichernMutation.isPending}>
            Speichern
          </Button>
        ) : undefined
      }
    >
      <Form<FormWerte>
        form={form}
        layout="vertical"
        initialValues={initialWerte}
        onFinish={speichern}
        disabled={!istAdmin}
      >
        <SegmentSektionen
          ariaLabel="Einstellungs-Bereiche"
          sektionen={[
            { key: 'anzeige', label: 'Anzeige', inhalt: anzeigeTab },
            { key: 'einsatz', label: 'Einsatz-Defaults', inhalt: einsatzTab },
            { key: 'anmeldung', label: 'Anmeldeverfahren', inhalt: anmeldeverfahrenTab },
          ]}
        />
      </Form>
    </AdminPage>
  );
}
