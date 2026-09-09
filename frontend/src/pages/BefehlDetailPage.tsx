import { App, Breadcrumb, Button, Flex, Form, Input, Space, Spin, Tag, Typography, theme } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { parseRouteId, befehlDetailPfad, auftraegePfad, etbPfad } from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import {
  aktualisiereBefehl,
  gibBefehlFrei,
  ladeBefehl,
  schreibeBefehlFort,
} from '../api/befehle';
import type { BefehlAbschnitt, BefehlAnzeige } from '../api/types';
import { vorlage } from '../befehle/vorlagen';
import Markdown from '../components/Markdown';
import MarkdownEditor from '../components/MarkdownEditor';
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import EntwurfNavigationSchutz from '../entwurf/EntwurfNavigationSchutz';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useViewport } from '../components/useViewport';
import { AKTIONSLEISTE_AB, aktionsleisteStil } from '../befehle/aktionsleiste';
import './befehlPrint.css';
import './befehlAktionsleiste.css';

/**
 * Hält `--lfh-befehl-fokusabstand` an der GEMESSENEN Höhe der verankerten Aktionsleiste
 * (LFH-465; Bauform aus `EinheitDetailPage.tsx:37`, LFH-446).
 *
 * Warum gemessen und nicht als Festwert: Dichtestufe (30/48/72 px) und umgebrochene
 * Knopfreihe verändern die Höhe um ein Vielfaches — ein Festwert wäre im Handschuh-Betrieb
 * daneben, und die Felder darüber parkten beim nativen Fokus-Scroll wieder hinter der
 * Leiste.
 *
 * Träger ist das WURZELELEMENT, nicht das `<form>` wie bei der Einheit und auch nicht die
 * Seitenwurzel: die Regel dazu ist `scroll-padding-block-end` am Scrollport, und der
 * Scrollport ist hier das Dokument. Ein `closest('form')` fände ohnehin nichts — die Leiste
 * liegt ausserhalb des Formulars, weil sie mit „Drucken"/„Fortschreiben" auch Aktionen des
 * freigegebenen Zweigs trägt, in dem es gar kein `<Form>` gibt; der Beobachter wäre dann ein
 * stilles No-op. Die Aufräumfunktion nimmt die Eigenschaft beim Verlassen wieder weg, sonst
 * trüge jede folgende Route den Abzug einer Leiste, die es dort nicht gibt.
 */
function beobachteAktionsleiste(leiste: HTMLDivElement | null, abstand: number) {
  if (!leiste) return;
  const wurzel = document.documentElement;
  const aktualisiere = () => wurzel.style.setProperty(
    '--lfh-befehl-fokusabstand', `${leiste.getBoundingClientRect().height + abstand}px`,
  );
  aktualisiere();
  const beobachter = new ResizeObserver(aktualisiere);
  beobachter.observe(leiste);
  return () => {
    beobachter.disconnect();
    wurzel.style.removeProperty('--lfh-befehl-fokusabstand');
  };
}

export default function BefehlDetailPage() {
  const { befehlId } = useParams();
  // Remount je Befehl: der Verlustschutz-Merker gehört zu EINEM Datensatz. Ohne den Key
  // trüge ein Routenwechsel auf dieselbe Komponente (Fortschreiben → neuer Entwurf) den
  // Riegel des alten Befehls mit und hielte den neuen Serverstand fern.
  return <BefehlDetail key={befehlId} />;
}

function BefehlDetail() {
  const { id, befehlId: befehlIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const befehlId = Number(befehlIdParam);
  const idGueltig = parseRouteId(befehlIdParam) != null;
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const { abBreite } = useViewport();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();
  const speicherfolge = useRef<Promise<unknown>>(Promise.resolve());
  const aktiv = useRef(true);
  useEffect(() => {
    aktiv.current = true;
    return () => { aktiv.current = false; };
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

  // Persistiert die aktuellen Formularwerte als Entwurf (ohne Erfolgs-Toast) — von der
  // „Entwurf speichern"-Mutation und vom Freigabe-Flow gemeinsam genutzt.
  const speichern = (werte: Record<string, string>) => {
    const v = vorlage(befehlQuery.data!.vorlage)!;
    const abschnitte: BefehlAbschnitt[] = v.abschnitte.map((a) => ({
      schluessel: a.schluessel,
      text: werte[a.schluessel] ?? '',
    }));
    // Blur-Autosave und explizites Speichern können direkt aufeinander folgen.
    // In Reihenfolge schreiben, damit eine späte S1-Antwort S2 nicht überschreibt.
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
   * Riegel gegen den Fremd-Refetch, Autosave (30 s + Blur) und Reload-Warner — gehoben nach
   * `entwurf/useEntwurfVerlustschutz.ts` (LFH-348 · C13); Begründungen stehen dort.
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
    onFehler: fehler,
    onGespeichert: invalidate,
  });

  const speichernMutation = useMutation({
    mutationFn: async (werte: Record<string, string>) => {
      const quittieren = schutz.quittungVorbereiten();
      await speichern(werte);
      return quittieren;
    },
    onSuccess: (quittieren) => {
      quittieren();
      invalidate();
      message.success('Entwurf gespeichert');
    },
    onError: fehler,
  });

  const freigebenMutation = useMutation({
    mutationFn: () => gibBefehlFrei(einsatzId, befehlId),
    onSuccess: () => {
      invalidate();
      message.success('Befehl freigegeben');
    },
    onError: fehler,
  });

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeBefehlFort(einsatzId, befehlId),
    onSuccess: (neu: BefehlAnzeige) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
      navigate(befehlDetailPfad(einsatzId, neu.id));
    },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige Befehl-ID → zurück zu Aufträge/Befehle.
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
  // Unterhalb des Führungs-Tablets kleben die Aktionen am unteren Rand statt im Kopf
  // (LFH-465). Begründung der Schwelle: `befehle/aktionsleiste.ts`.
  const verankert = !abBreite(AKTIONSLEISTE_AB);

  const freigabeBestaetigen = async () => {
    // Pflichtfelder VOR dem Dialog prüfen — sonst landet ein Titel-Fehler hinter dem Modal.
    let werte: Record<string, string>;
    try {
      werte = await form.validateFields();
    } catch {
      return; // Validierungsfehler werden am Formular angezeigt.
    }
    modal.confirm({
      title: 'Befehl freigeben?',
      content:
        'Die Freigabe ist endgültig und unveränderlich: Der Befehl wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich.',
      okText: 'Freigeben',
      cancelText: 'Abbrechen',
      onOk: async () => {
        // /freigeben validiert den persistierten DB-Stand, nicht den Editor-Inhalt:
        // den aktuellen Inhalt erst speichern, sonst wird ein eben befüllter Entwurf
        // fälschlich als „leer" abgelehnt (und ungespeicherte Edits gingen verloren).
        const quittieren = schutz.quittungVorbereiten();
        try {
          await speichern(werte);
        } catch (e) {
          fehler(e);
          throw e; // Dialog offen lassen, Freigabe nicht auslösen.
        }
        // Sonst bliebe der Merker nach der endgültigen Freigabe stehen und der Browser
        // fragte beim Neuladen nach Änderungen an einem Befehl, der nicht mehr editierbar
        // ist (Review LFH-348).
        quittieren();
        await freigebenMutation.mutateAsync();
      },
    });
  };

  /**
   * EIN Aktionsblock, zwei Orte (LFH-465). Ab `lg` steht er im Kopf-`Flex` neben dem
   * Titel, darunter am unteren Rand verankert.
   *
   * KEINE ZWEITE KOPIE, die per CSS versteckt wird: das lieferte zwei gleichnamige Knöpfe
   * im Baum — die Vorlesereihenfolge bekäme „Freigeben" doppelt, und der Tabulaturdurchlauf
   * von `e2e/befehl-aktionsleiste.spec.ts` liefe auf ein unsichtbares Ziel.
   *
   * `htmlType="submit"` wäre hier FALSCH, anders als bei `speicherLeisteStil` (LFH-345 ·
   * C10) und `EinheitDetailPage` (LFH-446): der Block trägt mit „Drucken" und
   * „Fortschreiben" auch Aktionen des freigegebenen Zweigs, in dem es gar kein `<Form>`
   * gibt — er liegt deshalb ausserhalb des Formulars, und „Entwurf speichern" ruft
   * `form.submit()` weiter von Hand (unverändert gegenüber dem Kopf-Bestand). Wer das
   * gegen LFH-346/C11 „harmonisiert", bricht entweder die Leiste oder die Kopf-Regel.
   *
   * Der Autosave-Beleg (LFH-342 · C7) geht mit den Knöpfen mit: oben stehengeblieben wäre
   * er auf 390 px aus dem Bild gescrollt, genau während man tippt.
   */
  const aktionen = (
    <div
      className="befehl-no-print"
      data-lfh="befehl-aktionen"
      ref={verankert ? (el) => beobachteAktionsleiste(el, token.marginSM) : undefined}
      style={aktionsleisteStil(verankert, token)}
    >
      <Space wrap>
        <Button onClick={() => window.print()}>Drucken / als PDF</Button>
        {!istEntwurf && befehl.etb_eintrag_id != null && (
          <Link to={etbPfad(einsatzId, { eintrag: befehl.etb_eintrag_id })}>Zum ETB-Eintrag</Link>
        )}
        {!istEntwurf && darfSchreiben && (
          <Button onClick={() => fortschreibenMutation.mutate()} loading={fortschreibenMutation.isPending}>
            Fortschreiben
          </Button>
        )}
        {istEntwurf && darfSchreiben && (
          <>
            {/* Der sichtbare Beleg des stillen Autosave. Ohne ihn wäre „gespeichert"
                von „nicht gespeichert" nicht zu unterscheiden. */}
            <Typography.Text type="secondary">
              {schutz.ungespeichert
                ? 'ungespeicherte Änderungen'
                : schutz.zuletztGespeichert && `zuletzt gespeichert ${schutz.zuletztGespeichert}`}
            </Typography.Text>
            <Button onClick={() => form.submit()} loading={speichernMutation.isPending}>
              Entwurf speichern
            </Button>
            <Button type="primary" onClick={freigabeBestaetigen} loading={freigebenMutation.isPending}>
              Freigeben
            </Button>
          </>
        )}
      </Space>
    </div>
  );

  return (
    <div className="befehl-print-root">
      <EntwurfNavigationSchutz
        ungespeichert={schutz.ungespeichert && istEntwurf && darfSchreiben}
        speichert={schutz.autosaveLaeuft || speichernMutation.isPending}
        speichern={async () => {
          try {
            await form.validateFields();
          } catch {
            return; // Feldfehler bleiben am Formular; der Wechsel bleibt angehalten.
          }
          schutz.autosaveJetzt();
        }}
      />
      <Breadcrumb
        className="befehl-no-print"
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={auftraegePfad(einsatzId)}>Aufträge/Befehle</Link> },
          { title: befehl.titel },
        ]}
      />
      {/*
        Umbruchfähige Kopfzeile (LFH-343 · C8, Befund M73). Vorher trug sie ein
        `<Space>` ohne `wrap`: auf schmalem Schirm schob der Titel die Aktionen aus
        dem sichtbaren Bereich, und „Freigeben" — die einzige Aktion, die den
        Entwurf abschliesst — war nicht mehr erreichbar. Muster sind die vier
        Schwesterseiten (`MeldungenPage`, `ErinnerungenPage`, `NachforderungenPage`,
        `AuftraegeListe`), die alle `<Flex justify="space-between" … wrap>` tragen.

        Die Tag-Gruppe rutscht UNTER den Titel: nebeneinander sind es fünf Elemente
        in einer Zeile, und auf 390 px bleibt für den Titel dann nichts.
      */}
      <Flex
        className="befehl-no-print"
        justify="space-between"
        align="center"
        gap={16}
        wrap
        style={{ marginBottom: 16 }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {befehl.titel}
          </Typography.Title>
          <Space size={6} wrap style={{ marginTop: 4 }}>
            <Tag color={istEntwurf ? 'default' : 'green'}>{istEntwurf ? 'Entwurf' : 'Freigegeben'}</Tag>
            <Tag>{v?.label ?? befehl.vorlage}</Tag>
            <Tag>v{befehl.version}</Tag>
          </Space>
        </div>
        {!verankert && aktionen}
      </Flex>

      {/* Taktische DTG in der Anzeigezone (LFH-350 · H60): `zeitstand` ist ein UTC-Wirestring
          ohne Zonenkennung und stand roh ausgegeben um den Zonenversatz falsch. */}
      <Typography.Paragraph type="secondary">
        Zeitstand: <ZeitAnzeige wert={befehl.zeitstand} />
      </Typography.Paragraph>

      {istEntwurf && darfSchreiben ? (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={schutz.markiereGeaendert}
          // Der zweite Auslöser neben der Frist: ein verlassenes Feld ist der Moment,
          // in dem ein Abschnitt fertig gedacht ist. `onBlur` steigt aus den Feldern
          // auf, ein Handler am Formular genügt also für alle.
          onBlur={schutz.autosaveJetzt}
          onFinish={(werte) => speichernMutation.mutate(werte as Record<string, string>)}
        >
          <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {v?.abschnitte.map((a) => (
            <Form.Item key={a.schluessel} label={a.label} name={a.schluessel} extra={a.hilfetext}>
              <MarkdownEditor layout="split" variante="dokument" autoSize={{ minRows: 8 }} />
            </Form.Item>
          ))}
        </Form>
      ) : (
        <div className="befehl-druck">
          {v?.abschnitte.map((a) => {
            const text = befehl.abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
            return (
              <section key={a.schluessel} style={{ marginBottom: 16 }}>
                <Typography.Title level={5}>{a.label}</Typography.Title>
                {text.trim()
                  ? <Markdown variante="dokument">{text}</Markdown>
                  : <Typography.Paragraph>—</Typography.Paragraph>}
              </section>
            );
          })}
        </div>
      )}

      {/* Die verankerte Leiste steht NACH dem Inhalt: `position: sticky; bottom: 0` klebt
          nur, solange der umgebende Block noch scrollt — und die Tabulaturreihenfolge
          führt so vom letzten Abschnittsfeld direkt auf „Freigeben". */}
      {verankert && aktionen}
    </div>
  );
}
