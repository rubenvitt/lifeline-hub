import { Breadcrumb, Button, type TableColumnsType } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { uhsDetailPfad } from '../routing/deeplinks';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import UhsAnlegenDrawer from './uhs/UhsAnlegenDrawer';
import type { Uhs, UhsStatus, UhsTyp } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { uhsStatus, uhsTyp } from '../theme/statusFarben';
import KatalogTabelle from '../components/KatalogTabelle';

export default function UnfallhilfsstellenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  const [searchParams, setSearchParams] = useSearchParams();
  // Schnellaktion: ?neu=1 öffnet den Anlegen-Drawer, sobald die Rechte feststehen (LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (!schreibgeschuetzt) setAnlegen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, schreibgeschuetzt]);

  const spalten: TableColumnsType<Uhs> = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', render: (b: string, u) =>
        <Link to={uhsDetailPfad(einsatzId, u.id)}>{b}</Link> },
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => uhsTyp[t].label },
    { title: 'Status', dataIndex: 'status', render: (s: UhsStatus) => <StatusTag darstellung={uhsStatus[s]} /> },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  // ZWEI EBENEN, getrennt gehalten (LFH-331 · B3, D3):
  //
  // SEITENZUSTAND — nur `einsatzQuery`. Breadcrumb und Schreibrecht hängen an ihr, ohne sie
  // gibt es keinen Rahmen; nur sie rechtfertigt einen Frühausstieg.
  //
  // LISTENZUSTAND — `uhsQuery`. Sie entschied hier früher mit über die ganze Seite: bis ihre
  // Antwort da war, stand alles im Ladebild, und scheiterte sie, blieb es dabei. Ihr Zustand
  // gehört an die Stelle der Liste (unten), nicht in diesen Guard.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.error) {
    return (
      <SeitenFehler
        text="Einsatz konnte nicht geladen werden"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }

  const alle = uhsQuery.data ?? [];

  /**
   * ZWEI LAGEN, ZWEI ANTWORTEN (D3) — der Fehler allein reicht als Bedingung NICHT.
   *
   * Ohne Zeilen im Zwischenspeicher tritt der Fehler an die Stelle der Tabelle, sonst
   * behauptet „Noch keine Unfallhilfsstellen erfasst" eine leere Lage, wo bloß der Abruf
   * scheiterte. MIT Zeilen bleiben sie stehen und bekommen ein Banner: sie sind echt, nur
   * womöglich alt. Ein Fehler, der die Zeilen wegräumt, nähme der Einsatzkraft Daten, die
   * sie eben noch hatte — das Gegenteil dessen, wofür `SeitenStandVeraltet` gebaut ist.
   *
   * Gemessen an der UNGEFILTERTEN Menge (Muster aus `TierePage`/`SchaedenPage`): an einer
   * engeren Sicht gemessen kippte die Seite bei jedem Filter mit null Treffern in den
   * Fehlerzweig.
   */
  const listeGescheitert = uhsQuery.isError && alle.length === 0;
  const standVeraltet = uhsQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      titel="Unfallhilfsstellen"
      dataUpdatedAt={uhsQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
          { title: 'Unfallhilfsstellen' },
        ]} />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>Neu</Button>
      }
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette, LFH-391 · B5)
      // — mit DEMSELBEN Rechte-Riegel wie der Knopf darüber (dort `disabled`).
      neueZeile={schreibgeschuetzt ? undefined : () => setAnlegen(true)}
    >
      {/* Der Fehler TAUSCHT die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (D3): `Datensicht` führt den Kartenzweig an `Liste`, und deren Vertrag kennt
          keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer der
          beiden Formen. Der Leertext ist byte-gleich dem aus `UnfallhilfsstellenDefault`:
          zwei Formulierungen für dieselbe Tatsache wären der Befund, den B3 behebt. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Unfallhilfsstellen konnten nicht geladen werden"
          ursache={uhsQuery.error}
          onWiederholen={() => void uhsQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void uhsQuery.refetch()} />}
          <KatalogTabelle<Uhs>
            rowKey="id"
            loading={uhsQuery.isLoading}
            dataSource={alle}
            columns={spalten}
            pagination={false}
            locale={{ emptyText: 'Noch keine Unfallhilfsstellen erfasst' }}
          />
        </>
      )}

      <UhsAnlegenDrawer einsatzId={einsatzId} open={anlegen} onClose={() => setAnlegen(false)} />
    </EinsatzSeite>
  );
}
