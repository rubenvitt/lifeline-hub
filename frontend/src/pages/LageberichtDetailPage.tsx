import { App, Breadcrumb, Button, Form, Input, Space, Spin, Typography, theme } from 'antd';
import { useZumEtbEintrag } from '../etb/useZumEtbEintrag';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { parseRouteId, lageberichtePfad, lageberichtDetailPfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import {
  aktualisiereLagebericht,
  gibLageberichtFrei,
  ladeLagebericht,
  schreibeLageberichtFort,
} from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtAnzeige } from '../api/types';
import { vorlage } from '../lageberichte/vorlagen';
import LageberichtText from '../lageberichte/LageberichtText';
import DokumentEntwurf, { type AbschnittAktion } from '../entwurf/DokumentEntwurf';
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import FormularEingehaengt from '../components/FormularEingehaengt';
import AbschnittUebernahme from '../lageberichte/AbschnittUebernahme';
import LeereAbschnitteFuellen from '../lageberichte/LeereAbschnitteFuellen';
import UebernahmeStand from '../lageberichte/UebernahmeStand';
import {
  UEBERNOMMEN_FIELD,
  standFeld,
  verwerfeStandGeleerter,
  type Staende,
} from '../lageberichte/standFeld';
import { UEBERNAHMEN, uebernahmeFuer } from '../lageberichte/uebernahmen';
import { einstiegsAbschnitt } from '../entwurf/Einstiegsfokus';
import FreigabeDialog from '../entwurf/FreigabeDialog';
import EntwurfNavigationSchutz from '../entwurf/EntwurfNavigationSchutz';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { LAGEBERICHT_STATUS, StatusBadge } from '../kommunikation';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import { useDruckNebenwege } from '../components/druck/useDruckNebenwege';
import DokumentAnlagen from '../entwurf/DokumentAnlagen';
import {
  VerteilerAnzeige,
  VerteilerField,
  useVerteilerSources,
  useVerteilerSync,
} from '../entwurf/VerteilerField';
import {
  VERTEILER_FIELD,
  verteilerDruckzeile,
  verteilerNames,
  verteilerNamesFromForm,
  type VerteilerFormValues,
} from '../entwurf/verteilerKern';
import { Paneel, monoStil } from '../components/instrument';
import './lageberichtPrint.css';

/**
 * Formularwerte des Entwurfs: Titel, Zeitstand (Zeitpunkt, die Anzeigezone nur im Feld, UTC erst
 * beim Senden — `anzeige/zeitEingabe.ts`), je Abschnitt der Markdown-Text unter seinem Schlüssel,
 * der Verteiler (LLH-1172) und je Abschnitt mit Quelle der Stand der Übernahme (LLH-1357). Kein
 * Abschnitt heißt `titel`, `verteiler` oder `uebernommen_at` (`entwurf/verteilerField.guard.test.ts`,
 * `lageberichte/standFeld.test.ts`).
 */
type FormWerte = {
  titel: string;
  zeitstand?: Dayjs;
  [VERTEILER_FIELD]?: VerteilerFormValues;
  [UEBERNOMMEN_FIELD]?: Staende;
} & Record<string, string | Dayjs | VerteilerFormValues | Staende | undefined>;

export default function LageberichtDetailPage() {
  const { lbId } = useParams();
  // Remount je Bericht: der Verlustschutz-Merker gehört zu einem Datensatz. Ohne den Key trüge ein
  // Routenwechsel auf dieselbe Komponente (Fortschreiben → neuer Entwurf) den Riegel des alten
  // Berichts mit und hielte den neuen Serverstand fern.
  return <LageberichtDetail key={lbId} />;
}

function LageberichtDetail() {
  const { id, lbId } = useParams();
  const einsatzId = Number(id);
  const berichtId = Number(lbId);
  const idGueltig = parseRouteId(lbId) != null;
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormWerte>();
  const { token } = theme.useToken();
  /**
   * Nur die Felder beobachten, die den Druckkopf speisen (LFH-731) — nicht alle Werte: sonst
   * rendert die ganze Seite je Anschlag in einem Abschnitt neu. Die Leer-Marke der Abschnitte
   * beobachtet `DokumentEntwurf` selbst (LLH-1074, Messung `e2e/lagebericht-tippen.spec.ts`).
   */
  const titelWert = Form.useWatch('titel', form) as unknown;
  const zeitstandWert = Form.useWatch('zeitstand', form) as unknown;
  const formVerteiler = Form.useWatch(VERTEILER_FIELD, form) as VerteilerFormValues | undefined;

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichtQuery = useQuery({
    queryKey: einsatzKeys.lagebericht(einsatzId, berichtId),
    queryFn: () => ladeLagebericht(einsatzId, berichtId),
    enabled: idGueltig,
  });
  // Als Primitiv für die Übernahme im Abschnittskopf (Zuordnung je Vorlage, LFH-870), vor den
  // frühen Rückgaben (Hook-Reihenfolge).
  const vorlageKey = berichtQuery.data?.vorlage;
  // Ab hier gilt ein Stand der Übernahme als „aus der Vorfassung“ (LLH-1357,
  // `lageberichte/standFeld.ts:isAusVorfassung`): das Anlegen der Fortschreibung. Primitiv
  // für die `aktion` (Render-Zähler-Gate).
  const standGrenze =
    berichtQuery.data?.vorgaenger_id != null ? berichtQuery.data.erstellt_at : undefined;
  // Nebenwege des Kopfes (LFH-1079), als Hooks vor den frühen Rückgaben. Der Sprung nur am
  // freigegebenen Bericht: ein Entwurf hat noch keinen ETB-Eintrag.
  const etbSprung = useZumEtbEintrag(
    einsatzId,
    berichtQuery.data?.status === 'entwurf' ? null : berichtQuery.data?.etb_eintrag_id,
  );
  const druckWege = useDruckNebenwege();
  // Optionen des Verteilers (LLH-1172), nur im Entwurf mit Schreibrecht geladen.
  const verteilerQuellen = useVerteilerSources(
    einsatzId,
    berichtQuery.data?.status === 'entwurf' && einsatzQuery.data != null
      ? darfImEinsatzSchreiben(einsatzQuery.data)
      : false,
  );
  const verteilerSync = useVerteilerSync(verteilerQuellen);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.lagebericht(einsatzId, berichtId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
  };

  // Persistiert die Formularwerte als Entwurf (ohne Erfolgs-Toast); geteilt von „Entwurf speichern"
  // und dem Freigabe-Flow.
  const speichern = (werte: FormWerte) => {
    const v = vorlage(berichtQuery.data!.vorlage)!;
    const staende = werte[UEBERNOMMEN_FIELD];
    const abschnitte: LageberichtAbschnitt[] = v.abschnitte.map((a) => {
      const text = werte[a.schluessel];
      const stand = staende?.[a.schluessel];
      return {
        schluessel: a.schluessel,
        text: typeof text === 'string' ? text : '',
        // Der Stand der Übernahme reist im Abschnitt (LLH-1357); fehlt er, war es Text von Hand.
        ...(stand ? { uebernommen_at: stand } : {}),
      };
    });
    // Der Verteiler nur bei einer Änderung und innerhalb der Grenzen (`useVerteilerSync`, LLH-1172).
    const { verteiler, settle } = verteilerSync.forPatch(
      werte[VERTEILER_FIELD],
      berichtQuery.data!.verteiler,
    );
    return aktualisiereLagebericht(einsatzId, berichtId, {
      titel: werte.titel,
      ...(verteiler ? { verteiler } : {}),
      // Leer gelassen → Feld nicht mitschicken; das Backend behält den Bestandswert.
      ...(werte.zeitstand ? { zeitstand: alsBackendZeit(werte.zeitstand) } : {}),
      abschnitte,
    }).then(
      (antwort) => {
        settle(true);
        return antwort;
      },
      (fehler: unknown) => {
        // Die Basis des Verteilers rückt nur bei Erfolg endgültig vor (`useVerteilerSync`).
        settle(false);
        throw fehler;
      },
    );
  };

  /**
   * Riegel gegen den Fremd-Refetch, Autosave (30 s + Blur) und Reload-Warner — derselbe Hook wie in
   * `BefehlDetailPage`, Begründungen in `entwurf/useEntwurfVerlustschutz.ts`. Nicht
   * `isFieldsTouched()`: das fällt nach dem Speichern nie zurück.
   */
  const schutz = useEntwurfVerlustschutz<LageberichtAnzeige, FormWerte>({
    daten: berichtQuery.data,
    istEntwurf: berichtQuery.data?.status === 'entwurf',
    form,
    werteAus: (b) => {
      const werte: FormWerte = {
        titel: b.titel,
        zeitstand: alsZeitpunkt(b.zeitstand),
        [VERTEILER_FIELD]: verteilerSync.fromServer(
          b.verteiler,
          form.getFieldValue(VERTEILER_FIELD),
        ),
      };
      // Jeder Schlüssel ausdrücklich, auch ohne Stand: `setFieldsValue` mischt verschachtelte
      // Werte, ein fehlender Schlüssel ließe einen alten Stand im Formular stehen.
      const staende: Staende = {};
      for (const a of b.abschnitte) {
        werte[a.schluessel] = a.text;
        staende[a.schluessel] = a.uebernommen_at ?? undefined;
      }
      werte[UEBERNOMMEN_FIELD] = staende;
      return werte;
    },
    speichern,
    onGespeichert: invalidate,
  });

  // Stabil (`useCallback` im Hook): die Übernahmen in Abschnitte melden ihre Änderung darüber.
  const { markiereGeaendert } = schutz;
  /**
   * Die Aktion im Kopf eines Abschnitts (LFH-870): Abschnitte des Lagevortrags aus vorhandenen
   * Lagedaten (Medienlage seit LFH-554, Eigene Lage, LFH-869). Der Baustein prüft die Freigabe
   * seiner Quelle selbst; er steht nur im Schreibzweig, denn nur dort gibt es den Editor. Darunter
   * der Stand der Übernahme (LLH-1357): nur an Abschnitten mit Quelle, als Feld eingehängt, damit
   * er mitgespeichert wird.
   * `useCallback`, nicht inline: eine neue Funktionsidentität je Render höbe die `memo`-Sperre
   * jedes Abschnitts auf — ohne Fehlerbild, nur langsam (Render-Zähler in
   * `entwurf/DokumentEntwurf.test.tsx`).
   */
  const uebernahme = useCallback<AbschnittAktion>(
    (a) => {
      const quelle = vorlageKey ? uebernahmeFuer(vorlageKey, a.schluessel) : undefined;
      return quelle ? (
        <>
          <AbschnittUebernahme
            quelle={quelle}
            einsatzId={einsatzId}
            form={form}
            feld={a.schluessel}
            onGeaendert={markiereGeaendert}
          />
          <Form.Item name={standFeld(a.schluessel)} noStyle>
            <UebernahmeStand grenze={standGrenze} />
          </Form.Item>
        </>
      ) : null;
    },
    [einsatzId, form, markiereGeaendert, vorlageKey, standGrenze],
  );

  /**
   * Ein Klick, ein PATCH: der Klick blurrt zuerst das Feld, der Blur-Autosave ist schon unterwegs,
   * und `speichereJetzt` hängt sich an ihn an. Quittung, Zeitstempel und `invalidate` liegen im
   * Hook; hier bleibt der Erfolgs-Toast.
   *
   * Kein `onError`: `speichereJetzt` legt den Grund in `speicherFehler` ab, der Alert steht oben
   * auf der Seite. Ein Toast daneben wäre eine zweite Wahrheit, die nach drei Sekunden geht.
   */
  const speichernMutation = useMutation({
    mutationFn: (werte: FormWerte) => schutz.speichereJetzt(werte),
    onSuccess: () => message.success('Entwurf gespeichert'),
  });

  /**
   * Die validierten Werte des Freigabe-Versuchs und zugleich der Auf-Zu-Zustand des Dialogs (`!==
   * null` heißt offen). So kann der Dialog nicht ohne die Werte stehen, mit denen er gespeichert
   * werden soll.
   */
  const [freigabeWerte, setFreigabeWerte] = useState<FormWerte | null>(null);

  /**
   * Kein `onError`: der Grund steht als `freigebenMutation.error` im Bestätigungsdialog, der bei
   * Ablehnung offen bleibt.
   */
  const freigebenMutation = useMutation({
    mutationFn: () => gibLageberichtFrei(einsatzId, berichtId),
    onSuccess: () => {
      invalidate();
      message.success('Bericht freigegeben');
    },
  });

  /**
   * Kein `onError`: der Grund steht über dem Inhalt, im Block des Speicherfehlers (LFH-1077,
   * `frontend/AGENTS.md`, „Rückwege und Fehler“), bis zum nächsten Versuch.
   */
  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeLageberichtFort(einsatzId, berichtId),
    onSuccess: (neu: LageberichtAnzeige) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
      navigate(lageberichtDetailPfad(einsatzId, neu.id));
    },
  });

  // Ungültige Lagebericht-ID → zurück zur Liste.
  if (!idGueltig) {
    return <Navigate to={lageberichtePfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || berichtQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (berichtQuery.isError || !berichtQuery.data || !einsatzQuery.data) {
    return <Typography.Text type="danger">Lagebericht nicht gefunden.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const bericht = berichtQuery.data;
  const v = vorlage(bericht.vorlage);
  // Quellen der Vorlage für die Sammelfüllung (LLH-1081); ohne Quellen kein Knopf.
  const quellen = UEBERNAHMEN[bericht.vorlage];
  const istEntwurf = bericht.status === 'entwurf';
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  /**
   * Druckkopf im Entwurf aus dem Formular (LFH-731): Titel- und Zeitstand-Feld sind im Druck
   * ausgeblendet, das Papier trägt beide nur noch im Kopf. Der gespeicherte Stand verlöre dort eine
   * ungespeicherte Änderung. Kein Speichern vor dem Druck: Strg+P läuft am `DruckKnopf` vorbei,
   * und ein Druck soll keinen PATCH auslösen. Vor dem Einhängen des Formulars (Felder leer) gilt
   * der Serverstand.
   */
  const schreibtEntwurf = istEntwurf && darfSchreiben;
  const druckTitel = schreibtEntwurf && typeof titelWert === 'string' ? titelWert : bericht.titel;
  const druckZeitstand =
    schreibtEntwurf && dayjs.isDayjs(zeitstandWert)
      ? alsBackendZeit(zeitstandWert)
      : bericht.zeitstand;
  // Ebenso der Verteiler (LLH-1172): im Entwurf aus dem Formular, sonst der gespeicherte Stand.
  const druckVerteiler =
    schreibtEntwurf && formVerteiler !== undefined
      ? verteilerNamesFromForm(formVerteiler, verteilerQuellen, bericht.verteiler)
      : verteilerNames(bericht.verteiler);

  const freigabeBestaetigen = async () => {
    // Pflichtfelder vor dem Dialog prüfen — sonst landet ein Titel-Fehler hinter dem Modal.
    let werte: FormWerte;
    try {
      werte = await form.validateFields();
    } catch {
      return; // Validierungsfehler werden am Formular angezeigt.
    }
    // Ein frisch geöffneter Dialog zeigt keinen alten Grund: react-query hält `error` bis zum
    // nächsten `mutate()`.
    freigebenMutation.reset();
    setFreigabeWerte(werte);
  };

  /**
   * Kein eigener `sendetRef`-Riegel wie in `Erfassung.tsx`/`OtpEingabe.tsx`: antds `Button` sperrt
   * seinen Klick selbst, solange `loading` steht, und hier ist der Knopf der einzige Weg (dort
   * umgeht ein Tastenkürzel den Knopf). Ein zweiter Riegel ließe sich von antds eigenem nicht
   * unterscheiden.
   */
  const freigabeAusfuehren = async () => {
    if (freigabeWerte === null) return;
    // /freigeben validiert den persistierten Stand, nicht den Editor-Inhalt: erst speichern, sonst
    // würde ein eben befüllter Entwurf als „leer" abgelehnt. Über denselben Weg wie der Knopf: ein
    // laufender Blur-Autosave wird abgewartet statt gedoppelt. Der Hook quittiert bei Erfolg selbst
    // — sonst fragte der Browser beim Neuladen nach Änderungen an einem nicht mehr editierbaren
    // Bericht.
    try {
      await schutz.speichereJetzt(freigabeWerte);
    } catch {
      // Kein Toast: der Grund steht als `schutz.speicherFehler` im Dialog, der offen bleibt. Der
      // Seiten-Alert bleibt daneben stehen, er überlebt das Schließen des Dialogs.
      return;
    }
    try {
      await freigebenMutation.mutateAsync();
    } catch {
      return; // Grund steht als `freigebenMutation.error` im Dialog; er bleibt offen.
    }
    setFreigabeWerte(null);
  };

  return (
    <div className="lagebericht-print-root" data-lfh="druckwurzel">
      {/* Rückfrage vor dem Verlassen mit ungespeicherter Fassung — Zwilling in `BefehlDetailPage`
          (LLH-1351). Eine Quelle für „speichert": `speichertGerade` deckt Autosave und Knopf ab.
          Der Grund eines Fehlschlags gehört in den Dialog, hinter seiner Maske ist die Seite
          unbedienbar. */}
      <EntwurfNavigationSchutz
        ungespeichert={schutz.ungespeichert && schreibtEntwurf}
        speichert={schutz.speichertGerade}
        speicherFehler={schutz.speicherFehler}
        speichern={async () => {
          try {
            await form.validateFields();
          } catch {
            return; // Feldfehler bleiben am Formular; der Wechsel bleibt angehalten.
          }
          schutz.autosaveJetzt();
        }}
      />
      <FreigabeDialog
        offen={freigabeWerte !== null}
        titel="Lagebericht freigeben?"
        warnung="Endgültig: geht ins ETB, Korrektur nur per Fortschreibung."
        speicherFehler={schutz.speicherFehler}
        freigabeFehler={freigebenMutation.error}
        // `speichertGerade` deckt den Vorlauf ab, auch wenn der Klick sich an einen laufenden
        // Blur-Autosave anhängt. Hier richtig und nicht die Falle von `speichernMutation`: dieser
        // Knopf existiert nur bei offenem Dialog, der Vorlauf ist genau der Vorgang, auf den der
        // Dialog wartet.
        laeuft={schutz.speichertGerade || freigebenMutation.isPending}
        onAbbrechen={() => setFreigabeWerte(null)}
        onFreigeben={() => void freigabeAusfuehren()}
      />
      {/* Seitenkopf (`EinsatzSeite`) — Zwilling in `BefehlDetailPage`. Die Aktionsleiste bricht
          im Kopf selbst um, „Freigeben" bleibt auf 390 px erreichbar. Im Druck blendet
          `lageberichtPrint.css` den Kopf aus. */}
      {/* Der gemeinsame Druckkopf: nur auf Papier, am Schirm trägt der Seitenkopf dieselben
          Angaben. In der Druckwurzel, weil `druck/druck.css` alles außerhalb ausblendet. */}
      <Druckkopf
        dokumentart="Lagebericht"
        titel={druckTitel}
        einsatz={einsatz}
        sichtbarkeit="druck"
        zeilen={[
          {
            etikett: 'Stand',
            wert: `${LAGEBERICHT_STATUS[bericht.status].label} · Version ${bericht.version}`,
          },
          { etikett: 'Zeitstand', wert: <ZeitAnzeige wert={druckZeitstand} /> },
          ...verteilerDruckzeile(druckVerteiler),
        ]}
      />
      <EinsatzSeite
        // Editor: reine Schreibfläche, ausdrücklich in Lesebreite.
        breite="schmal"
        titel={bericht.titel}
        meta={
          <Space size={6} wrap>
            {/* Derselbe Träger wie in der Liste: Fachlabel und Phasenfarbe aus der geteilten
                Achse. `istEntwurf` steuert die Knöpfe, nicht das Etikett. */}
            <StatusBadge
              phase={LAGEBERICHT_STATUS[bericht.status].phase}
              label={LAGEBERICHT_STATUS[bericht.status].label}
            />
            <span>{v?.label ?? bericht.vorlage}</span>
            <span>v{bericht.version}</span>
          </Space>
        }
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: <Link to={lageberichtePfad(einsatzId)}>Lageberichte</Link> },
              { title: bericht.titel },
            ]}
          />
        }
        // Sprung und Drucken öffnen, senden nichts ab — Nebenwege im Kopf, unter `md` hinter
        // „Weitere" (LFH-1079, `frontend/AGENTS.md`, Aktionen). Beide nur mit Lesezugriff.
        weitere={{
          name: 'Weitere Aktionen zum Lagebericht',
          eintraege: [...(etbSprung ? [etbSprung] : []), ...druckWege],
        }}
        aktionen={
          <div className="lagebericht-no-print">
            {/* Zielabstand aus der Dichte-Staffel (LFH-968): `marginSM` = 7 / 11 / 16 px, antds
                Vorgabe `paddingXS` ließ 3 / 5 / 7 px. */}
            <Space wrap size={token.marginSM}>
              {!istEntwurf && darfSchreiben && (
                <Button
                  onClick={() => fortschreibenMutation.mutate()}
                  loading={fortschreibenMutation.isPending}
                >
                  Fortschreiben
                </Button>
              )}
              {istEntwurf && darfSchreiben && (
                <>
                  {/* Der sichtbare Beleg des stillen Autosave — ohne ihn wäre „gespeichert" von
                      „nicht gespeichert" nicht zu unterscheiden. */}
                  <Typography.Text type="secondary">
                    {schutz.ungespeichert
                      ? 'ungespeicherte Änderungen'
                      : schutz.zuletztGespeichert &&
                        `zuletzt gespeichert ${schutz.zuletztGespeichert}`}
                  </Typography.Text>
                  {/* `loading` nur am expliziten Pfad, nicht an `speichertGerade`: antds
                      Ladezustand hängt ein `<span role="img" aria-label="loading">` in den
                      Knopf und benennt ihn zu „loading Entwurf speichern" um — bei
                      `speichertGerade` bei jedem stillen Autosave. Der Riegel gegen den
                      Doppel-PATCH liegt im Hook, nicht an diesem `loading`. */}
                  <Button onClick={() => form.submit()} loading={speichernMutation.isPending}>
                    Entwurf speichern
                  </Button>
                  <Button
                    type="primary"
                    onClick={freigabeBestaetigen}
                    loading={freigebenMutation.isPending}
                  >
                    Freigeben
                  </Button>
                </>
              )}
            </Space>
          </div>
        }
      >
        {/* Der Grund eines gescheiterten Speicherns oder Fortschreibens — Zwilling in
            `BefehlDetailPage`. `lagebericht-no-print`, weil ein „Nicht gespeichert"-Banner im
            ausgedruckten Bericht eine Aussage mit Außenwirkung wäre. Speichern gibt es nur im
            Entwurf, Fortschreiben nur nach der Freigabe: es steht höchstens einer da. */}
        {(schutz.speicherFehler ?? fortschreibenMutation.error) != null && (
          <div className="lagebericht-no-print" style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={schutz.speicherFehler} />
            <SpeicherFehler
              fehler={fortschreibenMutation.error}
              titel="Nicht fortgeschrieben"
              fallback="Fortschreiben fehlgeschlagen"
            />
          </div>
        )}

        {/* Im Entwurf trägt das Picker-Feld den Zeitstand — eine zweite Anzeige zeigte zwei
            Uhrzeiten für denselben Wert. Der Lesezweig rendert über `ZeitAnzeige` in der
            taktischen DTG und der Anzeigezone (der Wirestring ist UTC ohne Zonenkennung). */}
        {!schreibtEntwurf && (
          <Typography.Paragraph type="secondary" style={monoStil(12)}>
            Zeitstand: <ZeitAnzeige wert={bericht.zeitstand} />
          </Typography.Paragraph>
        )}

        {/* Im Entwurf trägt `DokumentEntwurf` das Paneel „Entwurf“ mit Gliederung, Umschalter
            und allen Abschnitten (LLH-1074, `entwurf/AGENTS.md`, „Gegliederte Dokumente“). */}
        {schreibtEntwurf ? (
          <Form
            form={form}
            layout="vertical"
            onValuesChange={(geaendert: Record<string, unknown>) => {
              // Ein ganz geleerter Abschnitt verliert seinen Stand der Übernahme (LLH-1357).
              verwerfeStandGeleerter(form, geaendert);
              markiereGeaendert();
            }}
            // Zweiter Auslöser neben der Frist: ein verlassenes Feld. `onBlur` steigt aus den
            // Feldern auf.
            onBlur={schutz.autosaveJetzt}
            onFinish={(werte) => speichernMutation.mutate(werte as FormWerte)}
          >
            {/* Erst wenn das `<Form>` hängt, übernimmt der Verlustschutz den Serverstand
                (LFH-627, `entwurf/useEntwurfVerlustschutz.ts` (4)). */}
            <FormularEingehaengt onWechsel={schutz.formularEingehaengt} />
            {v && (
              <DokumentEntwurf
                form={form}
                abschnitte={v.abschnitte}
                aktion={uebernahme}
                // Alle leeren Abschnitte mit Quelle in einem Schritt (LLH-1081), ohne Rückfrage:
                // es wird nichts ersetzt.
                gliederungKopf={
                  quellen ? (
                    <LeereAbschnitteFuellen
                      quellen={quellen}
                      einsatzId={einsatzId}
                      form={form}
                      onGeaendert={markiereGeaendert}
                    />
                  ) : undefined
                }
                // Der erste LEERE Abschnitt des Serverstands; `Einstiegsfokus` friert ihn beim
                // Einhängen ein, der Remount über `key={lbId}` ist der Reset.
                einstieg={einstiegsAbschnitt(
                  v.abschnitte.map((a) => a.schluessel),
                  (schluessel) => bericht.abschnitte.find((x) => x.schluessel === schluessel)?.text,
                )}
                kopf={
                  // Titel, Zeitstand und Verteiler trägt auf Papier der Druckkopf, aus diesen
                  // Feldern gespeist (LFH-731, LLH-1172); der Kopfblock weicht im Druck
                  // (`entwurf/dokumentEntwurf.css`).
                  <>
                    <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    {/* Feld in der Anzeigezone, Wire in UTC — frontend/AGENTS.md, „Zeiteingabe
                        in der Anzeigezone“. Nicht löschbar: `zeitstand` ist serverseitig nicht
                        nullbar, ein leeres Feld würde beim Speichern weggelassen und zeigte
                        dauerhaft etwas anderes als die DB. */}
                    <Form.Item label="Zeitstand" name="zeitstand">
                      <ZeitpunktEingabe
                        art="ereignis"
                        allowClear={false}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <VerteilerField
                      sources={verteilerQuellen}
                      ohneDruckKlasse="lagebericht-no-print"
                    />
                  </>
                }
              />
            )}
          </Form>
        ) : (
          <Paneel
            titel="Berichtstext"
            meta={`${v?.abschnitte.length ?? 0} Abschnitte`}
            koerperPolster
          >
            {/* Am Schirm; auf Papier trägt ihn der Druckkopf (LLH-1172). */}
            <VerteilerAnzeige verteiler={bericht.verteiler} className="lagebericht-no-print" />
            <div className="lagebericht-druck">
              {/* Unter dem Paneel (h2): Abschnittstitel h3, `#` im Text h4. */}
              <LageberichtText bericht={bericht} unterEbene={2} />
            </div>
          </Paneel>
        )}
        {/* Bild-Anlagen (LFH-1028): am Schirm ein Paneel, auf Papier je ein Blatt hinter dem Text. */}
        <DokumentAnlagen
          dokument="lageberichte"
          einsatzId={einsatzId}
          dokumentId={berichtId}
          einsatzbezeichnung={einsatz.bezeichnung}
          schreibt={schreibtEntwurf}
          ohneDruckKlasse="lagebericht-no-print"
        />
      </EinsatzSeite>
    </div>
  );
}
