import { Alert, App, Breadcrumb, Button, Col, Row, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  CHAT_SEITENGROESSE, bearbeiteNachricht, heraufstufenZuAuftrag, heraufstufenZuEtb, ladeAnhaengeHoch, legeKanalAn,
  listeKanaele, listeNachrichten, loescheBezug, loescheNachricht, markiereKanalGelesen,
  sendeNachricht, setzeBezug,
} from '../api/chat';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeSchaeden } from '../api/einsatzSchaden';
import { listeUhs } from '../api/einsatzUhs';
import { listePersonen } from '../api/einsatzPerson';
import { listeLageberichte } from '../api/lageberichte';
import { listeMeldungen } from '../api/meldungen';
import { listeAuftraege } from '../api/auftraege';
import { einsatzKeys } from '../api/queryKeys';
import type { BezugTyp, ChatNachricht, EtbTyp, NeuerAuftrag } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import KanalListe from '../chat/KanalListe';
import NachrichtenStrom from '../chat/NachrichtenStrom';
import NachrichtEingabe from '../chat/NachrichtEingabe';
import HeraufstufenModal from '../chat/HeraufstufenModal';
import HeraufstufenAuftragModal from '../chat/HeraufstufenAuftragModal';
import BearbeitenModal from '../chat/BearbeitenModal';
import BezugDialog from '../chat/BezugDialog';
import {
  auftragInfo, auftragLabel, bezugLabel as loeseBezugLabel, lageberichtInfo, lageberichtLabel,
  meldungInfo, meldungLabel, personInfo, personLabel, schadenInfo, schadenLabel, uhsInfo, uhsLabel,
  type BezugKurzinfo, type BezugOptionen,
} from '../chat/bezug';
import Datenstand, { gemeinsamerDatenstand } from '../components/Datenstand';

export default function ChatPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const [kanalAuswahl, setKanalAuswahl] = useState<{
    einsatzId: number;
    kanalId: number;
  } | null>(null);
  const [heraufstufenAuswahl, setHeraufstufenAuswahl] = useState<{
    einsatzId: number;
    nachricht: ChatNachricht;
  } | null>(null);
  const [heraufstufenAuftragAuswahl, setHeraufstufenAuftragAuswahl] = useState<{
    einsatzId: number;
    nachricht: ChatNachricht;
  } | null>(null);
  const [bearbeitenAuswahl, setBearbeitenAuswahl] = useState<{
    einsatzId: number;
    nachricht: ChatNachricht;
  } | null>(null);
  const [bezugAuswahl, setBezugAuswahl] = useState<{
    einsatzId: number;
    nachricht: ChatNachricht;
  } | null>(null);
  const [dokumentSichtbar, setDokumentSichtbar] = useState(
    () => document.visibilityState === 'visible',
  );

  useEffect(() => {
    const aktualisieren = () => setDokumentSichtbar(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', aktualisieren);
    return () => document.removeEventListener('visibilitychange', aktualisieren);
  }, []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const kanaeleQuery = useQuery({
    queryKey: einsatzKeys.chatKanaele(einsatzId),
    queryFn: () => listeKanaele(einsatzId),
  });
  // Empfänger-Optionen für die Auftrag-Heraufstufung (LFH-101).
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  const kanaele = kanaeleQuery.data ?? [];
  const ausgewaehlterKanal = kanalAuswahl?.einsatzId === einsatzId
    ? kanalAuswahl.kanalId
    : null;
  // Beim Routewechsel darf die Kanal-ID des vorherigen Einsatzes nicht einmal für
  // einen Zwischen-Render in die neue URL geraten. Erst die erfolgreich geladene,
  // aktuelle Kanalliste darf eine explizite Auswahl oder ihren ersten Kanal freigeben.
  const kanalId = kanaeleQuery.isSuccess
    ? kanaele.some((kanal) => kanal.id === ausgewaehlterKanal)
      ? ausgewaehlterKanal
      : kanaele[0]?.id ?? null
    : null;
  const heraufstufen = heraufstufenAuswahl?.einsatzId === einsatzId
    ? heraufstufenAuswahl.nachricht
    : null;
  const heraufstufenAuftrag = heraufstufenAuftragAuswahl?.einsatzId === einsatzId
    ? heraufstufenAuftragAuswahl.nachricht
    : null;
  const bearbeiten = bearbeitenAuswahl?.einsatzId === einsatzId
    ? bearbeitenAuswahl.nachricht
    : null;
  const bezugNachricht = bezugAuswahl?.einsatzId === einsatzId
    ? bezugAuswahl.nachricht
    : null;
  const ungelesenImAktivenKanal = kanaele.find((kanal) => kanal.id === kanalId)?.ungelesen_anzahl ?? 0;

  const nachrichtenQuery = useInfiniteQuery({
    queryKey: einsatzKeys.chatNachrichtenKanal(einsatzId, kanalId),
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

  // Erst NACH einem erfolgreichen Nachrichtenabruf markieren. Der serverseitige Zustand
  // ist pro Nachricht und Benutzer persistent; ein späteres SSE-Update hebt den Stand durch
  // `dataUpdatedAt` erneut an und markiert den gerade sichtbaren Kanal wieder gelesen.
  useEffect(() => {
    if (
      !dokumentSichtbar || document.visibilityState !== 'visible' ||
      kanalId === null || ungelesenImAktivenKanal === 0 ||
      !nachrichtenQuery.isSuccess || nachrichtenQuery.dataUpdatedAt === 0
    ) return;
    let aktiv = true;
    void markiereKanalGelesen(einsatzId, kanalId)
      .then(() => {
        if (aktiv) void qc.invalidateQueries({ queryKey: einsatzKeys.chatKanaele(einsatzId) });
      })
      .catch(() => {
        // Die Kanalliste behält ihren ungelesenen Stand und macht den Fehlschlag damit sichtbar;
        // keine störende Toast-Schleife bei jedem Live-Refetch.
      });
    return () => { aktiv = false; };
  }, [
    einsatzId,
    dokumentSichtbar,
    kanalId,
    nachrichtenQuery.dataUpdatedAt,
    nachrichtenQuery.isSuccess,
    qc,
    ungelesenImAktivenKanal,
  ]);

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
    queryKey: einsatzKeys.schaeden(einsatzId), queryFn: () => listeSchaeden(einsatzId), enabled: typAktiv('schaden'),
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId), queryFn: () => listeUhs(einsatzId), enabled: typAktiv('uhs'),
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId), queryFn: () => listePersonen(einsatzId), enabled: typAktiv('person'),
  });
  const lageberichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId), queryFn: () => listeLageberichte(einsatzId), enabled: typAktiv('lagebericht'),
  });
  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId), queryFn: () => listeMeldungen(einsatzId), enabled: typAktiv('meldung'),
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId), queryFn: () => listeAuftraege(einsatzId), enabled: typAktiv('auftrag'),
  });

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiereNachrichten = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.chatNachrichten(einsatzId) });

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
      setBearbeitenAuswahl(null);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.chatKanaele(einsatzId) }),
    onError: fehler,
  });
  const heraufstufenMutation = useMutation({
    mutationFn: ({ nid, typ, text }: { nid: number; typ: EtbTyp; text: string }) =>
      heraufstufenZuEtb(einsatzId, nid, typ, text),
    onSuccess: () => {
      invalidiereNachrichten();
      setHeraufstufenAuswahl(null);
      message.success('Zu ETB heraufgestuft');
    },
    onError: fehler,
  });
  const heraufstufenAuftragMutation = useMutation({
    mutationFn: ({ nid, daten }: { nid: number; daten: NeuerAuftrag }) =>
      heraufstufenZuAuftrag(einsatzId, nid, daten),
    onSuccess: () => {
      invalidiereNachrichten();
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setHeraufstufenAuftragAuswahl(null);
      message.success('Zu Auftrag heraufgestuft');
    },
    onError: fehler,
  });
  const bezugMutation = useMutation({
    mutationFn: ({ nid, typ, zielId }: { nid: number; typ: BezugTyp; zielId: number }) =>
      setzeBezug(einsatzId, nid, typ, zielId),
    onSuccess: () => {
      invalidiereNachrichten();
      setBezugAuswahl(null);
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
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

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

  // Kurzinfo fürs Bezug-Popover: Objekt in der passenden (lazy geladenen) Liste suchen.
  // `null`, wenn nicht (mehr) verfügbar → Tag bleibt ohne Popover.
  const bezugInfo = (typ: BezugTyp, zielId: number): BezugKurzinfo | null => {
    switch (typ) {
      case 'schaden': { const o = schaedenQuery.data?.find((x) => x.id === zielId); return o ? schadenInfo(o) : null; }
      case 'uhs': { const o = uhsQuery.data?.find((x) => x.id === zielId); return o ? uhsInfo(o) : null; }
      case 'person': { const o = personenQuery.data?.find((x) => x.id === zielId); return o ? personInfo(o) : null; }
      case 'lagebericht': { const o = lageberichteQuery.data?.find((x) => x.id === zielId); return o ? lageberichtInfo(o) : null; }
      case 'meldung': { const o = meldungenQuery.data?.find((x) => x.id === zielId); return o ? meldungInfo(o) : null; }
      case 'auftrag': { const o = auftraegeQuery.data?.find((x) => x.id === zielId); return o ? auftragInfo(o) : null; }
    }
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
      <Datenstand dataUpdatedAt={gemeinsamerDatenstand(
        kanaeleQuery.dataUpdatedAt,
        nachrichtenQuery.dataUpdatedAt,
      )} />
      <Row gutter={16}>
        <Col flex="220px">
          <KanalListe
            kanaele={kanaele}
            aktiverKanalId={kanalId}
            onWechsel={(neuerKanalId) => setKanalAuswahl({
              einsatzId,
              kanalId: neuerKanalId,
            })}
            darfSchreiben={darfSchreiben}
            onKanalAnlegen={(name, beschreibung) => kanalMutation.mutate({ name, beschreibung })}
          />
        </Col>
        <Col flex="auto">
          {nachrichtenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }}
              title="Nachrichten konnten nicht geladen werden" />
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
            onBearbeiten={(n) => setBearbeitenAuswahl({ einsatzId, nachricht: n })}
            onLoeschen={(n) => loeschenMutation.mutate(n.id)}
            onHeraufstufen={(n) => setHeraufstufenAuswahl({ einsatzId, nachricht: n })}
            onHeraufstufenAuftrag={(n) => setHeraufstufenAuftragAuswahl({
              einsatzId,
              nachricht: n,
            })}
            onBezugSetzen={(n) => setBezugAuswahl({ einsatzId, nachricht: n })}
            onBezugLoeschen={(n) => bezugLoeschenMutation.mutate(n.id)}
            bezugLabel={(typ, zielId) => loeseBezugLabel(typ, zielId, bezugOptionen)}
            bezugInfo={bezugInfo}
          />
          {darfSchreiben && kanalId !== null && (
            <NachrichtEingabe
              onSenden={(t, d) => sendenMutation.mutate({ text: t, dateien: d })}
              senden={sendenMutation.isPending}
            />
          )}
          {!darfSchreiben && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              title={
                einsatz.status !== 'aktiv'
                  ? 'Schreiben ist nur bei aktivem Einsatz möglich.'
                  : 'Schreiben ist der Einsatzleitung und dem Führungspersonal vorbehalten.'
              }
            />
          )}
        </Col>
      </Row>
      <BezugDialog
        offen={bezugNachricht !== null}
        nachricht={bezugNachricht}
        optionen={bezugOptionen}
        senden={bezugMutation.isPending}
        onAbbrechen={() => setBezugAuswahl(null)}
        onBestaetigen={(typ, zielId) => {
          if (bezugNachricht) bezugMutation.mutate({ nid: bezugNachricht.id, typ, zielId });
        }}
      />
      <BearbeitenModal
        offen={bearbeiten !== null}
        nachricht={bearbeiten}
        senden={bearbeitenMutation.isPending}
        onAbbrechen={() => setBearbeitenAuswahl(null)}
        onBestaetigen={(text) => {
          if (bearbeiten) bearbeitenMutation.mutate({ id: bearbeiten.id, text });
        }}
      />
      <HeraufstufenModal
        offen={heraufstufen !== null}
        nachricht={heraufstufen}
        senden={heraufstufenMutation.isPending}
        onAbbrechen={() => setHeraufstufenAuswahl(null)}
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
        onAbbrechen={() => setHeraufstufenAuftragAuswahl(null)}
        // mutateAsync: die Erfassungshülle im Formular darf die Felder nur leeren,
        // wenn der Auftrag wirklich angekommen ist (LFH-332/B4).
        onAnlegen={(daten) => (heraufstufenAuftrag
          ? heraufstufenAuftragMutation.mutateAsync({ nid: heraufstufenAuftrag.id, daten })
          : Promise.reject(new Error('Keine Quellnachricht')))}
      />
    </div>
  );
}
