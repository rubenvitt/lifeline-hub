import { App, Breadcrumb, Button, Form, Input, Space, Spin, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { parseRouteId, lageberichtePfad, lageberichtDetailPfad, etbPfad } from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import {
  aktualisiereLagebericht,
  gibLageberichtFrei,
  ladeLagebericht,
  schreibeLageberichtFort,
} from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtAnzeige } from '../api/types';
import { vorlage } from '../lageberichte/vorlagen';
import Markdown from '../components/Markdown';
import MarkdownEditor from '../components/MarkdownEditor';
import './lageberichtPrint.css';

export default function LageberichtDetailPage() {
  const { id, lbId } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const berichtId = Number(lbId);
  const idGueltig = parseRouteId(lbId) != null;
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();


  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichtQuery = useQuery({
    queryKey: einsatzKeys.lagebericht(einsatzId, berichtId),
    queryFn: () => ladeLagebericht(einsatzId, berichtId),
    enabled: idGueltig,
  });

  useEffect(() => {
    if (berichtQuery.data) {
      const werte: Record<string, string> = { titel: berichtQuery.data.titel };
      for (const a of berichtQuery.data.abschnitte) werte[a.schluessel] = a.text;
      form.setFieldsValue(werte);
    }
  }, [berichtQuery.data, form]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.lagebericht(einsatzId, berichtId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
  };
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  // Persistiert die aktuellen Formularwerte als Entwurf (ohne Erfolgs-Toast) — von der
  // „Entwurf speichern"-Mutation und vom Freigabe-Flow gemeinsam genutzt.
  const speichern = (werte: Record<string, string>) => {
    const v = vorlage(berichtQuery.data!.vorlage)!;
    const abschnitte: LageberichtAbschnitt[] = v.abschnitte.map((a) => ({
      schluessel: a.schluessel,
      text: werte[a.schluessel] ?? '',
    }));
    return aktualisiereLagebericht(einsatzId, berichtId, { titel: werte.titel, abschnitte });
  };

  const speichernMutation = useMutation({
    mutationFn: speichern,
    onSuccess: () => {
      invalidate();
      message.success('Entwurf gespeichert');
    },
    onError: fehler,
  });

  const freigebenMutation = useMutation({
    mutationFn: () => gibLageberichtFrei(einsatzId, berichtId),
    onSuccess: () => {
      invalidate();
      message.success('Bericht freigegeben');
    },
    onError: fehler,
  });

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeLageberichtFort(einsatzId, berichtId),
    onSuccess: (neu: LageberichtAnzeige) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
      navigate(lageberichtDetailPfad(einsatzId, neu.id));
    },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige Lagebericht-ID → zurück zur Liste.
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
    // Pflichtfelder VOR dem Dialog prüfen — sonst landet ein Titel-Fehler hinter dem Modal.
    let werte: Record<string, string>;
    try {
      werte = await form.validateFields();
    } catch {
      return; // Validierungsfehler werden am Formular angezeigt.
    }
    modal.confirm({
      title: 'Lagebericht freigeben?',
      content:
        'Die Freigabe ist endgültig und unveränderlich: Der Bericht wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich.',
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
    <div className="lagebericht-print-root">
      <Breadcrumb
        className="lagebericht-no-print"
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={lageberichtePfad(einsatzId)}>Lageberichte</Link> },
          { title: bericht.titel },
        ]}
      />
      <Space className="lagebericht-no-print" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {bericht.titel}
          </Typography.Title>
          <Tag color={istEntwurf ? 'default' : 'green'}>{istEntwurf ? 'Entwurf' : 'Freigegeben'}</Tag>
          <Tag>{v?.label ?? bericht.vorlage}</Tag>
          <Tag>v{bericht.version}</Tag>
        </Space>
        <Space>
          <Button onClick={() => window.print()}>Drucken / als PDF</Button>
          {!istEntwurf && bericht.etb_eintrag_id != null && (
            <Link to={etbPfad(einsatzId, { eintrag: bericht.etb_eintrag_id })}>Zum ETB-Eintrag</Link>
          )}
          {!istEntwurf && darfSchreiben && (
            <Button onClick={() => fortschreibenMutation.mutate()} loading={fortschreibenMutation.isPending}>
              Fortschreiben
            </Button>
          )}
          {istEntwurf && darfSchreiben && (
            <>
              <Button onClick={() => form.submit()} loading={speichernMutation.isPending}>
                Entwurf speichern
              </Button>
              <Button type="primary" onClick={freigabeBestaetigen} loading={freigebenMutation.isPending}>
                Freigeben
              </Button>
            </>
          )}
        </Space>
      </Space>

      <Typography.Paragraph type="secondary">Zeitstand: {bericht.zeitstand}</Typography.Paragraph>

      {istEntwurf && darfSchreiben ? (
        <Form
          form={form}
          layout="vertical"
          onFinish={(werte) => speichernMutation.mutate(werte as Record<string, string>)}
        >
          <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {v?.abschnitte.map((a) => (
            <Form.Item key={a.schluessel} label={a.label} name={a.schluessel}>
              <MarkdownEditor layout="split" variante="dokument" autoSize={{ minRows: 8 }} />
            </Form.Item>
          ))}
        </Form>
      ) : (
        <div className="lagebericht-druck">
          {v?.abschnitte.map((a) => {
            const text = bericht.abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
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
