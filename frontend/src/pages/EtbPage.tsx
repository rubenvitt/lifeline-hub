import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, schliesseEinsatzAb } from '../api/einsaetze';
import { listeBausteine } from '../api/etbBaustein';
import { SEITENGROESSE, erteileAuftragAusEtb, listeEtb, type EtbFilterWerte, type NeuerEintrag } from '../api/etb';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import { parseRouteId } from '../routing/deeplinks';
import { useEffect, useState } from 'react';
import EtbTabelle from '../etb/EtbTabelle';
import EtbFilterleiste from '../etb/EtbFilterleiste';
import WiedervorlageModal from '../etb/WiedervorlageModal';
import AuftragAusEtbModal from '../etb/AuftragAusEtbModal';
import Schnellerfassung from '../etb/Schnellerfassung';
import EtbEntwurfsTabs from '../etb/entwuerfe/EtbEntwurfsTabs';
import { useEtbErfassung } from '../offline/useEtbErfassung';

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207-C):
  // der etb-Listener dort invalidiert ['etb', einsatzId] (Prefix deckt die gefilterte Liste ab).
  const [filter, setFilter] = useState<EtbFilterWerte>({});

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const bausteineQuery = useQuery({ queryKey: ['etb-bausteine'], queryFn: listeBausteine });

  // Auftrags-Ziele für das ETB→Auftrag-Formular (wie AuftraegePage/MeldungenPage).
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });

  const etbQuery = useInfiniteQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, filter),
    queryFn: ({ pageParam }) => listeEtb(einsatzId, { ...filter, before_lfd_nr: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (letzteSeite) =>
      letzteSeite.length === SEITENGROESSE
        ? letzteSeite[letzteSeite.length - 1].lfd_nr
        : undefined,
  });

  const eintraege = etbQuery.data?.pages.flat() ?? [];

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [berichtigungZu, setBerichtigungZu] = useState<EtbEintragAnzeige | null>(null);
  const [wiedervorlageZu, setWiedervorlageZu] = useState<EtbEintragAnzeige | null>(null);
  const [auftragZu, setAuftragZu] = useState<EtbEintragAnzeige | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const { erfassen, ausstehend, abgelehnt, abgelehntVerwerfen } = useEtbErfassung(einsatzId);

  const [searchParams, setSearchParams] = useSearchParams();
  // Schnellaktion: ?neu=1 fokussiert die angepinnte Erfassungszeile (Command-Palette, LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    const leiste = document.querySelector('.etb-erfassung-sticky');
    if (leiste instanceof HTMLElement) {
      leiste.scrollIntoView({ block: 'start' });
      const feld = leiste.querySelector('textarea, input');
      if (feld instanceof HTMLElement) feld.focus();
    }
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Deeplink ?eintrag=<id> (LFH-25): adressiert einen ETB-Eintrag. Da die Liste neueste-zuerst
  // paginiert ist, werden ältere Seiten gezielt nachgeladen, bis der Eintrag gefunden ist
  // (durch das Pagination-Ende begrenzt). Danach Highlight setzen und den Param räumen.
  const zielEintragId = parseRouteId(searchParams.get('eintrag') ?? undefined);
  useEffect(() => {
    if (zielEintragId == null) return;
    if (etbQuery.isLoading) return;
    const gefunden = (etbQuery.data?.pages.flat() ?? []).some((e) => e.id === zielEintragId);
    if (!gefunden && etbQuery.hasNextPage) {
      if (!etbQuery.isFetchingNextPage) etbQuery.fetchNextPage();
      return; // nach dem Laden re-läuft der Effekt (etbQuery.data ändert sich)
    }
    if (gefunden) setHighlightId(zielEintragId);
    searchParams.delete('eintrag');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zielEintragId, etbQuery.data, etbQuery.hasNextPage, etbQuery.isFetchingNextPage, etbQuery.isLoading]);

  useEffect(() => {
    if (highlightId == null) return;
    document.querySelector(`[data-row-key="${highlightId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightId]);

  const abschliessenMutation = useMutation({
    mutationFn: () => schliesseEinsatzAb(einsatzId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: ['einsaetze'] });
      message.success('Einsatz abgeschlossen');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Abschließen fehlgeschlagen'),
  });

  const auftragMutation = useMutation({
    mutationFn: ({ eintragId, daten }: { eintragId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusEtb(einsatzId, eintragId, daten),
    onSuccess: () => {
      // ETB (neue Anordnung) + Auftrags-Board aktualisieren.
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setAuftragZu(null);
      message.success('Auftrag aus ETB-Eintrag erteilt');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Auftrag erteilen fehlgeschlagen'),
  });

  async function erfassenMitMeldung(e: NeuerEintrag) {
    try {
      await erfassen(e);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      throw err;
    }
  }

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

  const darfAbschliessen = einsatz.status === 'aktiv' && einsatz.meine_rolle === 'einsatzleitung';

  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  return (
    <div>
      {/* Dezente Breadcrumb-Zeile als Rückweg: vom Content getrennt, kein versehentlicher
          Kontextwechsel mitten im Tagebuch. Klick auf „Einsätze“ führt zur Liste zurück. */}
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {einsatz.bezeichnung}
          </Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        <Space>
          {darfAbschliessen && (
            <Popconfirm
              title="Einsatz abschließen?"
              description="Danach sind keine neuen Einträge oder Berichtigungen mehr möglich."
              okText="Ja"
              cancelText="Abbrechen"
              onConfirm={() => abschliessenMutation.mutate()}
            >
              <Button danger loading={abschliessenMutation.isPending}>
                Einsatz abschließen
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      {/* Erfassung als angepinnte Kommandozeile am Kopf des Tagebuchs: Da die
          Tabelle neueste-zuerst sortiert, erscheint ein neuer Eintrag direkt
          unter dem Eingabefeld — kein Scrollen an der ganzen Liste vorbei mehr.
          Die Leiste bleibt beim Blättern durch ältere Einträge sichtbar (sticky). */}
      {darfSchreiben && (
        <div className="etb-erfassung-sticky">
          {berichtigungZu ? (
            <Schnellerfassung
              key="berichtigung"
              erfassen={erfassenMitMeldung}
              berichtigungZu={berichtigungZu}
              onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
              bausteine={bausteineQuery.data ?? []}
              einsatz={einsatz}
            />
          ) : (
            <EtbEntwurfsTabs
              einsatzId={einsatzId}
              erfassen={erfassenMitMeldung}
              bausteine={bausteineQuery.data ?? []}
              einsatz={einsatz}
            />
          )}
        </div>
      )}

      {etbQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="ETB-Einträge konnten nicht geladen werden"
        />
      )}

      <EtbFilterleiste onChange={setFilter} />
      {abgelehnt.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title={`${abgelehnt.length} gepufferte(r) Eintrag/Einträge wurde(n) vom Server abgelehnt und NICHT gespeichert`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {abgelehnt.map((a) => (
                <li key={a.id}>
                  {a.eintrag.inhalt} — {a.grund}
                  {a.id != null && (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => void abgelehntVerwerfen(a.id!)}
                    >
                      verwerfen
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          }
        />
      )}
      {ausstehend.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={`${ausstehend.length} Eintrag/Einträge werden gesendet, sobald wieder Verbindung besteht`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ausstehend.map((a) => (
                <li key={a.id}>{a.eintrag.inhalt}</li>
              ))}
            </ul>
          }
        />
      )}
      <EtbTabelle
        eintraege={eintraege}
        einsatzId={einsatzId}
        highlightId={highlightId}
        onBerichtigen={darfSchreiben ? (e) => setBerichtigungZu(e) : undefined}
        onWiedervorlage={darfSchreiben ? (e) => setWiedervorlageZu(e) : undefined}
        onAuftragErteilen={darfSchreiben ? (e) => setAuftragZu(e) : undefined}
      />

      {etbQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => etbQuery.fetchNextPage()} loading={etbQuery.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}

      {darfSchreiben && (
        <WiedervorlageModal
          einsatzId={einsatzId}
          eintrag={wiedervorlageZu}
          onClose={() => setWiedervorlageZu(null)}
        />
      )}
      {darfSchreiben && (
        <AuftragAusEtbModal
          eintrag={auftragZu}
          abschnitte={(abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
          einheiten={(einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
          senden={auftragMutation.isPending}
          onAbbrechen={() => setAuftragZu(null)}
          onAnlegen={(daten) => {
            if (auftragZu) auftragMutation.mutate({ eintragId: auftragZu.id, daten });
          }}
        />
      )}
    </div>
  );
}
