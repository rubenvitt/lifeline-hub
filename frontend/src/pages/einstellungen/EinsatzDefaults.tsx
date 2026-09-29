import { App, Button, Form, Input, InputNumber, Switch, theme } from 'antd';
import { useEffect, useState } from 'react';
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
import { SeitenHinweise, SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAuth } from '../../auth/AuthContext';
import { globalKeys, istRueckmeldungenKey } from '../../api/queryKeys';
import { speicherLeisteStil } from '../../components/speicherLeiste';
import {
  type FormWerteEinsatz,
  initialEinsatz,
  normalisiereEinsatz,
  zuUpdate,
} from './orgEinstellungenForm';
import { Formularpaneel } from '../../components/instrument';

/** Satz des `RechteHinweis` — zugleich die lange Begründung an jeder gesperrten Modulzeile. */
const RECHTE_TEXT =
  'Nur Benutzer mit der Systemrolle „Admin“ dürfen die Org-Defaults ändern — die Werte stehen hier zum Nachlesen.';

/**
 * Admin-Sektion `/admin/einstellungen/einsatz` — Aufbewahrung, Nummernkreise, Fristen, Auto-ETB +
 * Modul-Rollen-Default. Bearbeiten nur `system_rolle=admin`. Der PUT ist Vollersatz (Payload aus
 * geladenen Daten + eigenen Feldern). Die Modul-Rollen-Selects speichern sofort (eigene Mutation).
 *
 * Die ungespeicherte Fassung ist ein eigener State, nicht `form.isFieldsTouched()`: antd setzt das
 * Flag beim Speichern nicht zurück.
 */
export default function EinsatzDefaults() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteEinsatz>();
  const { token } = theme.useToken();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const [hatFassung, setHatFassung] = useState(false);

  const einstellungenQuery = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
  });

  const modulQuery = useQuery({
    queryKey: globalKeys.orgModulEinstellungen(),
    queryFn: ladeOrgModulEinstellungen,
  });

  // Kein `onError`-Toast: der Fehler steht als `<SpeicherFehler>` da. Ein Toast verfiele, und das
  // ausgefüllte Formular wirkte gespeichert.
  const speichernMutation = useMutation({
    mutationFn: (felder: Parameters<typeof speichereOrgEinstellungen>[0]) =>
      speichereOrgEinstellungen(felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgEinstellungen() });
      // Die Org-Rückmeldefrist steckt im `faellig_at` jedes Einsatzes ohne eigene.
      qc.invalidateQueries({ predicate: (q) => istRueckmeldungenKey(q.queryKey) });
      setHatFassung(false);
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

  // Ungespeicherte Fassung (siehe Dateikopf): gesetzt bei jeder Feldänderung, zurückgesetzt beim
  // erfolgreichen Speichern.
  useEffect(() => {
    if (!hatFassung) return;
    // `preventDefault()` allein ist der heutige Weg — `returnValue` ist abgekündigt.
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hatFassung]);

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
    speichernMutation.mutate({ ...zuUpdate(einstellungen), ...normalisiereEinsatz(werte) });
  }

  return (
    <AdminPage
      titel="Einsatz-Defaults"
      breite="schmal"
      beschreibung="Org-weite Defaults für neue Einsätze. Einsatzspezifische Einstellungen überschreiben diese Werte."
      hinweis={
        // Nur der Formular-Fehler. Die Modul-Liste speichert je Zeile sofort und trägt ihre
        // Ablehnung selbst (unten) — zwei Vorgänge in einem Kasten sagen nicht mehr, was
        // schiefging.
        <SeitenHinweise
          fehler={speichernMutation.error}
          rechteFehlt={!istAdmin}
          rechteText={RECHTE_TEXT}
        />
      }
    >
      <Form<FormWerteEinsatz>
        form={form}
        layout="vertical"
        initialValues={initialEinsatz(einstellungen)}
        onFinish={speichern}
        onValuesChange={() => setHatFassung(true)}
        disabled={!istAdmin}
      >
        <Formularpaneel
          titel="Aufbewahrung"
          beschreibung="Default-Aufbewahrungs-Dauer für neue Einsätze. Leer = keine automatische Frist."
        >
          <Form.Item
            label="Aufbewahrungs-Dauer (Tage)"
            name="retention_dauer_tage"
            tooltip="1 bis 3650 Tage. Leer = keine automatische Aufbewahrungsfrist."
          >
            <InputNumber
              min={1}
              max={3650}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="keine"
            />
          </Form.Item>
        </Formularpaneel>

        <Formularpaneel
          titel="Verhalten & Automatik"
          beschreibung="Nummernkreis-Präfixe und Default-Fristen für neue Einsätze. Das Präfix der Einsatznummer wird beim Anlegen fest in die Nummer übernommen; die übrigen Präfixe sind reine Anzeige. Leer = kein Default (hartkodierter Fallback)."
        >
          <Form.Item
            label="Präfix Einsatznummer"
            name="einsatz_nummer_praefix"
            tooltip="Steht vor Jahr und laufender Nummer (z. B. E-2026-0001). Gilt nur für neu angelegte Einsätze — bestehende Nummern ändern sich nicht. Leer = E-. Max. 8 Zeichen."
          >
            <Input maxLength={8} placeholder="E-" style={{ width: '100%', maxWidth: 200 }} />
          </Form.Item>
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
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="kein Default"
            />
          </Form.Item>
          <Form.Item
            label="Default-Quittierungsfrist Aufträge (Minuten)"
            name="auftrag_quittierung_frist_min"
            tooltip="Frist für unquittierte Aufträge ohne explizite Frist. Leer = kein Default."
          >
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="kein Default"
            />
          </Form.Item>
          <Form.Item
            label="Rückmeldefrist Einheiten (Minuten)"
            name="rueckmeldung_frist_min"
            tooltip="Nach so vielen Minuten ohne neue Meldung gilt eine Einheit im Meldebild als überfällig. Leer = 60."
          >
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="60"
            />
          </Form.Item>

          <Form.Item
            label="Automatische ETB-Einträge"
            name="auto_etb_eintraege"
            valuePropName="checked"
            tooltip="Meldungen und Aufträge erzeugen automatisch einen verknüpften ETB-Eintrag."
          >
            <Switch />
          </Form.Item>
        </Formularpaneel>

        {/* Ohne Recht steht der Knopf gesperrt da, der Grund als `RechteHinweis` im Kopf. */}
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

      {/* ── Modul-Rollen-Default (Sofort-Speichern, kein Form-Feld) ── */}
      <div style={{ marginTop: token.marginXL }}>
        <Formularpaneel
          titel="Modul-Rollen-Default"
          beschreibung="Org-weiter Default für die benötigte Rolle je Modul. Kann pro Einsatz überschrieben werden. Änderungen werden sofort gespeichert."
        >
          {/* Die Ablehnung der Liste steht bei der Liste, nicht im Seitenkopf; mit der
              Zeilenmarke (`fehlerKey`) zeigen Text und Rand auf dieselbe Zeile. */}
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={modulMutation.error} />
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
            rechteGrund={{ kurz: 'nur Admins', lang: RECHTE_TEXT }}
            // Nur die schreibende Zeile ist gesperrt, nur die gescheiterte markiert. `variables`
            // trägt die laufende bzw. zuletzt gescheiterte Zeile.
            laeuftKey={modulMutation.isPending ? modulMutation.variables.modulKey : null}
            fehlerKey={modulMutation.isError ? modulMutation.variables.modulKey : null}
          />
        </Formularpaneel>
      </div>
    </AdminPage>
  );
}
