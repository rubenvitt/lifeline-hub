import { App, Breadcrumb, Button, Flex, Form, Input, Space, Spin, Tag, Typography } from 'antd';
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
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import './befehlPrint.css';

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
    mutationFn: speichern,
    onSuccess: () => {
      schutz.quittiereGespeichert();
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
      </Flex>

      <Typography.Paragraph type="secondary">Zeitstand: {befehl.zeitstand}</Typography.Paragraph>

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
    </div>
  );
}
