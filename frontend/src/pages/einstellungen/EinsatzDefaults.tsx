import { App, Button, Form, Input, InputNumber, Modal, Switch, Typography, theme } from 'antd';
import { useState } from 'react';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import ModulEinstellungsListe from './ModulEinstellungsListe';
import { quittiereModulGespeichert } from './modulQuittung';
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
import { einsatzKeys, globalKeys, istRueckmeldungenKey } from '../../api/queryKeys';
import { useSpeicherLeiste } from '../../components/speicherLeiste';
import VerlassenRueckfrage from '../../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../../components/useFormularVerlassenSchutz';
import {
  type FormWerteEinsatz,
  initialEinsatz,
  istSkelettVerkuerzung,
  normalisiereEinsatz,
  zuUpdate,
} from './orgEinstellungenForm';
import type { OrgEinstellungenUpdate } from '../../api/types';
import { Formularpaneel } from '../../components/instrument';
import KategorieVorgabenPaneel from './KategorieVorgabenPaneel';

/** Satz des `RechteHinweis` — zugleich die lange Begründung an jeder gesperrten Modulzeile. */
const RECHTE_TEXT =
  'Nur Benutzer mit der Systemrolle „Admin“ dürfen die Org-Defaults ändern — die Werte stehen hier zum Nachlesen.';

/**
 * Admin-Sektion `/admin/einstellungen/einsatz` — Aufbewahrung, Nummernkreise, Fristen, Auto-ETB +
 * Modul-Rollen-Default. Bearbeiten nur `system_rolle=admin`. Der PUT ist Vollersatz (Payload aus
 * geladenen Daten + eigenen Feldern). Die Modul-Rollen-Selects speichern sofort (eigene Mutation).
 *
 * Die ungespeicherte Fassung führt der Verlassen-Schutz der Formularseiten
 * (`components/useFormularVerlassenSchutz.ts`, LFH-979): Rückfrage vor dem Verlassen und Warnung
 * beim Schließen. Die Modul-Liste speichert je Zeile sofort und zählt nicht dazu.
 *
 * Skelett-Frist (LFH-750): erstmaliges Setzen und Verkürzen fragen VOR dem Absenden zurück, erst
 * dann geht `skelett_dauer_bestaetigt: true` hinaus (der Server lehnt sonst mit 409 ab). Eine
 * kontrollierte `Modal` wie in `aufbewahrung/FristPaneel.tsx`, kein `modal.confirm`.
 */
export default function EinsatzDefaults() {
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerteEinsatz>();
  const { token } = theme.useToken();
  const speicherLeiste = useSpeicherLeiste();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const schutz = useFormularVerlassenSchutz({ aktiv: istAdmin });
  const [rueckfrage, setRueckfrage] = useState<OrgEinstellungenUpdate | null>(null);

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
      message.success('Einstellungen gespeichert');
    },
  });

  const modulMutation = useMutation({
    mutationFn: (vars: { modulKey: string; rolle: 'admin' | 'fuehrungskraft' | null }) =>
      setzeOrgModulEinstellung(vars.modulKey, vars.rolle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgModulEinstellungen() });
      // Eine Org-Vorgabe wirkt auf die Freigaben JEDES Einsatzes der Org (LFH-669).
      qc.invalidateQueries({ queryKey: einsatzKeys.modulFreigabenAlle() });
      quittiereModulGespeichert(message, 'Modul-Default gespeichert');
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

  function absenden(daten: OrgEinstellungenUpdate) {
    const fassung = schutz.fassung();
    speichernMutation.mutate(daten, { onSuccess: () => schutz.gespeichert(fassung) });
  }

  function speichern(werte: FormWerteEinsatz) {
    const daten = { ...zuUpdate(einstellungen), ...normalisiereEinsatz(werte) };
    if (istSkelettVerkuerzung(einstellungen.skelett_dauer_tage, daten.skelett_dauer_tage)) {
      setRueckfrage(daten);
      return;
    }
    absenden(daten);
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
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <Form<FormWerteEinsatz>
        form={form}
        layout="vertical"
        initialValues={initialEinsatz(einstellungen)}
        onFinish={speichern}
        onValuesChange={schutz.geaendert}
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
          <Form.Item
            label="Skelett endgültig löschen nach (Tage ab Abschluss)"
            name="skelett_dauer_tage"
            tooltip="1 bis 36500 Tage. Nach der Schwärzung bleibt ein pseudonymes Skelett (ETB, Registriernummern, Kategorien); nach dieser Frist wird es samt ETB endgültig gelöscht, frühestens mit der Schwärzung. Gilt für alle Einsätze der Organisation. Leer = das Skelett bleibt unbegrenzt erhalten."
          >
            <InputNumber
              min={1}
              max={36500}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder="unbegrenzt"
            />
          </Form.Item>
        </Formularpaneel>

        <KategorieVorgabenPaneel />

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
        <div {...speicherLeiste}>
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
      <Modal
        open={rueckfrage != null}
        title="Skelett-Frist bestätigen?"
        okText="Skelette löschen lassen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => {
          if (rueckfrage) absenden({ ...rueckfrage, skelett_dauer_bestaetigt: true });
          setRueckfrage(null);
        }}
        onCancel={() => setRueckfrage(null)}
        destroyOnHidden
      >
        {rueckfrage && (
          <Typography.Paragraph>
            Die Skelett-Frist wird von{' '}
            <strong>
              {einstellungen.skelett_dauer_tage != null
                ? `${einstellungen.skelett_dauer_tage} Tagen`
                : 'unbegrenzt'}
            </strong>{' '}
            auf <strong>{rueckfrage.skelett_dauer_tage} Tage</strong> ab Abschluss gesetzt. Jedes
            geschwärzte Skelett, dessen Frist danach abgelaufen ist, wird mit dem nächsten
            Purge-Lauf (spätestens in 10 Minuten) samt ETB unwiderruflich gelöscht. Nur eine Zeile
            im Löschprotokoll bleibt.
          </Typography.Paragraph>
        )}
      </Modal>
    </AdminPage>
  );
}
