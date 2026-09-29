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
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { uhsStatus, uhsTyp } from '../theme/statusFarben';
import KatalogTabelle from '../components/KatalogTabelle';

export default function UnfallhilfsstellenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  // Live-Updates über useEinsatzLiveStream im EinsatzLayout.

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  const [searchParams, setSearchParams] = useSearchParams();
  // Schnellaktion: ?neu=1 öffnet den Anlegen-Drawer, sobald die Rechte feststehen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (!schreibgeschuetzt) setAnlegen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, schreibgeschuetzt]);

  const spalten: TableColumnsType<Uhs> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      render: (b: string, u) => <Link to={uhsDetailPfad(einsatzId, u.id)}>{b}</Link>,
    },
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => uhsTyp[t].label },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: UhsStatus) => <StatusTag darstellung={uhsStatus[s]} />,
    },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  // Zwei Ebenen, getrennt gehalten:
  //
  // Seitenzustand — nur `einsatzQuery`. Breadcrumb und Schreibrecht hängen an ihr; nur sie
  // rechtfertigt einen Frühausstieg.
  //
  // Listenzustand — `uhsQuery`. Ihr Zustand gehört an die Stelle der Liste (unten), nicht in diesen
  // Guard: sonst stünde die ganze Seite im Ladebild oder Fehler.
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
   * Zwei Lagen, zwei Antworten — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im
   * Zwischenspeicher tritt der Fehler an die Stelle der Tabelle, sonst behauptete „Noch keine
   * Unfallhilfsstellen erfasst" eine leere Lage. Mit Zeilen bleiben sie stehen und bekommen ein
   * Banner: echt, nur womöglich alt.
   *
   * Gemessen an der ungefilterten Menge (Muster `TierePage`/`SchaedenPage`): an einer engeren Sicht
   * gemessen kippte die Seite bei jedem Filter mit null Treffern in den Fehlerzweig.
   */
  const listeGescheitert = uhsQuery.isError && alle.length === 0;
  const standVeraltet = uhsQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      titel="Unfallhilfsstellen"
      dataUpdatedAt={uhsQuery.dataUpdatedAt}
      meta={uhsQuery.isSuccess ? `${alle.length} Hilfsstellen` : undefined}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
            { title: 'Unfallhilfsstellen' },
          ]}
        />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      }
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette) — mit demselben
      // Rechte-Riegel wie der Knopf (dort `disabled`).
      neueZeile={schreibgeschuetzt ? undefined : () => setAnlegen(true)}
    >
      {/* Der Fehler tauscht die Tabelle aus: `Datensicht` führt den Kartenzweig an `Liste`,
          deren Vertrag keinen Fehlerbegriff kennt. Der Leertext ist gleich dem aus
          `UnfallhilfsstellenDefault`. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Unfallhilfsstellen konnten nicht geladen werden"
          ursache={uhsQuery.error}
          onWiederholen={() => void uhsQuery.refetch()}
        />
      ) : uhsQuery.isSuccess && alle.length === 0 ? (
        // Leerzustand mit Weg hinaus: dieselbe Anlage wie im Kopf, mit demselben Rechte-Riegel.
        // Ohne Schreibrecht bleibt es bei der Aussage.
        <SeitenLeer
          titel="Noch keine Unfallhilfsstellen erfasst"
          aktion={
            schreibgeschuetzt
              ? undefined
              : { label: 'Erste Unfallhilfsstelle anlegen', onClick: () => setAnlegen(true) }
          }
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
