import { App, Button, Form, Input, InputNumber, Switch, theme } from 'antd';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import ModulEinstellungsListe from './ModulEinstellungsListe';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ladeOrgEinstellungen,
  speichereOrgEinstellungen,
  ladeOrgModulEinstellungen,
  setzeOrgModulEinstellung,
} from '../../api/orgEinstellungen';
import AdminPage from '../../components/AdminPage';
import SektionHeader from '../../components/SektionHeader';
import { SeitenHinweise } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { globalKeys } from '../../api/queryKeys';
import {
  type FormWerteEinsatz,
  initialEinsatz,
  normalisiereEinsatz,
  zuUpdate,
} from './orgEinstellungenForm';

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
  const { token } = theme.useToken();
  const istAdmin = benutzer?.system_rolle === 'admin';

  const einstellungenQuery = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
  });

  const modulQuery = useQuery({
    queryKey: globalKeys.orgModulEinstellungen(),
    queryFn: ladeOrgModulEinstellungen,
  });

  // KEIN `onError`-Toast mehr (LFH-345 · C10, H14): der Fehler hängt an `mutation.error` und
  // wird als `<SpeicherFehler>` gerendert. Ein Toast verfällt nach ~3 s, das ausgefüllte
  // Formular stand danach unverändert da und wirkte gespeichert.
  const speichernMutation = useMutation({
    mutationFn: (felder: Parameters<typeof speichereOrgEinstellungen>[0]) =>
      speichereOrgEinstellungen(felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgEinstellungen() });
      message.success('Einstellungen gespeichert');
    },
  });

  const modulMutation = useMutation({
    mutationFn: (vars: { modulKey: string; rolle: 'admin' | 'fuehrungskraft' | null }) =>
      setzeOrgModulEinstellung(vars.modulKey, vars.rolle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgModulEinstellungen() });
      message.success('Modul-Default gespeichert');
    },
  });

  if (einstellungenQuery.isLoading || modulQuery.isLoading) {
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
        // Der Knopf VERSCHWINDET nicht mehr (LFH-345 · C10, M16) — er steht gesperrt da, und
        // der Grund steht als `RechteHinweis` darunter. Ein fehlender Knopf ist von „diese
        // Seite kann das gar nicht" nicht zu unterscheiden.
        <Button
          type="primary"
          onClick={() => form.submit()}
          loading={speichernMutation.isPending}
          disabled={!istAdmin}
        >
          Speichern
        </Button>
      }
      hinweis={
        <SeitenHinweise
          fehler={speichernMutation.error ?? modulMutation.error}
          rechteFehlt={!istAdmin}
          rechteText="Nur Benutzer mit der Systemrolle „Admin“ dürfen die Org-Defaults ändern — die Werte stehen hier zum Nachlesen."
        />
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
          <InputNumber min={1} max={3650} style={{ width: '100%', maxWidth: 200 }} placeholder="keine" />
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
          <Input maxLength={8} placeholder="z. B. EB-" style={{ width: '100%', maxWidth: 200 }} />
        </Form.Item>
        <Form.Item
          label="Präfix Meldungen"
          name="meldung_nummer_praefix"
          tooltip="Wird der laufenden Meldungs-Nummer vorangestellt. Max. 8 Zeichen."
        >
          <Input maxLength={8} placeholder="z. B. M-" style={{ width: '100%', maxWidth: 200 }} />
        </Form.Item>
        <Form.Item
          label="Präfix Aufträge"
          name="auftrag_nummer_praefix"
          tooltip="Wird der laufenden Auftrags-Nummer vorangestellt. Max. 8 Zeichen."
        >
          <Input maxLength={8} placeholder="z. B. A-" style={{ width: '100%', maxWidth: 200 }} />
        </Form.Item>

        <Form.Item
          label="Default-Bestätigungsfrist Meldungen (Minuten)"
          name="meldung_bestaetigung_frist_min"
          tooltip="Frist für die Bestätigung pflichtiger Meldungen. Leer = kein Default."
        >
          <InputNumber min={1} max={10080} style={{ width: '100%', maxWidth: 200 }} placeholder="kein Default" />
        </Form.Item>
        <Form.Item
          label="Default-Quittierungsfrist Aufträge (Minuten)"
          name="auftrag_quittierung_frist_min"
          tooltip="Frist für unquittierte Aufträge ohne explizite Frist. Leer = kein Default."
        >
          <InputNumber min={1} max={10080} style={{ width: '100%', maxWidth: 200 }} placeholder="kein Default" />
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
      <div style={{ marginTop: token.marginXL }}>
        <SektionHeader
          titel="Modul-Rollen-Default"
          beschreibung="Org-weiter Default für die benötigte Rolle je Modul. Kann pro Einsatz überschrieben werden. Änderungen werden sofort gespeichert."
        />
      </div>

      <ModulEinstellungsListe
        rollenSpalte="Benötigte Rolle (Default)"
        rolleVon={(key) => orgModul[key] ?? ''}
        aufRolle={(modulKey, val) =>
          modulMutation.mutate({
            modulKey,
            rolle: (val || null) as 'admin' | 'fuehrungskraft' | null,
          })
        }
        darfVerwalten={istAdmin}
        laeuft={modulMutation.isPending}
      />
    </AdminPage>
  );
}
