import { Alert, App, Breadcrumb, Button, Col, Row, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  CHAT_SEITENGROESSE, bearbeiteNachricht, heraufstufenZuAuftrag, heraufstufenZuEtb, ladeAnhaengeHoch, legeKanalAn,
  listeKanaele, listeNachrichten, loescheBezug, loescheNachricht, sendeNachricht, setzeBezug,
} from '../api/chat';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeSchaeden } from '../api/einsatzSchaden';
import { listeUhs } from '../api/einsatzUhs';
import { listePersonen } from '../api/einsatzPerson';
import { listeLageberichte } from '../api/lageberichte';
import { listeMeldungen } from '../api/meldungen';
import { listeAuftraege } from '../api/auftraege';
import type { BezugTyp, ChatNachricht, EtbTyp, NeuerAuftrag } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import KanalListe from '../chat/KanalListe';
import NachrichtenStrom from '../chat/NachrichtenStrom';
import NachrichtEingabe from '../chat/NachrichtEingabe';
import HeraufstufenModal from '../chat/HeraufstufenModal';
import HeraufstufenAuftragModal from '../chat/HeraufstufenAuftragModal';
import BearbeitenModal from '../chat/BearbeitenModal';
import BezugDialog from '../chat/BezugDialog';
import {
  auftragLabel, bezugLabel as loeseBezugLabel, lageberichtLabel, meldungLabel, personLabel,
  schadenLabel, uhsLabel, type BezugOptionen,
} from '../chat/bezug';

export default function ChatPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const [aktiverKanal, setAktiverKanal] = useState<number | null>(null);
  const [heraufstufen, setHeraufstufen] = useState<ChatNachricht | null>(null);
  const [heraufstufenAuftrag, setHeraufstufenAuftrag] = useState<ChatNachricht | null>(null);
  const [bearbeiten, setBearbeiten] = useState<ChatNachricht | null>(null);
  const [bezugNachricht, setBezugNachricht] = useState<ChatNachricht | null>(null);

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const kanaeleQuery = useQuery({
    queryKey: ['einsatz-chat-kanaele', einsatzId],
    queryFn: () => listeKanaele(einsatzId),
  });
  // Empfänger-Optionen für die Auftrag-Heraufstufung (LFH-101).
  const abschnitteQuery = useQuery({
    queryKey: ['einsatz-abschnitte', einsatzId],
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: ['einsatz-einheiten', einsatzId],
    queryFn: () => listeEinheiten(einsatzId),
  });

  const kanaele = kanaeleQuery.data ?? [];
  const kanalId = aktiverKanal ?? kanaele[0]?.id ?? null;

  const nachrichtenQuery = useInfiniteQuery({
    queryKey: ['einsatz-chat-nachrichten', einsatzId, kanalId],
    queryFn: ({ pageParam }) => listeNachrichten(einsatzId, kanalId as number, pageParam),
    initialPageParam: undefined as number | undefined,
    // Backend liefert je Seite id DESC (neueste zuerst); der Cursor für ältere
    // Nachrichten ist die kleinste (= letzte) id der zuletzt geladenen Seite.
    getNextPageParam: (letzteSeite) =>
      letzteSeite.length === CHAT_SEITENGROESSE
        ? letzteSeite[letzteSeite.length - 1].id
        : undefined,
    enabled: kanalId !== null,
  });

  // Sachbezug-Picker/Anzeige (LFH-103): Listen je Typ nur laden, wenn der Dialog offen
  // ist (Picker) ODER eine geladene Nachricht diesen Typ referenziert (Label-Auflösung)
  // — vermeidet 6 eager Requests bei jedem Chat-Öffnen.
  const bezugDialogOffen = bezugNachricht !== null;
  const referenzierteTypen = new Set<BezugTyp>();
  for (const n of nachrichtenQuery.data?.pages.flat() ?? []) {
    if (n.bezug_typ) referenzierteTypen.add(n.bezug_typ);
  }
  const typAktiv = (t: BezugTyp) => bezugDialogOffen || referenzierteTypen.has(t);

  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId], queryFn: () => listeSchaeden(einsatzId), enabled: typAktiv('schaden'),
  });
  const uhsQuery = useQuery({
    queryKey: ['einsatz-uhs', einsatzId], queryFn: () => listeUhs(einsatzId), enabled: typAktiv('uhs'),
  });
  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId], queryFn: () => listePersonen(einsatzId), enabled: typAktiv('person'),
  });
  const lageberichteQuery = useQuery({
    queryKey: ['einsatz-lageberichte', einsatzId], queryFn: () => listeLageberichte(einsatzId), enabled: typAktiv('lagebericht'),
  });
  const meldungenQuery = useQuery({
    queryKey: ['einsatz-meldungen', einsatzId], queryFn: () => listeMeldungen(einsatzId), enabled: typAktiv('meldung'),
  });
  const auftraegeQuery = useQuery({
    queryKey: ['einsatz-auftraege', einsatzId], queryFn: () => listeAuftraege(einsatzId), enabled: typAktiv('auftrag'),
  });

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiereNachrichten = () =>
    qc.invalidateQueries({ queryKey: ['einsatz-chat-nachrichten', einsatzId] });

  const sendenMutation = useMutation({
    // Zweistufig: erst Anhänge hochladen (falls vorhanden), dann Nachricht mit den
    // resultierenden anhang_ids senden.
    mutationFn: async ({ text, dateien }: { text: string; dateien: File[] }) => {
      const anhaenge = dateien.length > 0 ? await ladeAnhaengeHoch(einsatzId, dateien) : [];
      return sendeNachricht(einsatzId, kanalId as number, text, anhaenge.map((a) => a.id));
    },
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const bearbeitenMutation = useMutation({
    mutationFn: ({ id: nid, text }: { id: number; text: string }) => bearbeiteNachricht(einsatzId, nid, text),
    onSuccess: () => {
      invalidiereNachrichten();
      setBearbeiten(null);
    },
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
  const heraufstufenAuftragMutation = useMutation({
    mutationFn: ({ nid, daten }: { nid: number; daten: NeuerAuftrag }) =>
      heraufstufenZuAuftrag(einsatzId, nid, daten),
    onSuccess: () => {
      invalidiereNachrichten();
      qc.invalidateQueries({ queryKey: ['einsatz-auftraege', einsatzId] });
      setHeraufstufenAuftrag(null);
      message.success('Zu Auftrag heraufgestuft');
    },
    onError: fehler,
  });
  const bezugMutation = useMutation({
    mutationFn: ({ nid, typ, zielId }: { nid: number; typ: BezugTyp; zielId: number }) =>
      setzeBezug(einsatzId, nid, typ, zielId),
    onSuccess: () => {
      invalidiereNachrichten();
      setBezugNachricht(null);
      message.success('Bezug gesetzt');
    },
    onError: fehler,
  });
  const bezugLoeschenMutation = useMutation({
    mutationFn: (nid: number) => loescheBezug(einsatzId, nid),
    onSuccess: () => {
      invalidiereNachrichten();
      message.success('Bezug entfernt');
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

  const nachrichten = [...(nachrichtenQuery.data?.pages.flat() ?? [])].sort((a, b) => a.id - b.id);

  // Wählbare/auflösbare Bezug-Objekte je Typ aus den (lazy geladenen) Listen.
  const bezugOptionen: BezugOptionen = {
    schaden: (schaedenQuery.data ?? []).map((s) => ({ value: s.id, label: schadenLabel(s) })),
    uhs: (uhsQuery.data ?? []).map((u) => ({ value: u.id, label: uhsLabel(u) })),
    person: (personenQuery.data ?? []).map((p) => ({ value: p.id, label: personLabel(p) })),
    lagebericht: (lageberichteQuery.data ?? []).map((l) => ({ value: l.id, label: lageberichtLabel(l) })),
    meldung: (meldungenQuery.data ?? []).map((m) => ({ value: m.id, label: meldungLabel(m) })),
    auftrag: (auftraegeQuery.data ?? []).map((a) => ({ value: a.id, label: auftragLabel(a) })),
  };

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
          {nachrichtenQuery.hasNextPage && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <Button
                onClick={() => nachrichtenQuery.fetchNextPage()}
                loading={nachrichtenQuery.isFetchingNextPage}
              >
                Ältere laden
              </Button>
            </div>
          )}
          <NachrichtenStrom
            nachrichten={nachrichten}
            eigeneBenutzerId={benutzer?.id ?? null}
            darfSchreiben={darfSchreiben}
            onBearbeiten={(n) => setBearbeiten(n)}
            onLoeschen={(n) => loeschenMutation.mutate(n.id)}
            onHeraufstufen={(n) => setHeraufstufen(n)}
            onHeraufstufenAuftrag={(n) => setHeraufstufenAuftrag(n)}
            onBezugSetzen={(n) => setBezugNachricht(n)}
            onBezugLoeschen={(n) => bezugLoeschenMutation.mutate(n.id)}
            bezugLabel={(typ, zielId) => loeseBezugLabel(typ, zielId, bezugOptionen)}
          />
          {darfSchreiben && kanalId !== null && (
            <NachrichtEingabe
              onSenden={(t, d) => sendenMutation.mutate({ text: t, dateien: d })}
              senden={sendenMutation.isPending}
            />
          )}
        </Col>
      </Row>
      <BezugDialog
        offen={bezugNachricht !== null}
        nachricht={bezugNachricht}
        optionen={bezugOptionen}
        senden={bezugMutation.isPending}
        onAbbrechen={() => setBezugNachricht(null)}
        onBestaetigen={(typ, zielId) => {
          if (bezugNachricht) bezugMutation.mutate({ nid: bezugNachricht.id, typ, zielId });
        }}
      />
      <BearbeitenModal
        offen={bearbeiten !== null}
        nachricht={bearbeiten}
        senden={bearbeitenMutation.isPending}
        onAbbrechen={() => setBearbeiten(null)}
        onBestaetigen={(text) => {
          if (bearbeiten) bearbeitenMutation.mutate({ id: bearbeiten.id, text });
        }}
      />
      <HeraufstufenModal
        offen={heraufstufen !== null}
        nachricht={heraufstufen}
        senden={heraufstufenMutation.isPending}
        onAbbrechen={() => setHeraufstufen(null)}
        onBestaetigen={(typ, text) => {
          if (heraufstufen) heraufstufenMutation.mutate({ nid: heraufstufen.id, typ, text });
        }}
      />
      <HeraufstufenAuftragModal
        offen={heraufstufenAuftrag !== null}
        nachricht={heraufstufenAuftrag}
        abschnitte={(abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
        einheiten={(einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
        senden={heraufstufenAuftragMutation.isPending}
        onAbbrechen={() => setHeraufstufenAuftrag(null)}
        onAnlegen={(daten) => {
          if (heraufstufenAuftrag) heraufstufenAuftragMutation.mutate({ nid: heraufstufenAuftrag.id, daten });
        }}
      />
    </div>
  );
}
