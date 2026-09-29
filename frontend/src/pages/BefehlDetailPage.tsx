import { App, Breadcrumb, Button, Form, Input, Space, Spin, Typography, theme } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { parseRouteId, befehlDetailPfad, auftraegePfad, etbPfad } from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { aktualisiereBefehl, gibBefehlFrei, ladeBefehl, schreibeBefehlFort } from '../api/befehle';
import type { BefehlAbschnitt, BefehlAnzeige } from '../api/types';
import { vorlage } from '../befehle/vorlagen';
import Markdown from '../components/Markdown';
import MarkdownEditor from '../components/MarkdownEditor';
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import EntwurfNavigationSchutz from '../entwurf/EntwurfNavigationSchutz';
import FreigabeDialog from '../entwurf/FreigabeDialog';
import Einstiegsfokus, { einstiegsAbschnitt } from '../entwurf/Einstiegsfokus';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useViewport } from '../components/useViewport';
import { AKTIONSLEISTE_AB, aktionsleisteStil } from '../befehle/aktionsleiste';
import { BEFEHL_STATUS, StatusBadge } from '../kommunikation';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { Paneel, monoStil } from '../components/instrument';
import { FOKUSABSTAND_BEFEHL, useFokusabstandUnten } from '../components/fokusabstandUnten';
import './befehlPrint.css';
import './befehlAktionsleiste.css';

export default function BefehlDetailPage() {
  const { befehlId } = useParams();
  // Remount je Befehl: der Verlustschutz-Merker gehört zu einem Datensatz. Ohne den Key trüge ein
  // Routenwechsel auf dieselbe Komponente (Fortschreiben → neuer Entwurf) den Riegel des alten
  // Befehls mit und hielte den neuen Serverstand fern.
  return <BefehlDetail key={befehlId} />;
}

function BefehlDetail() {
  const { id, befehlId: befehlIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const befehlId = Number(befehlIdParam);
  const idGueltig = parseRouteId(befehlIdParam) != null;
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  // Unterhalb des Führungs-Tablets kleben die Aktionen am unteren Rand statt im Kopf. Begründung
  // der Schwelle: `befehle/aktionsleiste.ts`.
  const verankert = !abBreite(AKTIONSLEISTE_AB);
  /**
   * Fokusabstand zur verankerten Aktionsleiste (`components/fokusabstandUnten.ts`, Regel in
   * `befehlAktionsleiste.css`). Träger ist das Wurzelelement, weil der Scrollport das Dokument ist
   * — die Leiste liegt außerhalb des Formulars, ein `closest('form')` fände im freigegebenen Zweig
   * nichts.
   */
  const leisteRef = useFokusabstandUnten(token.marginSM, FOKUSABSTAND_BEFEHL);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();
  const speicherfolge = useRef<Promise<unknown>>(Promise.resolve());
  const aktiv = useRef(true);
  useEffect(() => {
    aktiv.current = true;
    return () => {
      aktiv.current = false;
    };
  }, []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const befehlQuery = useQuery({
    queryKey: einsatzKeys.befehl(einsatzId, befehlId),
    queryFn: () => ladeBefehl(einsatzId, befehlId),
    enabled: idGueltig,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.befehl(einsatzId, befehlId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  };
  const fehler = (e: unknown) => {
    if (aktiv.current) message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  };

  // Persistiert die Formularwerte als Entwurf (ohne Erfolgs-Toast); geteilt von „Entwurf speichern"
  // und dem Freigabe-Flow.
  const speichern = (werte: Record<string, string>) => {
    const v = vorlage(befehlQuery.data!.vorlage)!;
    const abschnitte: BefehlAbschnitt[] = v.abschnitte.map((a) => ({
      schluessel: a.schluessel,
      text: werte[a.schluessel] ?? '',
    }));
    // Blur-Autosave und explizites Speichern können direkt aufeinander folgen. In Reihenfolge
    // schreiben, damit eine späte S1-Antwort S2 nicht überschreibt.
    const auftrag = speicherfolge.current
      .catch(() => {}) // Ein Fehler darf den nächsten Speicherversuch nicht sperren.
      .then(() => {
        // „Verwerfen“/Unmount beendet noch nicht gestartete Aufträge dieses Editors.
        // Ein späteres Öffnen derselben ID bekommt seine eigene Ref und Speicherfolge.
        if (!aktiv.current) throw new DOMException('Editor verlassen', 'AbortError');
        return aktualisiereBefehl(einsatzId, befehlId, { titel: werte.titel, abschnitte });
      });
    speicherfolge.current = auftrag;
    return auftrag;
  };

  /**
   * Riegel gegen den Fremd-Refetch, Autosave (30 s + Blur) und Reload-Warner; Begründungen in
   * `entwurf/useEntwurfVerlustschutz.ts`.
   */
  const schutz = useEntwurfVerlustschutz<BefehlAnzeige, Record<string, string>>({
    daten: befehlQuery.data,
    istEntwurf: befehlQuery.data?.status === 'entwurf',
    form,
    werteAus: (b) => {
      const werte: Record<string, string> = { titel: b.titel };
      for (const a of b.abschnitte) werte[a.schluessel] = a.text;
      return werte;
    },
    speichern,
    onGespeichert: invalidate,
  });

  /**
   * Ein Klick, ein PATCH: der Klick blurrt zuerst das Feld, der Blur-Autosave ist also schon
   * unterwegs, und `speichereJetzt` hängt sich an ihn an. Quittung, Zeitstempel und `invalidate`
   * liegen im Hook; hier bleibt der Erfolgs-Toast.
   *
   * Kein `onError`: `speichereJetzt` legt den Grund in `speicherFehler` ab, der Alert steht auf der
   * Seite. Ein Toast daneben wäre eine zweite Wahrheit, die nach drei Sekunden geht.
   */
  const speichernMutation = useMutation({
    mutationFn: (werte: Record<string, string>) => schutz.speichereJetzt(werte),
    onSuccess: () => message.success('Entwurf gespeichert'),
  });

  /**
   * Die validierten Werte des Freigabe-Versuchs und zugleich der Auf-Zu-Zustand des Dialogs (`!==
   * null` heißt offen). So kann der Dialog nicht ohne die Werte stehen, mit denen er gespeichert
   * werden soll.
   */
  const [freigabeWerte, setFreigabeWerte] = useState<Record<string, string> | null>(null);

  /**
   * Kein `onError`: der Grund steht als `freigebenMutation.error` im Bestätigungsdialog, der bei
   * Ablehnung offen bleibt.
   */
  const freigebenMutation = useMutation({
    mutationFn: () => gibBefehlFrei(einsatzId, befehlId),
    onSuccess: () => {
      invalidate();
      message.success('Befehl freigegeben');
    },
  });

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeBefehlFort(einsatzId, befehlId),
    onSuccess: (neu: BefehlAnzeige) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
      navigate(befehlDetailPfad(einsatzId, neu.id));
    },
    onError: fehler,
  });

  // Ungültige Befehl-ID → zurück zu Aufträge/Befehle.
  if (!idGueltig) {
    return <Navigate to={auftraegePfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || befehlQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (befehlQuery.isError || !befehlQuery.data || !einsatzQuery.data) {
    return <Typography.Text type="danger">Befehl nicht gefunden.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const befehl = befehlQuery.data;
  const v = vorlage(befehl.vorlage);
  const istEntwurf = befehl.status === 'entwurf';
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const freigabeBestaetigen = async () => {
    // Pflichtfelder vor dem Dialog prüfen — sonst landet ein Titel-Fehler hinter dem Modal.
    let werte: Record<string, string>;
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
    // Befehl.
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

  /**
   * Ein Aktionsblock, zwei Orte: ab `lg` im Kopf neben dem Titel, darunter am unteren Rand
   * verankert. Keine zweite, per CSS versteckte Kopie — das lieferte zwei gleichnamige Knöpfe
   * („Freigeben" doppelt vorgelesen, Tabulatur auf ein unsichtbares Ziel).
   *
   * `htmlType="submit"` wäre hier falsch: der Block trägt mit „Drucken" und „Fortschreiben" auch
   * Aktionen des freigegebenen Zweigs ohne `<Form>`, liegt deshalb außerhalb des Formulars, und
   * „Entwurf speichern" ruft `form.submit()` von Hand.
   *
   * Der Autosave-Beleg geht mit den Knöpfen mit: oben stehengeblieben wäre er auf 390 px aus dem
   * Bild gescrollt, während man tippt.
   */
  const aktionen = (
    <div
      className="befehl-no-print"
      data-lfh="befehl-aktionen"
      ref={verankert ? leisteRef : undefined}
      style={aktionsleisteStil(verankert, token)}
    >
      <Space wrap>
        <DruckKnopf />
        {!istEntwurf && befehl.etb_eintrag_id != null && (
          <Link to={etbPfad(einsatzId, { eintrag: befehl.etb_eintrag_id })}>Zum ETB-Eintrag</Link>
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
                : schutz.zuletztGespeichert && `zuletzt gespeichert ${schutz.zuletztGespeichert}`}
            </Typography.Text>
            {/* `loading` nur am expliziten Pfad, nicht an `speichertGerade`: antds Ladezustand
                hängt ein `<span role="img" aria-label="loading">` in den Knopf und benennt ihn
                zu „loading Entwurf speichern" um — bei `speichertGerade` bei jedem stillen
                Autosave. Der Riegel gegen den Doppel-PATCH liegt im Hook, nicht an diesem
                `loading`. */}
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
  );

  return (
    <div className="befehl-print-root" data-lfh="druckwurzel">
      <EntwurfNavigationSchutz
        ungespeichert={schutz.ungespeichert && istEntwurf && darfSchreiben}
        // Eine Quelle: `speichertGerade` deckt Autosave und Knopf ab; `speichernMutation.isPending`
        // daneben wäre eine zweite Wahrheit.
        speichert={schutz.speichertGerade}
        // Der Grund gehört in den Dialog: hinter seiner Maske ist die Seite unbedienbar, ein Alert
        // dort unsichtbar.
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
        titel="Befehl freigeben?"
        warnung="Die Freigabe ist endgültig und unveränderlich: Der Befehl wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich."
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
      {/* Seitenkopf (`EinsatzSeite`): Titel, rechts der Aktionsblock, der selbst umbricht
          (`flexWrap`) — „Freigeben" bleibt auf 390 px erreichbar. Status, Vorlage und Fassung
          stehen als Meta neben dem Titel.

          Der Kopf liegt innerhalb von `.befehl-print-root`: die Aktionen müssen dort liegen
          (`e2e/befehl-aktionsleiste.spec.ts` sucht sie im Druckbereich), und im Druck blendet
          `befehlPrint.css` den Kopf aus. */}
      {/* Der gemeinsame Druckkopf: nur auf Papier, am Schirm trägt der Seitenkopf dieselben
          Angaben. In der Druckwurzel, weil `druck/druck.css` alles außerhalb ausblendet. */}
      <Druckkopf
        dokumentart="Befehl"
        titel={befehl.titel}
        einsatz={einsatz}
        sichtbarkeit="druck"
        zeilen={[
          {
            etikett: 'Stand',
            wert: `${BEFEHL_STATUS[befehl.status].label} · Version ${befehl.version}`,
          },
          { etikett: 'Zeitstand', wert: <ZeitAnzeige wert={befehl.zeitstand} /> },
        ]}
      />
      <EinsatzSeite
        // Editor: reine Schreibfläche, ausdrücklich in Lesebreite.
        breite="schmal"
        titel={befehl.titel}
        meta={
          <Space size={6} wrap>
            {/* Derselbe Träger wie in der Liste: Fachlabel und Phasenfarbe aus der geteilten
                Achse. `istEntwurf` steuert die Knöpfe, nicht das Etikett. */}
            <StatusBadge
              phase={BEFEHL_STATUS[befehl.status].phase}
              label={BEFEHL_STATUS[befehl.status].label}
            />
            <span>{v?.label ?? befehl.vorlage}</span>
            <span>v{befehl.version}</span>
          </Space>
        }
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: <Link to={auftraegePfad(einsatzId)}>Aufträge/Befehle</Link> },
              { title: befehl.titel },
            ]}
          />
        }
        aktionen={!verankert && aktionen}
      >
        {/* Der Grund eines gescheiterten Speicherns — nicht im `aktionen`-Block, der je Breite
            zwischen Kopf und Leiste wandert; der Alert steht in jeder Breite über dem Inhalt.
            `befehl-no-print`, weil ein „Nicht gespeichert"-Banner im ausgedruckten Befehl eine
            Aussage mit Außenwirkung wäre. */}
        {schutz.speicherFehler != null && (
          <div className="befehl-no-print" style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={schutz.speicherFehler} />
          </div>
        )}

        {/* Taktische DTG in der Anzeigezone: `zeitstand` ist ein UTC-Wirestring ohne
            Zonenkennung. */}
        <Typography.Paragraph type="secondary" style={monoStil(12)}>
          Zeitstand: <ZeitAnzeige wert={befehl.zeitstand} />
        </Typography.Paragraph>

        <Paneel
          titel={istEntwurf && darfSchreiben ? 'Entwurf' : 'Befehlstext'}
          meta={`${v?.abschnitte.length ?? 0} Abschnitte`}
          koerperPolster
        >
          {istEntwurf && darfSchreiben ? (
            <Form
              form={form}
              layout="vertical"
              onValuesChange={schutz.markiereGeaendert}
              // Der zweite Auslöser neben der Frist: ein verlassenes Feld. `onBlur` steigt aus den
              // Feldern auf, ein Handler am Formular genügt.
              onBlur={schutz.autosaveJetzt}
              onFinish={(werte) => speichernMutation.mutate(werte as Record<string, string>)}
            >
              <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              {v?.abschnitte.map((a) => (
                <Form.Item
                  key={a.schluessel}
                  label={a.label}
                  name={a.schluessel}
                  extra={a.hilfetext}
                >
                  {/* Unter dem Paneel „Entwurf" (h2); das Feldetikett ist keine Überschrift. */}
                  <MarkdownEditor
                    layout="split"
                    unterEbene={2}
                    variante="dokument"
                    autoSize={{ minRows: 8 }}
                  />
                </Form.Item>
              ))}
              {/* Einstiegsfokus in den ersten leeren Abschnitt. Als letztes Kind, damit beim
                  Mount-Effekt alle Felder im DOM stehen. */}
              <Einstiegsfokus
                form={form}
                feld={einstiegsAbschnitt(
                  (v?.abschnitte ?? []).map((a) => a.schluessel),
                  (schluessel) => befehl.abschnitte.find((x) => x.schluessel === schluessel)?.text,
                )}
              />
            </Form>
          ) : (
            <div className="befehl-druck">
              {v?.abschnitte.map((a) => {
                const text =
                  befehl.abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
                return (
                  <section key={a.schluessel} style={{ marginBottom: 16 }}>
                    {/* h3 unter dem Paneel (h2); Satz bleibt der von h5. */}
                    <Typography.Title level={3} style={{ fontSize: token.fontSizeHeading5 }}>
                      {a.label}
                    </Typography.Title>
                    {text.trim() ? (
                      <Markdown variante="dokument" unterEbene={3}>
                        {text}
                      </Markdown>
                    ) : (
                      <Typography.Paragraph>—</Typography.Paragraph>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </Paneel>

        {/* Die verankerte Leiste steht nach dem Inhalt: `position: sticky; bottom: 0` klebt
            nur, solange der umgebende Block scrollt — und die Tabulatur führt vom letzten
            Abschnittsfeld direkt auf „Freigeben". */}
        {verankert && aktionen}
      </EinsatzSeite>
    </div>
  );
}
