import { App, Breadcrumb, Button, Form, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  aktualisiereLagebericht,
  gibLageberichtFrei,
  ladeLagebericht,
  schreibeLageberichtFort,
} from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtAnzeige } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import { vorlage } from '../lageberichte/vorlagen';
import Markdown from '../components/Markdown';
import MarkdownEditor from '../components/MarkdownEditor';
import './lageberichtPrint.css';

export default function LageberichtDetailPage() {
  const { id, lbId } = useParams();
  const einsatzId = Number(id);
  const berichtId = Number(lbId);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichtQuery = useQuery({
    queryKey: ['einsatz-lagebericht', einsatzId, berichtId],
    queryFn: () => ladeLagebericht(einsatzId, berichtId),
  });

  useEffect(() => {
    if (berichtQuery.data) {
      const werte: Record<string, string> = { titel: berichtQuery.data.titel };
      for (const a of berichtQuery.data.abschnitte) werte[a.schluessel] = a.text;
      form.setFieldsValue(werte);
    }
  }, [berichtQuery.data, form]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['einsatz-lagebericht', einsatzId, berichtId] });
    qc.invalidateQueries({ queryKey: ['einsatz-lageberichte', einsatzId] });
  };
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const speichernMutation = useMutation({
    mutationFn: (werte: Record<string, string>) => {
      const v = vorlage(berichtQuery.data!.vorlage)!;
      const abschnitte: LageberichtAbschnitt[] = v.abschnitte.map((a) => ({
        schluessel: a.schluessel,
        text: werte[a.schluessel] ?? '',
      }));
      return aktualisiereLagebericht(einsatzId, berichtId, { titel: werte.titel, abschnitte });
    },
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
      qc.invalidateQueries({ queryKey: ['einsatz-lageberichte', einsatzId] });
      navigate(`/einsaetze/${einsatzId}/lageberichte/${neu.id}`);
    },
    onError: fehler,
  });

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
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const freigabeBestaetigen = () =>
    Modal.confirm({
      title: 'Lagebericht freigeben?',
      content:
        'Die Freigabe ist endgültig und unveränderlich: Der Bericht wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich.',
      okText: 'Freigeben',
      cancelText: 'Abbrechen',
      onOk: () => freigebenMutation.mutateAsync(),
    });

  return (
    <div className="lagebericht-print-root">
      <Breadcrumb
        className="lagebericht-no-print"
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={`/einsaetze/${einsatzId}/lageberichte`}>Lageberichte</Link> },
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
