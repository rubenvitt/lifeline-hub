import {
  Breadcrumb, Button,
  type TableColumnsType,
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { bereitstellungsraumDetailPfad } from '../../routing/deeplinks';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { listeBr } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import { SeitenFehler, SeitenLeer, SeitenSkeleton, SeitenStandVeraltet } from '../../components/SeitenZustand';
import { brStatus } from '../../theme/statusFarben';
import { flaeche } from '../../theme/tokens';
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

  // ZWEI EBENEN, getrennt gehalten (LFH-331 · B3, D3):
  //
  // SEITENZUSTAND — nur `einsatzQuery`. Breadcrumb und Schreibrecht hängen an ihr, ohne sie
  // gibt es keinen Rahmen; nur sie rechtfertigt einen Frühausstieg.
  //
  // LISTENZUSTAND — `brQuery`. Sie entschied hier früher mit über die ganze Seite: bis ihre
  // Antwort da war, stand alles im Ladebild, und scheiterte sie, blieb es dabei — ohne jede
  // Aussage, was los ist. Ihr Zustand gehört an die Stelle der Liste (unten).
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
   * ZWEI LAGEN, ZWEI ANTWORTEN (D3) — der Fehler allein reicht als Bedingung NICHT.
   *
   * Ohne Zeilen im Zwischenspeicher tritt der Fehler an die Stelle der Tabelle, sonst
   * behauptet „Noch keine Bereitstellungsräume erfasst" eine leere Lage, wo bloß der Abruf
   * scheiterte. MIT Zeilen bleiben sie stehen und bekommen ein Banner: sie sind echt, nur
   * womöglich alt. Ein Fehler, der die Zeilen wegräumt, nähme der Einsatzkraft Daten, die
   * sie eben noch hatte.
   *
   * Gemessen an `alle`, NICHT an `sichtbar` — dieselbe Achse wie in `TierePage`/`SchaedenPage`.
   * Die Begründung trägt hier allerdings anders und das soll nicht unbenannt bleiben:
   * `storniert_at` ist kein vom Bediener gesetzter Filter, der Fall „Filter eng, Cache voll"
   * tritt hier also nicht laufend auf. Gewählt ist die ungefilterte Achse trotzdem, weil eine
   * zweite Messgrundlage für dieselbe Weiche genau der Befund wäre, den B3 behebt.
   * BENANNTE FOLGE: sind ALLE Räume storniert und scheitert die Aktualisierung, steht das
   * Banner über einer Tabelle, die „Noch keine … erfasst" zeigt. Das ist die ehrlichere der
   * beiden Aussagen — der Bestand ist tatsächlich leer, nur eben womöglich veraltet leer.
   */
  const listeGescheitert = brQuery.isError && alle.length === 0;
  const standVeraltet = brQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      titel="Bereitstellungsräume"
      dataUpdatedAt={brQuery.dataUpdatedAt}
      breite={flaeche.seiteBreit}
      breadcrumb={
        <Breadcrumb items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
          { title: 'Bereitstellungsräume' },
        ]} />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      }
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette, LFH-391 · B5)
      // — mit DEMSELBEN Rechte-Riegel wie der Knopf darüber (dort `disabled`).
      neueZeile={schreibgeschuetzt ? undefined : () => setAnlegen(true)}
    >
      {/* Der Fehler TAUSCHT die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (D3): `Datensicht` führt den Kartenzweig an `Liste`, und deren Vertrag kennt
          keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer der
          beiden Formen. Ohne diese Weiche behauptet „Noch keine Bereitstellungsräume
          erfasst" auch dann eine leere Lage, wenn bloß die Verbindung abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Bereitstellungsräume konnten nicht geladen werden"
          ursache={brQuery.error}
          onWiederholen={() => void brQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void brQuery.refetch()} />}
          {/* `!brQuery.isLoading` statt `brQuery.isSuccess`: eine vollständig stornierte Liste
              bleibt auch dann ein Leerzustand, wenn eine NACHFOLGENDE Aktualisierung scheitert
              (`standVeraltet`) — react-query setzt `status` dabei auf `'error'`, `isSuccess`
              wird also false, obwohl die (leeren) Zeilen aus dem Zwischenspeicher weiter
              gültig sind. Gemessen: der D3-Regressionstest „alles storniert + Fehler ergibt
              Banner" erwartet den Leertext WEITER sichtbar, `isSuccess` verfehlte das. */}
          {!brQuery.isLoading && sichtbar.length === 0 && (
            <SeitenLeer
              titel="Noch keine Bereitstellungsräume erfasst"
              hinweis="Lege einen Bereitstellungsraum an, um Kräfte zu sammeln."
              aktion={schreibgeschuetzt ? undefined : { label: 'Ersten BR anlegen', onClick: () => setAnlegen(true) }}
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
