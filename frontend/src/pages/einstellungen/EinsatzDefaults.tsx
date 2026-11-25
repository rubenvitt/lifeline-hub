import { App, Form, Input, Modal, Switch, Typography, theme } from 'antd';
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
import SpeicherKnopf from '../../components/SpeicherKnopf';
import {
  AenderungsstandProvider,
  useAenderungsstandMerken,
} from '../../components/aenderungsstand';
import VerlassenRueckfrage from '../../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../../components/useFormularVerlassenSchutz';
import {
  type FormWerteEinsatz,
  initialEinsatz,
  istSkelettVerkuerzung,
  normalisiereEinsatz,
  zuUpdate,
} from './orgEinstellungenForm';
import type {
  BenoetigteRolle,
  OrgEinstellungenUpdate,
  OrgModulEinstellungUpdate,
} from '../../api/types';
import { Feld, Formularpaneel } from '../../components/instrument';
import KategorieVorgabenPaneel from './KategorieVorgabenPaneel';
import { mitVorgabe } from '../../components/vorgabeText';
import { useStammdatenHerkunft, VOM_HUB_TEXT } from '../../instanz/herkunft';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { ZahlFeld } from '../../components/ZahlFeld';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';

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
 * Modul-Vorgaben (Sichtbarkeit und Rolle, LLH-1179). Bearbeiten nur `system_rolle=admin`. Der PUT ist
 * Vollersatz (Payload aus geladenen Daten + eigenen Feldern). Die Modul-Liste speichert je Zeile
 * sofort (eigene Mutation) und schickt dabei immer beide Felder der Zeile.
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
  const stand = useAenderungsstandMerken();
  const istAdmin = benutzer?.system_rolle === 'admin';
  // Org-Einstellungen vom Hub (LLH-1493): hier nur lesbar, der Hinweis nennt den Grund.
  const herkunft = useStammdatenHerkunft();
  const vomHub = herkunft.istVomHub('org_einstellungen', '');
  const darf = istAdmin && !vomHub;
  const schutz = useFormularVerlassenSchutz({ aktiv: darf });
  const [rueckfrage, setRueckfrage] = useState<OrgEinstellungenUpdate | null>(null);
  // Vor den frühen Returns: ein Hook danach bräche die Hook-Reihenfolge.
  const einsatzPraefix = Form.useWatch('einsatz_nummer_praefix', form);
  const ortungAn = Form.useWatch('ortung_im_einsatz', form);
  const { konventionen: konv } = useAnzeigeKonventionen();

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
    mutationFn: (vars: { modulKey: string; vorgabe: OrgModulEinstellungUpdate }) =>
      setzeOrgModulEinstellung(vars.modulKey, vars.vorgabe),
    // Die Mutation endet erst mit dem neuen Bestand: bis dahin bleibt die Zeile gesperrt. Sonst
    // schickte ein schneller zweiter Klick den alten Bestand der anderen Spalte mit und höbe etwa
    // eine eben gesetzte Ausblendung still wieder auf (LLH-1179).
    onSuccess: () => {
      quittiereModulGespeichert(message, 'Modul-Vorgabe gespeichert');
      return Promise.all([
        qc.invalidateQueries({ queryKey: globalKeys.orgModulEinstellungen() }),
        // Eine Org-Vorgabe wirkt auf die Freigaben JEDES Einsatzes der Org (LFH-669).
        qc.invalidateQueries({ queryKey: einsatzKeys.modulFreigabenAlle() }),
        // Der Editor „Module“ jedes Einsatzes liest dieselbe Vorgabe am Einsatz (LLH-1183).
        qc.invalidateQueries({ queryKey: einsatzKeys.modulVorgabenAlle() }),
      ]);
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
  /**
   * Ohne geladenen Bestand bleibt die Liste gesperrt: der PUT schickt beide Felder einer Zeile, und
   * ein erfundener Bestand (sichtbar, frei) höbe sonst eine Ausblendung oder Rolle still auf.
   */
  // Bezieht die Org ihre Stammdaten aus einer Kopplung, führt der Hub auch die Modul-Vorgaben.
  const modulVomHub = herkunft.quelle != null;
  const modulVerwaltbar = istAdmin && !modulVomHub && !modulQuery.isError;
  /** Die Zeile mit einem geänderten Feld, das andere aus dem Bestand. */
  const modulVorgabe = (
    modulKey: string,
    aenderung: Partial<OrgModulEinstellungUpdate>,
  ): OrgModulEinstellungUpdate => ({
    benoetigte_rolle: (orgModul[modulKey]?.benoetigte_rolle ?? null) as BenoetigteRolle | null,
    sichtbar: orgModul[modulKey]?.sichtbar ?? true,
    ...aenderung,
  });

  function absenden(daten: OrgEinstellungenUpdate) {
    const fassung = schutz.fassung();
    // Stand beim Absenden; die Rückfrage zur Skelett-Dauer sperrt die Eingabe bis dahin.
    const gesendet = form.getFieldsValue(true);
    speichernMutation.mutate(daten, {
      onSuccess: () => {
        schutz.gespeichert(fassung);
        stand.merke(gesendet);
      },
    });
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
          rechteFehlt={!darf}
          rechteText={vomHub ? `${VOM_HUB_TEXT}.` : NUR_ADMIN}
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
        disabled={!darf}
      >
        <AenderungsstandProvider
          ausgangswerte={initialEinsatz(einstellungen)}
          merkeRef={stand.merkeRef}
        >
          <Formularpaneel titel="Aufbewahrung">
            <Feld breite="schmal" label="Aufbewahrungs-Dauer (Tage)" name="retention_dauer_tage">
              <ZahlFeld min={1} max={3650} placeholder={mitVorgabe('keine Frist')} />
            </Feld>
            <Feld
              breite="schmal"
              label="Skelett endgültig löschen nach (Tage ab Abschluss)"
              name="skelett_dauer_tage"
            >
              <ZahlFeld min={1} max={36500} placeholder={mitVorgabe('unbegrenzt')} />
            </Feld>
            <Feld
              breite="schmal"
              label="Nachbereitung (Tage ab Abschluss)"
              name="nachbereitung_tage"
            >
              <ZahlFeld min={1} max={3650} placeholder={mitVorgabe('keine')} />
            </Feld>
          </Formularpaneel>

          <KategorieVorgabenPaneel />

          <Formularpaneel titel="Verhalten & Automatik">
            <Feld
              breite="schmal"
              label="Präfix Einsatznummer"
              name="einsatz_nummer_praefix"
              extra={`Neue Einsätze: ${einsatznummerVorschau(
                // Vor dem ersten Durchlauf des Formulars liefert `useWatch` noch nichts.
                einsatzPraefix === undefined
                  ? einstellungen.einsatz_nummer_praefix
                  : einsatzPraefix,
                new Date().getFullYear(),
              )}`}
            >
              <Input maxLength={8} placeholder={mitVorgabe(EINSATZ_PRAEFIX_VORGABE)} />
            </Feld>
            <Feld breite="schmal" label="Präfix ETB" name="etb_nummer_praefix">
              <Input maxLength={8} placeholder="z. B. EB-" />
            </Feld>
            <Feld breite="schmal" label="Präfix Meldungen" name="meldung_nummer_praefix">
              <Input maxLength={8} placeholder="z. B. M-" />
            </Feld>
            <Feld breite="schmal" label="Präfix Aufträge" name="auftrag_nummer_praefix">
              <Input maxLength={8} placeholder="z. B. A-" />
            </Feld>

            <Feld
              breite="schmal"
              label="Vorgabe-Bestätigungsfrist Meldungen (Minuten)"
              name="meldung_bestaetigung_frist_min"
            >
              <ZahlFeld min={1} max={10080} placeholder={mitVorgabe('5')} />
            </Feld>
            <Feld
              breite="schmal"
              label="Vorgabe-Quittierfrist Aufträge (Minuten)"
              name="auftrag_quittierung_frist_min"
            >
              <ZahlFeld min={1} max={10080} placeholder={mitVorgabe('keine Frist')} />
            </Feld>
            <Feld
              breite="schmal"
              label="Rückmeldefrist Einheiten (Minuten)"
              name="rueckmeldung_frist_min"
            >
              <ZahlFeld min={1} max={10080} placeholder={mitVorgabe('60')} />
            </Feld>

            <Feld
              label="Automatische ETB-Einträge"
              name="auto_etb_eintraege"
              valuePropName="checked"
            >
              <Switch />
            </Feld>
          </Formularpaneel>

          {/* Helfer-App: Einschalten nur über den Bestätigungsdialog (Spec
              2026-11-24-vakwvkpg, „Ortung der Organisation“); der Server hält fest, wer wann. */}
          <Formularpaneel titel="Ortung">
            <Feld
              label="Ortung im Einsatz"
              name="ortung_im_einsatz"
              valuePropName="checked"
              extra={
                einstellungen.ortung_im_einsatz && einstellungen.ortung_bestaetigt_at
                  ? `Eingeschaltet und bestätigt ${zeitKurz(einstellungen.ortung_bestaetigt_at, konv)}`
                  : 'Helfende melden ihre Position über die Helfer-App.'
              }
            >
              <OrtungSchalter onAus={() => form.setFieldValue('ortung_personen', false)} />
            </Feld>
            <Feld label="Auch Personen orten" name="ortung_personen" valuePropName="checked">
              <Switch disabled={!darf || !ortungAn} />
            </Feld>
          </Formularpaneel>

          {/* Ohne Recht steht der Knopf gesperrt da, der Grund als `RechteHinweis` im Kopf. */}
          <div {...speicherLeiste}>
            <SpeicherKnopf loading={speichernMutation.isPending} disabled={!darf} />
          </div>
        </AenderungsstandProvider>
      </Form>

      {/* ── Module für alle Einsätze (Sofort-Speichern, kein Form-Feld) ── */}
      <div style={{ marginTop: token.marginXL }}>
        <Formularpaneel titel="Module für alle Einsätze">
          {/* Die Ablehnung der Liste steht bei der Liste, nicht im Seitenkopf; mit der
              Zeilenmarke (`fehlerKey`) zeigen Text und Rand auf dieselbe Zeile. */}
          <div style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={modulMutation.error} />
          </div>
          {/* Die Folge, die keine Oberfläche zeigt: ein laufender Einsatz ändert sich mit
              (Herleitung LLH-1116, Risiken). */}
          <Typography.Paragraph type="secondary" style={{ marginBottom: token.marginSM }}>
            Wirkt auf alle Einsätze ohne eigene Einstellung, auch auf laufende.
          </Typography.Paragraph>

          <ModulEinstellungsListe
            rollenSpalte="Benötigte Rolle (Vorgabe)"
            rolleVon={(key) => orgModul[key]?.benoetigte_rolle ?? ''}
            aufRolle={(modulKey, val) =>
              modulMutation.mutate({
                modulKey,
                vorgabe: modulVorgabe(modulKey, {
                  benoetigte_rolle: (val || null) as BenoetigteRolle | null,
                }),
              })
            }
            sichtbarSpalte={{
              titel: 'Sichtbar',
              sichtbarVon: (key) => orgModul[key]?.sichtbar ?? true,
              aufSichtbar: (modulKey, sichtbar) =>
                modulMutation.mutate({ modulKey, vorgabe: modulVorgabe(modulKey, { sichtbar }) }),
            }}
            darfVerwalten={modulVerwaltbar}
            rechteGrund={
              !istAdmin ? NUR_ADMIN : modulVomHub ? VOM_HUB_TEXT : 'Vorgaben nicht ladbar'
            }
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

/** Wortlaut der Bestätigung beim Einschalten der Ortung (Spec 2026-11-24-vakwvkpg). */
const ORTUNG_EINWILLIGUNG =
  'Ich bestätige, dass für diese Organisation eine Einwilligung der Helfenden bzw. eine Betriebsvereinbarung vorliegt.';

interface OrtungSchalterProps {
  id?: string;
  checked?: boolean;
  onChange?: (an: boolean) => void;
  /** Läuft beim Ausschalten mit, etwa um „Auch Personen orten“ mitzunehmen. */
  onAus: () => void;
}

/**
 * Schalter „Ortung im Einsatz“ als Formularfeld: Einschalten öffnet erst den Dialog, nur
 * „Bestätigen“ setzt den Wert. Ausschalten geht ohne Rückfrage. Gesperrt wird er über das
 * Formular (`disabled` am `Form`).
 */
function OrtungSchalter({ id, checked, onChange, onAus }: OrtungSchalterProps) {
  const [frage, setFrage] = useState(false);
  return (
    <>
      <Switch
        id={id}
        checked={checked}
        onChange={(an) => {
          if (an) {
            setFrage(true);
            return;
          }
          onChange?.(false);
          onAus();
        }}
      />
      <Modal
        open={frage}
        title="Ortung im Einsatz einschalten?"
        okText="Bestätigen"
        cancelText="Abbrechen"
        onOk={() => {
          onChange?.(true);
          setFrage(false);
        }}
        onCancel={() => setFrage(false)}
        destroyOnHidden
      >
        <Typography.Paragraph>{ORTUNG_EINWILLIGUNG}</Typography.Paragraph>
      </Modal>
    </>
  );
}
