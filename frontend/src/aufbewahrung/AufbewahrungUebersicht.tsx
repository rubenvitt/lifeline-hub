import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { theme } from 'antd';
import { ladeAufbewahrung } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type { AufbewahrungEintrag, AufbewahrungZustand } from '../api/types';
import { adminAufbewahrungAktePfad, defaultAdminPfad } from '../admin/adminNav';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { SeitenFehler } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { Segmentleiste } from '../components/instrument';
import { istAdmin } from '../einsatz/schreibrecht';
import { aufbewahrungZustand } from '../theme/statusFarben';
import { ZUSTAENDE } from './archivText';

/**
 * Aufbewahrungsübersicht der Verwaltung (LFH-23, design.md D8) — `/admin/aufbewahrung`.
 *
 * FORM: Tabelle (`form="tabelle"`) in JEDER Breite — hier wird VERGLICHEN („welcher Einsatz
 * läuft als nächstes ab, welcher ist noch zu retten?"). Fixierte Kennung ist die
 * Einsatznummer, nie die DB-`id`. Über der Tabelle eine `Segmentleiste` nach Zustand; der
 * Zustand selbst steht als `StatusTag` aus der Vertragskarte `aufbewahrungZustand` mit Wort.
 *
 * Die Übersicht trägt KEINE Aktion (Spec „Frist am Einsatz anzeigen und ändern"): Frist ändern
 * und Wiederherstellen stehen in der Akte, in die die Zeile führt. Sie ist dem System-Admin
 * vorbehalten; ohne dieses Recht leitet die Seite in die Verwaltung zurück (der Server
 * antwortet ohnehin 403).
 *
 * Breiten (LFH-523): die Bezeichnung FLIESST (`mindestBreite`), alle übrigen Spalten tragen
 * eine Zahlbreite — sonst bliebe das Opt-in wirkungslos und warnte nur. Der Zustand steht
 * direkt neben der fixierten Nummer: am Handschirm (390 px) ist er damit ohne Querscrollen
 * lesbar (im Durchstich gemessen — als dritte Spalte lag er außerhalb der Sicht).
 */

type Filter = AufbewahrungZustand | 'alle';

const leer = '—';

const spalten = spaltenFuer<AufbewahrungEintrag>()([
  {
    key: 'nummer',
    title: 'Einsatznummer',
    width: 150,
    zahl: true,
    sortWert: (e) => e.einsatznummer_intern,
    suchText: (e) => e.einsatznummer_intern,
    render: (_, e) => e.einsatznummer_intern ?? leer,
  },
  {
    key: 'zustand',
    title: 'Zustand',
    width: 200,
    sortWert: (e) => ZUSTAENDE.indexOf(e.zustand),
    render: (_, e) => <StatusTag darstellung={aufbewahrungZustand[e.zustand]} />,
  },
  {
    key: 'bezeichnung',
    title: 'Bezeichnung',
    mindestBreite: 200,
    sortWert: (e) => e.bezeichnung,
    suchText: (e) => e.bezeichnung,
    render: (_, e) => e.bezeichnung,
  },
  {
    key: 'abgeschlossen',
    title: 'Abgeschlossen',
    width: 160,
    zahl: true,
    sortWert: (e) => e.abgeschlossen_at,
    render: (_, e) => (e.abgeschlossen_at ? <ZeitAnzeige wert={e.abgeschlossen_at} /> : leer),
  },
  {
    key: 'frist',
    title: 'Frist',
    width: 160,
    zahl: true,
    sortWert: (e) => e.retention_bis,
    render: (_, e) => (e.retention_bis ? <ZeitAnzeige wert={e.retention_bis} /> : leer),
  },
  {
    key: 'vorgemerkt',
    title: 'Vorgemerkt am',
    width: 160,
    zahl: true,
    sortWert: (e) => e.geloescht_at,
    render: (_, e) => (e.geloescht_at ? <ZeitAnzeige wert={e.geloescht_at} /> : leer),
  },
  {
    key: 'karenz',
    title: 'Karenz-Ende',
    width: 160,
    zahl: true,
    sortWert: (e) => e.karenz_ende,
    render: (_, e) => (e.karenz_ende ? <ZeitAnzeige wert={e.karenz_ende} /> : leer),
  },
  {
    key: 'geschwaerzt',
    title: 'Geschwärzt am',
    width: 160,
    zahl: true,
    sortWert: (e) => e.geschwaerzt_at,
    render: (_, e) => (e.geschwaerzt_at ? <ZeitAnzeige wert={e.geschwaerzt_at} /> : leer),
  },
]);

type Spalte = (typeof spalten)[number]['key'];

/** Pflicht am Primitiv, greift bei `form="tabelle"` nie — ehrlich belegt, falls die Form je
 *  auf `auto` wechselt. */
const KARTE: Kartenplan<AufbewahrungEintrag, Spalte> = {
  art: 'plan',
  titel: { spalte: 'nummer', ziel: (e) => adminAufbewahrungAktePfad(e.einsatz_id) },
  status: (e) => aufbewahrungZustand[e.zustand],
  sekundaer: ['bezeichnung', 'frist', 'karenz'],
};

/** Reine Filterfunktion — „alle" oder genau ein Zustand. */
export function filtereAufbewahrung(
  eintraege: readonly AufbewahrungEintrag[],
  filter: Filter,
): AufbewahrungEintrag[] {
  return filter === 'alle' ? [...eintraege] : eintraege.filter((e) => e.zustand === filter);
}

export default function AufbewahrungUebersicht() {
  const { benutzer, laedt: authLaedt } = useAuth();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [filter, setFilter] = useState<Filter>('alle');
  const admin = istAdmin(benutzer);
  const abfrage = useQuery({
    queryKey: globalKeys.aufbewahrung(),
    queryFn: ladeAufbewahrung,
    enabled: admin,
  });
  const daten = useMemo(
    () => filtereAufbewahrung(abfrage.data ?? [], filter),
    [abfrage.data, filter],
  );

  if (!authLaedt && !admin) return <Navigate to={defaultAdminPfad()} replace />;

  return (
    <AdminPage
      titel="Aufbewahrung"
      beschreibung="Abgeschlossene Einsätze der eigenen Organisation mit ihrer Aufbewahrungsfrist. Nach Fristablauf ist ein Einsatz gesperrt und zur Löschung vorgemerkt; nach 30 Tagen Karenz werden die Personendaten unwiderruflich geschwärzt. Eine Zeile öffnet die pseudonyme Archivakte."
      hinweis={
        abfrage.isError ? (
          <SeitenFehler
            text="Aufbewahrung nicht ladbar"
            ursache={abfrage.error}
            onWiederholen={() => void abfrage.refetch()}
          />
        ) : undefined
      }
    >
      <Segmentleiste<Filter>
        beschriftung="Zustand"
        wert={filter}
        onWechsel={setFilter}
        optionen={[
          { wert: 'alle', label: 'alle' },
          ...ZUSTAENDE.map((z) => ({ wert: z, label: aufbewahrungZustand[z].label })),
        ]}
        style={{ marginBottom: token.marginSM }}
      />
      <Datensicht
        bezeichnung="Aufbewahrung"
        form="tabelle"
        spalten={spalten}
        daten={daten}
        zeilenSchluessel={(e) => `einsatz-${e.einsatz_id}`}
        ladend={abfrage.isLoading}
        leerText={
          filter === 'alle'
            ? 'Keine abgeschlossenen Einsätze'
            : `Kein Einsatz im Zustand „${aufbewahrungZustand[filter].label}“`
        }
        karte={KARTE}
        onZeileKlick={(e) => navigate(adminAufbewahrungAktePfad(e.einsatz_id))}
      />
    </AdminPage>
  );
}
