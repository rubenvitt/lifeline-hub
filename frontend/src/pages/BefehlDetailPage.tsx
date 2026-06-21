import { App, Breadcrumb, Button, Form, Input, Space, Spin, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
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

export default function BefehlDetailPage() {
  const { id, bid } = useParams();
  const einsatzId = Number(id);
  const befehlId = Number(bid);
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const befehlQuery = useQuery({
    queryKey: ['einsatz-befehl', einsatzId, befehlId],
    queryFn: () => ladeBefehl(einsatzId, befehlId),
  });

  useEffect(() => {
    if (befehlQuery.data) {
      const werte: Record<string, string> = { titel: befehlQuery.data.titel };
      for (const a of befehlQuery.data.abschnitte) werte[a.schluessel] = a.text;
      form.setFieldsValue(werte);
    }
  }, [befehlQuery.data, form]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['einsatz-befehl', einsatzId, befehlId] });
    qc.invalidateQueries({ queryKey: ['einsatz-befehle', einsatzId] });
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
      qc.invalidateQueries({ queryKey: ['einsatz-befehle', einsatzId] });
      navigate(`/einsaetze/${einsatzId}/auftraege/befehle/${neu.id}`);
    },
    onError: fehler,
  });

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
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

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
          { title: <Link to={`/einsaetze/${einsatzId}/auftraege`}>Aufträge/Befehle</Link> },
          { title: befehl.titel },
        ]}
      />
      <Space className="befehl-no-print" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {befehl.titel}
          </Typography.Title>
          <Tag color={istEntwurf ? 'default' : 'green'}>{istEntwurf ? 'Entwurf' : 'Freigegeben'}</Tag>
          <Tag>{v?.label ?? befehl.vorlage}</Tag>
          <Tag>v{befehl.version}</Tag>
        </Space>
        <Space>
          <Button onClick={() => window.print()}>Drucken / als PDF</Button>
          {!istEntwurf && befehl.etb_eintrag_id != null && (
            <Link to={`/einsaetze/${einsatzId}/etb`}>Zum ETB-Eintrag</Link>
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

      <Typography.Paragraph type="secondary">Zeitstand: {befehl.zeitstand}</Typography.Paragraph>

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
