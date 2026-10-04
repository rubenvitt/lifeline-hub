import { Breadcrumb, Button, type TableColumnsType } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  bereitstellungsraumDetailPfad,
  einsaetzePfad,
  einsatzPfad,
} from '../../routing/deeplinks';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { listeBr } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../../components/SeitenZustand';
import { brStatus } from '../../theme/statusFarben';
import KatalogTabelle from '../../components/KatalogTabelle';
import BrAnlegenDrawer from './BrAnlegenDrawer';

export default function BereitstellungsraeumePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  // Schnellaktion: ?neu=1 öffnet den Anlege-Drawer (Sprungpalette, LFH-506). Gelesen auf der
  // LISTEN-Route — `BereitstellungsraeumeDefault` am baren Modulpfad liest den Parameter nicht,
  // deshalb zeigt `bereitstellungsraeumeListePfad` hierher. Warten bis der Einsatz geladen ist;
  // Param immer löschen, Drawer nur bei Schreibrecht.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (!schreibgeschuetzt) setAnlegen(true);
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, schreibgeschuetzt]);

  const spalten: TableColumnsType<Bereitstellungsraum> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      render: (b: string, br) => (
        <Link to={bereitstellungsraumDetailPfad(einsatzId, br.id)}>{b}</Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: BrStatus) => <StatusTag darstellung={brStatus[s]} />,
    },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  // Zwei Ebenen: der Seitenzustand hängt nur an `einsatzQuery` (Breadcrumb, Schreibrecht) und
  // rechtfertigt einen Frühausstieg. Der Zustand von `brQuery` gehört an die Stelle der Liste
  // (unten), nicht vor die ganze Seite.
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

  const alle = brQuery.data ?? [];
  const sichtbar = alle.filter((br) => !br.storniert_at);

  /**
   * Ohne Zeilen im Zwischenspeicher ersetzt der Fehler die Tabelle, sonst behauptete der Leertext
   * eine leere Lage. Mit Zeilen bleiben sie stehen und bekommen ein Banner — sie sind echt, nur
   * womöglich alt.
   *
   * Gemessen an `alle`, nicht an `sichtbar` — dieselbe Achse wie in `TierePage`/`SchaedenPage`.
   * Folge: sind alle Räume storniert und scheitert die Aktualisierung, steht das Banner über einer
   * Tabelle mit Leertext. Das ist ehrlich — der Bestand ist leer, nur womöglich veraltet.
   */
  const listeGescheitert = brQuery.isError && alle.length === 0;
  const standVeraltet = brQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      titel="Bereitstellungsräume"
      dataUpdatedAt={brQuery.dataUpdatedAt}
      meta={brQuery.isSuccess ? `${alle.length} Räume` : undefined}

      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
            { title: <Link to={einsatzPfad(einsatzId)}>{einsatzQuery.data?.bezeichnung}</Link> },
            { title: 'Bereitstellungsräume' },
          ]}
        />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      }
      // Zweiter Bedienweg auf die Primäraktion, mit demselben Rechte-Riegel wie der Knopf.
      neueZeile={schreibgeschuetzt ? undefined : () => setAnlegen(true)}
    >
      {/* Der Fehler tauscht die Tabelle aus: `Datensicht` führt den Kartenzweig an `Liste`,
          deren Vertrag keinen Fehlerbegriff kennt — ein Prop am Tabellen-Primitiv wirkte nur in
          einer Form. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Bereitstellungsräume konnten nicht geladen werden"
          ursache={brQuery.error}
          onWiederholen={() => void brQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void brQuery.refetch()} />}
          {/* `!isLoading` statt `isSuccess`: scheitert eine nachfolgende Aktualisierung, setzt
              react-query `status` auf `'error'`, die (leeren) Zeilen aus dem Cache gelten aber
              weiter. */}
          {!brQuery.isLoading && sichtbar.length === 0 && (
            <SeitenLeer
              titel="Noch keine Bereitstellungsräume erfasst"
              hinweis="Lege einen Bereitstellungsraum an, um Kräfte zu sammeln."
              aktion={
                schreibgeschuetzt
                  ? undefined
                  : { label: 'Ersten BR anlegen', onClick: () => setAnlegen(true) }
              }
            />
          )}
          {(sichtbar.length > 0 || brQuery.isLoading) && (
            <KatalogTabelle<Bereitstellungsraum>
              rowKey="id"
              loading={brQuery.isLoading}
              dataSource={sichtbar}
              columns={spalten}
              size="middle"
              pagination={false}
              locale={{ emptyText: 'Noch keine Bereitstellungsräume erfasst' }}
            />
          )}
        </>
      )}

      <BrAnlegenDrawer
        einsatzId={einsatzId}
        open={anlegen}
        onClose={() => setAnlegen(false)}
        onAngelegt={(br) => navigate(bereitstellungsraumDetailPfad(einsatzId, br.id))}
      />
    </EinsatzSeite>
  );
}
