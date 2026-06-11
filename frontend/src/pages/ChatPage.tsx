import { Alert, App, Breadcrumb, Col, Row, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  bearbeiteNachricht, heraufstufenZuEtb, legeKanalAn, listeKanaele, listeNachrichten,
  loescheNachricht, sendeNachricht,
} from '../api/chat';
import type { ChatNachricht, EtbTyp } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import KanalListe from '../chat/KanalListe';
import NachrichtenStrom from '../chat/NachrichtenStrom';
import NachrichtEingabe from '../chat/NachrichtEingabe';
import HeraufstufenModal from '../chat/HeraufstufenModal';

export default function ChatPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const [aktiverKanal, setAktiverKanal] = useState<number | null>(null);
  const [heraufstufen, setHeraufstufen] = useState<ChatNachricht | null>(null);

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const kanaeleQuery = useQuery({
    queryKey: ['einsatz-chat-kanaele', einsatzId],
    queryFn: () => listeKanaele(einsatzId),
  });

  const kanaele = kanaeleQuery.data ?? [];
  const kanalId = aktiverKanal ?? kanaele[0]?.id ?? null;

  const nachrichtenQuery = useQuery({
    queryKey: ['einsatz-chat-nachrichten', einsatzId, kanalId],
    queryFn: () => listeNachrichten(einsatzId, kanalId as number),
    enabled: kanalId !== null,
  });

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiereNachrichten = () =>
    qc.invalidateQueries({ queryKey: ['einsatz-chat-nachrichten', einsatzId] });

  const sendenMutation = useMutation({
    mutationFn: (text: string) => sendeNachricht(einsatzId, kanalId as number, text),
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const bearbeitenMutation = useMutation({
    mutationFn: ({ id: nid, text }: { id: number; text: string }) => bearbeiteNachricht(einsatzId, nid, text),
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const loeschenMutation = useMutation({
    mutationFn: (nid: number) => loescheNachricht(einsatzId, nid),
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const kanalMutation = useMutation({
    mutationFn: (daten: { name: string; beschreibung?: string }) => legeKanalAn(einsatzId, daten),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['einsatz-chat-kanaele', einsatzId] }),
    onError: fehler,
  });
  const heraufstufenMutation = useMutation({
    mutationFn: ({ nid, typ, text }: { nid: number; typ: EtbTyp; text: string }) =>
      heraufstufenZuEtb(einsatzId, nid, typ, text),
    onSuccess: () => {
      invalidiereNachrichten();
      setHeraufstufen(null);
      message.success('Zu ETB heraufgestuft');
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const nachrichten = [...(nachrichtenQuery.data ?? [])].sort((a, b) => a.id - b.id);

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Chat' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Chat</Typography.Title>
      <Row gutter={16}>
        <Col flex="220px">
          <KanalListe
            kanaele={kanaele}
            aktiverKanalId={kanalId}
            onWechsel={setAktiverKanal}
            darfSchreiben={darfSchreiben}
            onKanalAnlegen={(name, beschreibung) => kanalMutation.mutate({ name, beschreibung })}
          />
        </Col>
        <Col flex="auto">
          {nachrichtenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }}
              message="Nachrichten konnten nicht geladen werden" />
          )}
          <NachrichtenStrom
            nachrichten={nachrichten}
            eigeneBenutzerId={benutzer?.id ?? null}
            darfSchreiben={darfSchreiben}
            onBearbeiten={(n) => {
              const text = window.prompt('Nachricht bearbeiten', n.inhalt ?? '');
              if (text && text.trim()) bearbeitenMutation.mutate({ id: n.id, text: text.trim() });
            }}
            onLoeschen={(n) => loeschenMutation.mutate(n.id)}
            onHeraufstufen={(n) => setHeraufstufen(n)}
          />
          {darfSchreiben && kanalId !== null && (
            <NachrichtEingabe onSenden={(t) => sendenMutation.mutate(t)} senden={sendenMutation.isPending} />
          )}
        </Col>
      </Row>
      <HeraufstufenModal
        offen={heraufstufen !== null}
        nachricht={heraufstufen}
        senden={heraufstufenMutation.isPending}
        onAbbrechen={() => setHeraufstufen(null)}
        onBestaetigen={(typ, text) => {
          if (heraufstufen) heraufstufenMutation.mutate({ nid: heraufstufen.id, typ, text });
        }}
      />
    </div>
  );
}
