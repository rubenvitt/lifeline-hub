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
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { Segmentleiste } from '../components/instrument';
import { istAdmin } from '../einsatz/schreibrecht';
import { aufbewahrungZustand } from '../theme/statusFarben';
import { standVerworfen } from './archivAbruf';
import { ZUSTAENDE, ZUSTAND_RANG } from './archivText';

/**
 * Aufbewahrungsübersicht der Verwaltung — `/admin/aufbewahrung`, nur System-Admin (sonst
 * Rückleitung in die Verwaltung).
 *
 * Tabelle in JEDER Breite: hier wird verglichen („welcher läuft als nächstes ab?"). Fixierte
 * Kennung ist die Einsatznummer, nie die DB-`id`. Die Übersicht trägt KEINE Aktion; Frist
 * ändern und Wiederherstellen stehen in der Akte.
 *
 * Die Bezeichnung fließt (`mindestBreite`), alle übrigen Spalten tragen eine Zahlbreite, sonst
 * bliebe das Opt-in wirkungslos. Der Zustand steht neben der fixierten Nummer, damit er bei
 * 390 px ohne Querscrollen lesbar ist.
 */

type Filter = AufbewahrungZustand | 'alle';

const leer = '—';

/**
 * Kennung der fixierten Spalte. Altbestand ohne Einsatznummer (gerade die Aufbewahrungsfälle)
 * zeigt die Bezeichnung, nie „—": die Zelle ist der Link in die Akte, n Links „—" wären nicht
 * zu unterscheiden.
 */
function kennung(e: Pick<AufbewahrungEintrag, 'einsatznummer_intern' | 'bezeichnung'>) {
  return e.einsatznummer_intern ?? `ohne Nr. · ${e.bezeichnung}`;
}

const spalten = spaltenFuer<AufbewahrungEintrag>()([
  {
    key: 'nummer',
    title: 'Einsatznummer',
    width: 190,
    zahl: true,
    sortWert: (e) => kennung(e),
    suchText: (e) => kennung(e),
    render: (_, e) => kennung(e),
  },
  {
    key: 'zustand',
    title: 'Zustand',
    width: 200,
    sortWert: (e) => ZUSTAND_RANG[e.zustand],
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
    // LFH-751: Fälligkeit eines offenen Einsatz-Antrags (Löschersuchen nach Art. 17).
    key: 'antrag',
    title: 'Schwärzung auf Antrag ab',
    width: 190,
    zahl: true,
    sortWert: (e) => e.antrag_faellig_at,
    render: (_, e) => (e.antrag_faellig_at ? <ZeitAnzeige wert={e.antrag_faellig_at} /> : leer),
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

/**
 * Kartenplan — auch in der Tabellenform nötig: `titel.ziel` macht die Kennungszelle zum
 * echten `<Link>` und damit zum Tastaturziel der Zeile (`onZeileKlick` bedient nur Maus und
 * Tippen). Nicht streichen.
 */
const KARTE: Kartenplan<AufbewahrungEintrag, Spalte> = {
  art: 'plan',
  titel: { spalte: 'nummer', ziel: (e) => adminAufbewahrungAktePfad(e.einsatz_id) },
  status: (e) => aufbewahrungZustand[e.zustand],
  sekundaer: ['bezeichnung', 'frist', 'karenz'],
};

/** Reine Filterfunktion — „alle" oder genau ein Zustand. */
function filtereAufbewahrung(
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
  // Ein abgelehnter Abruf verwirft den gecachten Stand; ohne Stand behauptet die Seite nichts
  // über den Bestand — kein Leertext unter dem Fehler (LFH-756, Prinzip aus LFH-612).
  const eintraege = abfrage.isError && standVerworfen(abfrage.error) ? undefined : abfrage.data;
  const ohneStand = abfrage.isError && eintraege === undefined;
  const daten = useMemo(() => filtereAufbewahrung(eintraege ?? [], filter), [eintraege, filter]);

  if (!authLaedt && !admin) return <Navigate to={defaultAdminPfad()} replace />;

  return (
    <AdminPage
      titel="Aufbewahrung"
      beschreibung="Abgeschlossene Einsätze der eigenen Organisation mit ihrer Aufbewahrungsfrist. Nach Fristablauf ist ein Einsatz gesperrt und zur Löschung vorgemerkt; nach 30 Tagen Karenz werden die Personendaten unwiderruflich geschwärzt. Eine Zeile öffnet die pseudonyme Archivakte."
      hinweis={
        ohneStand ? (
          <SeitenFehler
            text="Aufbewahrung nicht ladbar"
            ursache={abfrage.error}
            onWiederholen={() => void abfrage.refetch()}
          />
        ) : abfrage.isRefetchError ? (
          <SeitenStandVeraltet onWiederholen={() => void abfrage.refetch()} />
        ) : undefined
      }
    >
      {!ohneStand && (
        <>
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
        </>
      )}
    </AdminPage>
  );
}
