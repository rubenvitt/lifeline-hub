import { Alert, Breadcrumb, Spin, Typography } from 'antd';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeLageMeldungen } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { LageMeldung } from '../api/types';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { SeitenLeer } from '../components/SeitenZustand';
import Datenstand from '../components/Datenstand';
import { meldungenPfad } from '../routing/deeplinks';
import { ZEITFENSTER, imZeitfenster, tagesEtikett, tagesSchluessel, type Zeitfenster } from '../lagemeldungen/zeitachse';

/**
 * Lagerelevante Meldungen als Kartensicht (LFH-348 · C13, Befund M85) — die zwölfte
 * Konsumentin des `Datensicht`-Primitivs, `form="karte"` in jeder Breite: ein Lageobjekt
 * wird GELESEN („was ist passiert?"), nicht spaltenweise verglichen.
 *
 * Was der Bestand nicht hatte und das Primitiv mitbringt: die Zeit als führende Angabe,
 * absteigend sortiert; Tagesgruppen; ein Rückweg zur Quellmeldung über `meldungenPfad`
 * (LFH-25 — vorher gab es keinen, „Meldung #5" war Text); Filter über Zeitfenster und
 * Koordinaten; Suche über Text und Absender.
 *
 * Die Spalten entstehen in der Komponente, weil Tagesschlüssel und Zeitfenster an den
 * Anzeige-Konventionen (Zeitzone) hängen — `spaltenFuer` bleibt als Guard-Marke in der Datei.
 */
export default function LagemeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { konventionen } = useAnzeigeKonventionen();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const lageQuery = useQuery({
    queryKey: einsatzKeys.lagemeldungen(einsatzId),
    queryFn: () => listeLageMeldungen(einsatzId),
  });

  const spalten = useMemo(
    () =>
      spaltenFuer<LageMeldung>()([
        {
          key: 'text',
          title: 'Meldung',
          immerSichtbar: true,
          suchText: (l) => l.text,
          render: (_t, l) => l.text,
        },
        {
          key: 'zeit',
          title: 'Zeit',
          sortWert: (l) => l.erstellt_at,
          filter: {
            werte: ZEITFENSTER,
            trifft: (l, w) => imZeitfenster(l.erstellt_at, w as Zeitfenster, undefined, konventionen),
          },
          render: (_t, l) => <ZeitAnzeige wert={l.erstellt_at} format="kurz" />,
        },
        {
          key: 'herkunft',
          title: 'Herkunft',
          suchText: (l) => `${l.meldung_lfd_nr} ${l.meldung_absender}`,
          // Deeplink aus dem Spalten-`render` — erlaubt, weil NICHT die Titelspalte; der
          // Klick-Riegel des Primitivs trennt Link- und Zeilenklick (LFH-340 · C5).
          render: (_t, l) => (
            <>
              {'Herkunft: '}
              <Link to={meldungenPfad(l.einsatz_id, { meldung: l.meldung_id })}>Meldung #{l.meldung_lfd_nr}</Link>
              {` von ${l.meldung_absender}`}
            </>
          ),
        },
        {
          key: 'ort',
          title: 'Ort',
          filter: {
            werte: [
              { text: 'Mit Koordinaten', value: 'mit' },
              { text: 'Ohne Koordinaten', value: 'ohne' },
            ],
            trifft: (l, w) => (l.lat != null && l.lon != null) === (w === 'mit'),
          },
          render: (_t, l) =>
            l.lat != null && l.lon != null ? (
              <KoordinatenAnzeige lat={l.lat} lon={l.lon} einsatzId={l.einsatz_id} exclude={`lagemeldung:${l.id}`} />
            ) : null,
        },
      ]),
    [konventionen],
  );

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const eintraege = lageQuery.data ?? [];
  // Tagesgruppen jüngster zuerst — die feste Reihenfolge aus den Daten, weil das Primitiv
  // unbekannte Gruppen sonst in Antreffreihenfolge der SERVERliste anhängt.
  const tage = [...new Set(eintraege.map((l) => tagesSchluessel(l.erstellt_at, konventionen)))].sort().reverse();

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: einsatz.bezeichnung },
        { title: 'Lagemeldungen' },
      ]} />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Lagerelevante Meldungen</Typography.Title>
      <Datenstand dataUpdatedAt={lageQuery.dataUpdatedAt} />
      {lageQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title="Lageobjekte konnten nicht geladen werden" />
      )}
      {/* KEINE Primäraktion (LFH-331 · B3): eine Lagemeldung entsteht nicht hier, sondern
          dadurch, dass jemand anderswo eine Meldung als lagerelevant übergibt. Ein Knopf
          auf die Meldungsliste führte zur Voraussetzung, nicht aus dem Leerzustand heraus. */}
      {!lageQuery.isLoading && eintraege.length === 0 ? (
        <SeitenLeer titel="Noch keine lagerelevanten Meldungen übergeben" />
      ) : (
        <Datensicht
          bezeichnung="Lagemeldungen"
          form="karte"
          spalten={spalten}
          daten={eintraege}
          zeilenSchluessel="id"
          ladend={lageQuery.isLoading}
          leerText="Noch keine lagerelevanten Meldungen übergeben"
          suche={{ platzhalter: 'Meldungstext oder Absender' }}
          standardSortierung={{ spalte: 'zeit', richtung: 'ab' }}
          gruppen={{
            schluessel: (l) => tagesSchluessel(l.erstellt_at, konventionen),
            etikett: (s) => tagesEtikett(s, konventionen),
            reihenfolge: tage,
          }}
          karte={{ art: 'plan', titel: { spalte: 'text' }, sekundaer: ['zeit', 'herkunft', 'ort'] }}
        />
      )}
    </div>
  );
}
