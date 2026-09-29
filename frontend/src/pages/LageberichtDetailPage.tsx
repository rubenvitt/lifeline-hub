import {
  App,
  Breadcrumb,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Space,
  Spin,
  Typography,
  theme,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  parseRouteId,
  lageberichtePfad,
  lageberichtDetailPfad,
  etbPfad,
} from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import {
  aktualisiereLagebericht,
  gibLageberichtFrei,
  ladeLagebericht,
  schreibeLageberichtFort,
} from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtAnzeige } from '../api/types';
import { vorlage, type AbschnittDef } from '../lageberichte/vorlagen';
import LageberichtText from '../lageberichte/LageberichtText';
import {
  AbschnittsAkkordeon,
  befuellungsKette,
  mengeAusKette,
} from '../lageberichte/AbschnittsAkkordeon';
import MarkdownEditor from '../components/MarkdownEditor';
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import Einstiegsfokus, { einstiegsAbschnitt } from '../entwurf/Einstiegsfokus';
import FreigabeDialog from '../entwurf/FreigabeDialog';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { alsBackendZeit, alsOrtszeit } from '../etb/filterZeit';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { LAGEBERICHT_STATUS, StatusBadge } from '../kommunikation';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { Paneel, monoStil } from '../components/instrument';
import './lageberichtPrint.css';

/**
 * Formularwerte des Entwurfs: Titel, Zeitstand (lokale Picker-Zeit, UTC erst beim Senden —
 * `etb/filterZeit.ts`) und je Abschnitt der Markdown-Text unter seinem Schlüssel.
 */
type FormWerte = { titel: string; zeitstand?: Dayjs } & Record<string, string | Dayjs | undefined>;

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
  const { benutzer } = useAuth();
  const berichtId = Number(lbId);
  const idGueltig = parseRouteId(lbId) != null;
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormWerte>();
  const { token } = theme.useToken();
  // Alle Werte beobachten: die Leer-Marke je Kopfzeile folgt dem Tippen, nicht dem Speichern.
  const werte = Form.useWatch([], form) as Record<string, unknown> | undefined;
  /**
   * Genau ein offener Abschnitt, die Vorschau nur auf Wunsch neben dem Text. „Vorschau neben dem
   * Text" ist eine Einstellung, keine Aktion — eigene Zeile über den Abschnitten, Vorgabe aus.
   */
  const [offenerAbschnitt, setOffenerAbschnitt] = useState<string | null>(null);
  const [vorschauNeben, setVorschauNeben] = useState(false);
  /**
   * Der Einstiegs-Abschnitt: offen und fokussiert ist der erste leere. Einmal je Bericht bestimmt,
   * der Remount über `key={lbId}` ist der Reset. Eine lebende Ableitung zeigte nach dem Befüllen
   * auf den nächsten leeren, und das Akkordeon klappte beim ersten Autosave unter dem Cursor
   * weiter.
   *
   * Während des Renderns abgeleitet: der `useState`-Initialwert geht nicht (`berichtQuery.data`
   * fehlt beim ersten Render, die Seite zeigt einen `<Spin>`), und ein Effekt käme zu spät —
   * `Einstiegsfokus` friert sein Ziel beim Mount ein, der Fokus landete auf `<body>`. React rendert
   * nach einem `setState` im Renderlauf sofort neu, bevor es zeichnet. Der Riegel gegen die
   * Schleife ist das Objekt: `feld` darf `null` sein („Vorlage ohne Abschnitte"), ein nackter
   * `null`-Vergleich liefe endlos.
   */
  const [einstieg, setEinstieg] = useState<{ feld: string | null } | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichtQuery = useQuery({
    queryKey: einsatzKeys.lagebericht(einsatzId, berichtId),
    queryFn: () => ladeLagebericht(einsatzId, berichtId),
    enabled: idGueltig,
  });
  // Vor den frühen Rückgaben (Hook-Reihenfolge); `vorlage()` liefert je Schlüssel dasselbe Objekt
  // aus `VORLAGEN`, die Abhängigkeit ist stabil.
  const vorlageDef = berichtQuery.data ? vorlage(berichtQuery.data.vorlage) : undefined;
  /**
   * Die Leer-Marke je Kopfzeile — über ein Primitiv memoisiert. `befuellteAbschnitte(werte, …)`
   * liefert je Tastenanschlag ein neues `Set` mit gleichem Inhalt; als Prop am memoisierten
   * Akkordeon höbe das die Sperre auf, und alle acht Editoren rendern samt `autoSize`-Nachmessung
   * neu. Die Kette ist ein String und ändert sich nur beim Kippen leer↔befüllt (Messung:
   * `e2e/lagebericht-tippen.spec.ts`).
   */
  const befuelltKette = befuellungsKette(werte, vorlageDef?.abschnitte ?? []);
  const befuellt = useMemo(
    () => mengeAusKette(befuelltKette, vorlageDef?.abschnitte ?? []),
    [befuelltKette, vorlageDef],
  );

  if (einstieg === null && berichtQuery.data && vorlageDef) {
    const geladen = berichtQuery.data;
    setEinstieg({
      feld:
        einstiegsAbschnitt(
          vorlageDef.abschnitte.map((a) => a.schluessel),
          (schluessel) => geladen.abschnitte.find((x) => x.schluessel === schluessel)?.text,
        ) ?? null,
    });
  }

  /**
   * `useCallback`, nicht inline: eine neue Funktionsidentität je Anschlag höbe die `memo`-Sperre
   * des Akkordeons auf — ohne Fehlerbild, nur langsam. Abhängig allein von `vorschauNeben`.
   */
  const abschnittsEditor = useCallback(
    (a: AbschnittDef) => (
      // Die Kopfzeile trägt den Namen sichtbar; das Etikett des Feldes bleibt für die
      // Label-Verknüpfung, steht aber nicht ein zweites Mal da.
      <Form.Item label={a.label} name={a.schluessel} labelCol={{ style: { display: 'none' } }}>
        {/* Direkt unter dem Seitentitel (h1): die Akkordeon-Köpfe sind Schaltflächen, keine
            Überschriften, und ein Paneel rahmt den Entwurf nicht (s. u.). */}
        <MarkdownEditor
          layout={vorschauNeben ? 'split' : 'toggle'}
          // Ohne sie druckte das Toggle-Layout sein Textfeld (`lageberichtPrint.css`).
          druckfassung
          unterEbene={1}
          variante="dokument"
          autoSize={{ minRows: 6 }}
        />
      </Form.Item>
    ),
    [vorschauNeben],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.lagebericht(einsatzId, berichtId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
  };
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  // Persistiert die Formularwerte als Entwurf (ohne Erfolgs-Toast); geteilt von „Entwurf speichern"
  // und dem Freigabe-Flow.
  const speichern = (werte: FormWerte) => {
    const v = vorlage(berichtQuery.data!.vorlage)!;
    const abschnitte: LageberichtAbschnitt[] = v.abschnitte.map((a) => {
      const text = werte[a.schluessel];
      return { schluessel: a.schluessel, text: typeof text === 'string' ? text : '' };
    });
    return aktualisiereLagebericht(einsatzId, berichtId, {
      titel: werte.titel,
      // Leer gelassen → Feld nicht mitschicken; das Backend behält den Bestandswert.
      ...(werte.zeitstand ? { zeitstand: alsBackendZeit(werte.zeitstand) } : {}),
      abschnitte,
    });
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
      const werte: FormWerte = { titel: b.titel, zeitstand: alsOrtszeit(b.zeitstand) };
      for (const a of b.abschnitte) werte[a.schluessel] = a.text;
      return werte;
    },
    speichern,
    onGespeichert: invalidate,
  });

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

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeLageberichtFort(einsatzId, berichtId),
    onSuccess: (neu: LageberichtAnzeige) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
      navigate(lageberichtDetailPfad(einsatzId, neu.id));
    },
    onError: fehler,
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
  const istEntwurf = bericht.status === 'entwurf';
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

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
      <FreigabeDialog
        offen={freigabeWerte !== null}
        titel="Lagebericht freigeben?"
        warnung="Die Freigabe ist endgültig und unveränderlich: Der Bericht wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich."
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
        titel={bericht.titel}
        einsatz={einsatz}
        sichtbarkeit="druck"
        zeilen={[
          {
            etikett: 'Stand',
            wert: `${LAGEBERICHT_STATUS[bericht.status].label} · Version ${bericht.version}`,
          },
          { etikett: 'Zeitstand', wert: <ZeitAnzeige wert={bericht.zeitstand} /> },
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
        aktionen={
          <div className="lagebericht-no-print">
            <Space wrap>
              <DruckKnopf />
              {!istEntwurf && bericht.etb_eintrag_id != null && (
                <Link to={etbPfad(einsatzId, { eintrag: bericht.etb_eintrag_id })}>
                  Zum ETB-Eintrag
                </Link>
              )}
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
        {/* Der Grund eines gescheiterten Speicherns — Zwilling in `BefehlDetailPage`.
            `lagebericht-no-print`, weil ein „Nicht gespeichert"-Banner im ausgedruckten Bericht
            eine Aussage mit Außenwirkung wäre. */}
        {schutz.speicherFehler != null && (
          <div className="lagebericht-no-print" style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={schutz.speicherFehler} />
          </div>
        )}

        {/* Im Entwurf trägt das Picker-Feld den Zeitstand — eine zweite Anzeige zeigte zwei
            Uhrzeiten für denselben Wert. Der Lesezweig rendert über `ZeitAnzeige` in der
            taktischen DTG und der Anzeigezone (der Wirestring ist UTC ohne Zonenkennung). */}
        {!(istEntwurf && darfSchreiben) && (
          <Typography.Paragraph type="secondary" style={monoStil(12)}>
            Zeitstand: <ZeitAnzeige wert={bericht.zeitstand} />
          </Typography.Paragraph>
        )}

        {/* Im Entwurf trägt das Abschnittsakkordeon die Gliederung selbst; ein Paneel darum
            kostete Kopfzeile und Polster auf einer Seite, deren Höhe gemessen gedeckelt ist
            (`e2e/lagebericht-schmal.spec.ts`). Das Paneel rahmt nur den Lesezweig. */}
        {istEntwurf && darfSchreiben ? (
          <Form
            form={form}
            layout="vertical"
            onValuesChange={schutz.markiereGeaendert}
            // Zweiter Auslöser neben der Frist: ein verlassenes Feld. `onBlur` steigt aus den
            // Feldern auf.
            onBlur={schutz.autosaveJetzt}
            onFinish={(werte) => speichernMutation.mutate(werte as FormWerte)}
          >
            <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            {/* Picker in Ortszeit, Wire in UTC — `etb/filterZeit`. */}
            <Form.Item label="Zeitstand" name="zeitstand">
              {/* Nicht löschbar: `zeitstand` ist serverseitig nicht nullbar, ein leeres Feld
                  würde beim Speichern weggelassen und zeigte dauerhaft etwas anderes als die
                  DB. */}
              <DatePicker
                showTime
                allowClear={false}
                format="DD.MM.YYYY HH:mm"
                style={{ width: '100%' }}
              />
            </Form.Item>
            {/* Umschalter = Bedienung, kein Inhalt: im Druck weg. */}
            <Checkbox
              className="lagebericht-no-print"
              checked={vorschauNeben}
              onChange={(e) => setVorschauNeben(e.target.checked)}
              style={{ marginBottom: token.margin }}
            >
              Vorschau neben dem Text
            </Checkbox>
            {v && (
              <AbschnittsAkkordeon
                abschnitte={v.abschnitte}
                befuellt={befuellt}
                // Vorgabe ist der Einstiegs-Abschnitt, nicht stur der erste.
                offen={offenerAbschnitt ?? einstieg?.feld ?? v.abschnitte[0].schluessel}
                onOffen={setOffenerAbschnitt}
                editor={abschnittsEditor}
              />
            )}
            {/* Einstiegsfokus in den offenen Abschnitt. Als letztes Kind, damit beim
                Mount-Effekt alle Felder im DOM stehen. */}
            <Einstiegsfokus form={form} feld={einstieg?.feld ?? undefined} />
          </Form>
        ) : (
          <Paneel
            titel="Berichtstext"
            meta={`${v?.abschnitte.length ?? 0} Abschnitte`}
            koerperPolster
          >
            <div className="lagebericht-druck">
              {/* Unter dem Paneel (h2): Abschnittstitel h3, `#` im Text h4. */}
              <LageberichtText bericht={bericht} unterEbene={2} />
            </div>
          </Paneel>
        )}
      </EinsatzSeite>
    </div>
  );
}
