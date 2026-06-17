import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, schliesseEinsatzAb } from '../api/einsaetze';
import { listeBausteine } from '../api/etbBaustein';
import { SEITENGROESSE, erteileAuftragAusEtb, listeEtb, type EtbFilterWerte, type NeuerEintrag } from '../api/etb';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { ApiError } from '../api/client';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import { useState } from 'react';
import EtbTabelle from '../etb/EtbTabelle';
import EtbFilterleiste from '../etb/EtbFilterleiste';
import MitgliederPanel from '../etb/MitgliederPanel';
import WiedervorlageModal from '../etb/WiedervorlageModal';
import AuftragAusEtbModal from '../etb/AuftragAusEtbModal';
import Schnellerfassung from '../etb/Schnellerfassung';
import { useEtbStream } from '../etb/useEtbStream';
import { useEtbErfassung } from '../offline/useEtbErfassung';

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useEtbStream(einsatzId);
  const [filter, setFilter] = useState<EtbFilterWerte>({});

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const bausteineQuery = useQuery({ queryKey: ['etb-bausteine'], queryFn: listeBausteine });

  // Auftrags-Ziele für das ETB→Auftrag-Formular (wie AuftraegePage/MeldungenPage).
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });

  const etbQuery = useInfiniteQuery({
    queryKey: ['etb', einsatzId, filter],
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
  const [mitgliederOffen, setMitgliederOffen] = useState(false);
  const { erfassen, ausstehend, abgelehnt } = useEtbErfassung(einsatzId);

  const abschliessenMutation = useMutation({
    mutationFn: () => schliesseEinsatzAb(einsatzId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz', einsatzId] });
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
      qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-auftraege', einsatzId] });
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
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  const istEinsatzleitung = einsatz.meine_rolle === 'einsatzleitung';
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
          {istEinsatzleitung && (
            <Button onClick={() => setMitgliederOffen(true)}>Mitglieder</Button>
          )}
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
          <Schnellerfassung
            erfassen={erfassenMitMeldung}
            berichtigungZu={berichtigungZu}
            onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
            bausteine={bausteineQuery.data ?? []}
            einsatz={einsatz}
          />
        </div>
      )}

      {etbQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="ETB-Einträge konnten nicht geladen werden"
        />
      )}

      <EtbFilterleiste onChange={setFilter} />
      {abgelehnt.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${abgelehnt.length} gepufferte(r) Eintrag/Einträge wurde(n) vom Server abgelehnt und NICHT gespeichert`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {abgelehnt.map((a, i) => (
                <li key={i}>{a.eintrag.inhalt} — {a.grund}</li>
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
          message={`${ausstehend.length} Eintrag/Einträge werden gesendet, sobald wieder Verbindung besteht`}
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

      {istEinsatzleitung && (
        <MitgliederPanel
          einsatzId={einsatzId}
          istAktiv={einsatz.status === 'aktiv'}
          offen={mitgliederOffen}
          onClose={() => setMitgliederOffen(false)}
        />
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
