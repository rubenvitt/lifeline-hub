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
import type { BenoetigteRolle, OrgEinstellungenUpdate } from '../../api/types';
import { Formularpaneel } from '../../components/instrument';
import KategorieVorgabenPaneel from './KategorieVorgabenPaneel';
import { mitVorgabe } from '../../components/vorgabeText';
import { NUR_ADMIN } from '../../components/nurAnsicht';

/** Vorgabe des Servers für ein leeres Einsatznummer-Präfix (`einsatz/nummer.rs`, `PRAEFIX_VORGABE`). */
const EINSATZ_PRAEFIX_VORGABE = 'E-';

/**
 * Form der Nummer eines neuen Einsatzes mit diesem Präfix — Spiegel von `einsatz/nummer.rs`,
 * `formatiere` (`<Präfix><JJJJ>-<NNNN>`). Rein und exportiert. Die Vorschau ersetzt den Satz „Steht
 * vor Jahr und laufender Nummer …“ (LFH-1078); „Neue Einsätze“ davor trägt die Folge, dass
 * bestehende Nummern bleiben. Die laufende Nummer bleibt offen („…“): der Server zählt je Org und
 * Jahr über alle Präfixe weiter (`einsatz/repo.rs`), eine „0001“ wäre meist falsch. Das Jahr ist
 * das des Geräts — der Server nimmt das der Org-Zeitzone, was nur in der Silvesternacht
 * auseinanderfällt.
 */
export function einsatznummerVorschau(praefix: string | null | undefined, jahr: number): string {
  return `${praefix?.trim() || EINSATZ_PRAEFIX_VORGABE}${jahr}-…`;
}

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
  // Vor den frühen Returns: ein Hook danach bräche die Hook-Reihenfolge.
  const einsatzPraefix = Form.useWatch('einsatz_nummer_praefix', form);

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
    mutationFn: (vars: { modulKey: string; rolle: BenoetigteRolle | null }) =>
      setzeOrgModulEinstellung(vars.modulKey, vars.rolle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.orgModulEinstellungen() });
      // Eine Org-Vorgabe wirkt auf die Freigaben JEDES Einsatzes der Org (LFH-669).
      qc.invalidateQueries({ queryKey: einsatzKeys.modulFreigabenAlle() });
      quittiereModulGespeichert(message, 'Modul-Vorgabe gespeichert');
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
      titel="Einsatz-Vorgaben"
      breite="schmal"
      hinweis={
        // Nur der Formular-Fehler. Die Modul-Liste speichert je Zeile sofort und trägt ihre
        // Ablehnung selbst (unten) — zwei Vorgänge in einem Kasten sagen nicht mehr, was
        // schiefging.
        <SeitenHinweise
          fehler={speichernMutation.error}
          rechteFehlt={!istAdmin}
          rechteText={NUR_ADMIN}
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
        <Formularpaneel titel="Aufbewahrung">
          <Form.Item label="Aufbewahrungs-Dauer (Tage)" name="retention_dauer_tage">
            <InputNumber
              min={1}
              max={3650}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder={mitVorgabe('keine Frist')}
            />
          </Form.Item>
          <Form.Item
            label="Skelett endgültig löschen nach (Tage ab Abschluss)"
            name="skelett_dauer_tage"
          >
            <InputNumber
              min={1}
              max={36500}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder={mitVorgabe('unbegrenzt')}
            />
          </Form.Item>
        </Formularpaneel>

        <KategorieVorgabenPaneel />

        <Formularpaneel titel="Verhalten & Automatik">
          <Form.Item
            label="Präfix Einsatznummer"
            name="einsatz_nummer_praefix"
            extra={`Neue Einsätze: ${einsatznummerVorschau(
              // Vor dem ersten Durchlauf des Formulars liefert `useWatch` noch nichts.
              einsatzPraefix === undefined ? einstellungen.einsatz_nummer_praefix : einsatzPraefix,
              new Date().getFullYear(),
            )}`}
          >
            <Input
              maxLength={8}
              placeholder={mitVorgabe(EINSATZ_PRAEFIX_VORGABE)}
              style={{ width: '100%', maxWidth: 200 }}
            />
          </Form.Item>
          <Form.Item label="Präfix ETB" name="etb_nummer_praefix">
            <Input maxLength={8} placeholder="z. B. EB-" style={{ width: '100%', maxWidth: 200 }} />
          </Form.Item>
          <Form.Item label="Präfix Meldungen" name="meldung_nummer_praefix">
            <Input maxLength={8} placeholder="z. B. M-" style={{ width: '100%', maxWidth: 200 }} />
          </Form.Item>
          <Form.Item label="Präfix Aufträge" name="auftrag_nummer_praefix">
            <Input maxLength={8} placeholder="z. B. A-" style={{ width: '100%', maxWidth: 200 }} />
          </Form.Item>

          <Form.Item
            label="Vorgabe-Bestätigungsfrist Meldungen (Minuten)"
            name="meldung_bestaetigung_frist_min"
          >
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder={mitVorgabe('5')}
            />
          </Form.Item>
          <Form.Item
            label="Vorgabe-Quittierungsfrist Aufträge (Minuten)"
            name="auftrag_quittierung_frist_min"
          >
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder={mitVorgabe('keine Frist')}
            />
          </Form.Item>
          <Form.Item label="Rückmeldefrist Einheiten (Minuten)" name="rueckmeldung_frist_min">
            <InputNumber
              min={1}
              max={10080}
              style={{ width: '100%', maxWidth: 200 }}
              placeholder={mitVorgabe('60')}
            />
          </Form.Item>

          <Form.Item
            label="Automatische ETB-Einträge"
            name="auto_etb_eintraege"
            valuePropName="checked"
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

      {/* ── Rollen-Vorgabe je Modul (Sofort-Speichern, kein Form-Feld) ── */}
      <div style={{ marginTop: token.marginXL }}>
        <Formularpaneel titel="Rollen-Vorgabe je Modul">
          {/* Die Ablehnung der Liste steht bei der Liste, nicht im Seitenkopf; mit der
              Zeilenmarke (`fehlerKey`) zeigen Text und Rand auf dieselbe Zeile. */}
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={modulMutation.error} />
          </div>

          <ModulEinstellungsListe
            rollenSpalte="Benötigte Rolle (Vorgabe)"
            rolleVon={(key) => orgModul[key] ?? ''}
            aufRolle={(modulKey, val) =>
              modulMutation.mutate({
                modulKey,
                rolle: (val || null) as BenoetigteRolle | null,
              })
            }
            darfVerwalten={istAdmin}
            rechteGrund={NUR_ADMIN}
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
        {/* Alt → neu als Werte, dazu genau EIN Satz zur Folge (LFH-1078): der nächste Lauf des
            Servers (spätestens 10 Minuten) löscht jedes danach fällige Skelett samt ETB. */}
        {rueckfrage && (
          <>
            <Typography.Paragraph>
              <strong>
                {einstellungen.skelett_dauer_tage != null
                  ? `${einstellungen.skelett_dauer_tage} Tage`
                  : 'unbegrenzt'}{' '}
                → {rueckfrage.skelett_dauer_tage} Tage
              </strong>{' '}
              ab Abschluss
            </Typography.Paragraph>
            <Typography.Paragraph>
              Abgelaufene Skelette werden binnen 10 Minuten samt ETB unwiderruflich gelöscht.
            </Typography.Paragraph>
          </>
        )}
      </Modal>
    </AdminPage>
  );
}
