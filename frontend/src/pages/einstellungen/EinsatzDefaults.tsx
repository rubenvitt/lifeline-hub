import { Alert, App, Button, Form, Input, InputNumber, Spin, Switch } from 'antd';
import { Select } from '../../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ladeOrgEinstellungen,
  speichereOrgEinstellungen,
  ladeOrgModulEinstellungen,
  setzeOrgModulEinstellung,
} from '../../api/orgEinstellungen';
import { ApiError } from '../../api/client';
import AdminPage from '../../components/AdminPage';
import SektionHeader from '../../components/SektionHeader';
import { useAuth } from '../../auth/AuthContext';
import { modulRegistry, istModulAusblendbar } from '../../einsatz/modulRegistry';
import { globalKeys } from '../../api/queryKeys';
import {
  type FormWerteEinsatz,
  initialEinsatz,
  normalisiereEinsatz,
  zuUpdate,
} from './orgEinstellungenForm';

/** Optionen für den Modul-Rollen-Default; '' = kein Rollen-Zwang (frei). */
const ROLLEN_OPTIONEN: { value: string; label: string }[] = [
  { value: '', label: 'Frei (alle)' },
  { value: 'fuehrungskraft', label: 'Führungskraft' },
  { value: 'admin', label: 'Admin' },
];

/**
 * Admin-Sektion `/admin/einstellungen/einsatz` — Aufbewahrung, Nummernkreise, Fristen,
 * Auto-ETB + Modul-Rollen-Default. Edit nur system_rolle=admin. PUT ist Vollersatz → beim
 * Speichern wird der volle Payload aus geladenen Daten + eigenen Feldern gemerged. Die
 * Modul-Rollen-Selects speichern sofort (eigene Mutation, kein Form-Feld).
 */
export default function EinsatzDefaults() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteEinsatz>();
  const istAdmin = benutzer?.system_rolle === 'admin';

  const einstellungenQuery = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
  });

  const modulQuery = useQuery({
    queryKey: globalKeys.orgModulEinstellungen(),
    queryFn: ladeOrgModulEinstellungen,
  });

  const speichernMutation = useMutation({
    mutationFn: (felder: Parameters<typeof speichereOrgEinstellungen>[0]) =>
      speichereOrgEinstellungen(felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgEinstellungen() });
      message.success('Einstellungen gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const modulMutation = useMutation({
    mutationFn: (vars: { modulKey: string; rolle: 'admin' | 'fuehrungskraft' | null }) =>
      setzeOrgModulEinstellung(vars.modulKey, vars.rolle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgModulEinstellungen() });
      message.success('Modul-Default gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
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

  function speichern(werte: FormWerteEinsatz) {
    // Vollersatz-PUT: Basis aus geladenen Daten, Einsatz-Default-Felder überschreiben.
    speichernMutation.mutate({ ...zuUpdate(einstellungen), ...normalisiereEinsatz(werte) });
  }

  return (
    <AdminPage
      titel="Einsatz-Defaults"
      beschreibung="Org-weite Defaults für neue Einsätze. Einsatzspezifische Einstellungen überschreiben diese Werte."
      aktionen={
        istAdmin ? (
          <Button type="primary" onClick={() => form.submit()} loading={speichernMutation.isPending}>
            Speichern
          </Button>
        ) : undefined
      }
    >
      <Form<FormWerteEinsatz>
        form={form}
        layout="vertical"
        initialValues={initialEinsatz(einstellungen)}
        onFinish={speichern}
        disabled={!istAdmin}
      >
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
      </Form>

      {/* ── Modul-Rollen-Default (Sofort-Speichern, kein Form-Feld) ──────── */}
      <div style={{ marginTop: 32 }}>
        <SektionHeader
          titel="Modul-Rollen-Default"
          beschreibung="Org-weiter Default für die benötigte Rolle je Modul. Kann pro Einsatz überschrieben werden. Änderungen werden sofort gespeichert."
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, opacity: 0.6 }}>
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
    </AdminPage>
  );
}
