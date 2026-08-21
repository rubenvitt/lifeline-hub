import { App, Breadcrumb, Button, Flex, Form, Input, Space, Spin, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import './befehlPrint.css';

/** Frist des stillen Autosave. 30 s ist die Vorgabe aus dem Befund N18. */
const AUTOSAVE_MS = 30_000;

export default function BefehlDetailPage() {
  const { id, befehlId: befehlIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const befehlId = Number(befehlIdParam);
  const idGueltig = parseRouteId(befehlIdParam) != null;
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const befehlQuery = useQuery({
    queryKey: einsatzKeys.befehl(einsatzId, befehlId),
    queryFn: () => ladeBefehl(einsatzId, befehlId),
    enabled: idGueltig,
  });

  /**
   * Gibt es eine Fassung im Formular, die noch nicht auf dem Server steht?
   *
   * Bewusst ein eigener Merker und NICHT `form.isFieldsTouched()`: antd setzt das
   * Berührt-Flag beim Speichern nicht zurück. Der Autosave unten schriebe damit alle
   * 30 s ein PATCH samt Invalidierung und Live-Ereignis — auch wenn sich nichts geändert
   * hat —, und der Verlassen-Schutz fragte bis zum Seitenwechsel nach etwas, das längst
   * gesichert ist.
   */
  const [ungespeichert, setUngespeichert] = useState(false);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<string | null>(null);

  useEffect(() => {
    if (!befehlQuery.data) return;
    /*
     * DER RIEGEL (LFH-342 · C7, Befund N18): der Refetch darf eine begonnene Fassung
     * nicht wegräumen.
     *
     * Die Invalidierung kommt hier nicht nur vom eigenen Speichern, sondern über den
     * konsolidierten Live-Stream auch von jeder fremden Änderung am Einsatz. Wer im
     * Befehl schrieb, während anderswo etwas passierte, sah seinen Text ohne Vorwarnung
     * durch den Serverstand ersetzt.
     *
     * Die Umkehrung ist genauso wichtig und eigens getestet: OHNE eigene Fassung
     * übernimmt die Seite den Serverstand weiter — ein Riegel, der immer hält, machte
     * sie still veraltet.
     */
    if (ungespeichert) return;
    const werte: Record<string, string> = { titel: befehlQuery.data.titel };
    for (const a of befehlQuery.data.abschnitte) werte[a.schluessel] = a.text;
    form.setFieldsValue(werte);
  }, [befehlQuery.data, form, ungespeichert]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.befehl(einsatzId, befehlId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  };
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  // Persistiert die aktuellen Formularwerte als Entwurf (ohne Erfolgs-Toast) — von der
  // „Entwurf speichern"-Mutation und vom Freigabe-Flow gemeinsam genutzt.
  const speichern = (werte: Record<string, string>) => {
    const v = vorlage(befehlQuery.data!.vorlage)!;
    const abschnitte: BefehlAbschnitt[] = v.abschnitte.map((a) => ({
      schluessel: a.schluessel,
      text: werte[a.schluessel] ?? '',
    }));
    return aktualisiereBefehl(einsatzId, befehlId, { titel: werte.titel, abschnitte });
  };

  const speichernMutation = useMutation({
    mutationFn: speichern,
    onSuccess: () => {
      setUngespeichert(false);
      setZuletztGespeichert(dayjs().format('HH:mm'));
      invalidate();
      message.success('Entwurf gespeichert');
    },
    onError: fehler,
  });

  /**
   * Autosave alle {@link AUTOSAVE_MS} und bei jedem Verlassen eines Feldes (LFH-342 · C7,
   * Befund N18). Ein Befehl entsteht in Minuten Schreibarbeit und lag bis hierher
   * ausschließlich im Formularspeicher.
   *
   * STILL, also ohne Erfolgs-Toast: eine Meldung alle 30 Sekunden wäre eine
   * Alarmquelle nach EEMUA 191 und keine Rückmeldung. Sichtbar ist stattdessen der
   * Zeitstempel neben dem Speichern-Knopf — ein Autosave, den niemand sieht, ist von
   * „nicht gespeichert" nicht zu unterscheiden.
   *
   * Der FEHLERFALL meldet sich dagegen sehr wohl: ein stiller Verlust ist genau das,
   * wogegen dieser Mechanismus gebaut ist.
   */
  const autosaveMutation = useMutation({
    mutationFn: speichern,
    onSuccess: () => {
      setUngespeichert(false);
      setZuletztGespeichert(dayjs().format('HH:mm'));
      invalidate();
    },
    onError: fehler,
  });

  // In einer Ref, damit der Intervall-Effekt nicht bei jedem Render neu aufgesetzt wird
  // (sonst liefe die Frist nie ab — dieselbe Falle wie bei instabilen Effekt-Deps).
  const autosaveRef = useRef<() => void>(() => {});
  autosaveRef.current = () => {
    if (!ungespeichert || autosaveMutation.isPending) return;
    autosaveMutation.mutate(form.getFieldsValue() as Record<string, string>);
  };

  const istEntwurfStand = befehlQuery.data?.status === 'entwurf';
  useEffect(() => {
    if (!istEntwurfStand) return;
    const uhr = setInterval(() => autosaveRef.current(), AUTOSAVE_MS);
    return () => clearInterval(uhr);
  }, [istEntwurfStand]);

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

  /**
   * Verlassen-Schutz gegen Reload und Tab-Schluss (LFH-342 · C7, Befund N18).
   *
   * WARUM NICHT `useBlocker`, obwohl das Ticket ihn nennt — gemessen: er verlangt einen
   * **Data Router**, und die Anwendung hängt an `<BrowserRouter>` (`main.tsx:37`). Der
   * Aufruf wirft dort hart („useBlocker must be used within a data router"), und zwar
   * beim Rendern, nicht bloß im Blockierfall. Die Umstellung auf `createBrowserRouter`
   * betrifft die ganze Routenlandschaft und ist keine Nebenwirkung eines
   * Befehlsentwurf-Tickets → eigener Nachzug.
   *
   * Was den In-App-Wechsel praktisch absichert, ist der Autosave selbst: jeder Klick
   * auf die Brotkrume verlässt zuerst das Feld, und `onBlur` speichert. Übrig bleibt
   * der Weg AM Dokument vorbei — Reload, Tab-Schluss, Adresszeile —, und genau den
   * deckt `beforeunload`.
   */
  useEffect(() => {
    if (!ungespeichert) return;
    const warnen = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Zusätzlich zu `preventDefault`: ältere Browser werten allein `returnValue`.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [ungespeichert]);

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
        try {
          await speichern(werte);
        } catch (e) {
          fehler(e);
          throw e; // Dialog offen lassen, Freigabe nicht auslösen.
        }
        await freigebenMutation.mutateAsync();
      },
    });
  };

  return (
    <div className="befehl-print-root">
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
                {ungespeichert
                  ? 'ungespeicherte Änderungen'
                  : zuletztGespeichert && `zuletzt gespeichert ${zuletztGespeichert}`}
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
      </Flex>

      <Typography.Paragraph type="secondary">Zeitstand: {befehl.zeitstand}</Typography.Paragraph>

      {istEntwurf && darfSchreiben ? (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => setUngespeichert(true)}
          // Der zweite Auslöser neben der Frist: ein verlassenes Feld ist der Moment,
          // in dem ein Abschnitt fertig gedacht ist. `onBlur` steigt aus den Feldern
          // auf, ein Handler am Formular genügt also für alle.
          onBlur={() => autosaveRef.current()}
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
    </div>
  );
}
