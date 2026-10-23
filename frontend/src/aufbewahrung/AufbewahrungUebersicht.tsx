import { Navigate, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Typography } from 'antd';
import { ladeAufbewahrung } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type { AufbewahrungEintrag } from '../api/types';
import { adminAufbewahrungAktePfad, defaultAdminPfad } from '../admin/adminNav';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { useListenGedaechtnis } from '../components/listenGedaechtnis';
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
 *
 * Gemessen gegen 1440 (LFH-1149, `e2e/gate1-ueberlauf.spec.ts`, „Tabellen am
 * Führungsarbeitsplatz“): zehn Spalten passen dort nicht. Unter `xxl` weichen „Vorgemerkt am“,
 * „Schwärzung auf Antrag ab“ und „Geschwärzt am“ in den Spaltenschalter: ihren Stand nennt schon
 * die Zustandsmarke. Im Bild bleiben die Fristen, nach denen verglichen wird (Entscheidung Ruben,
 * 10.10.2026).
 *
 * Ein endgültig gelöschter Einsatz (LFH-750) ist nur noch eine Zeile des Löschprotokolls: ohne
 * Bezeichnung und ohne Akte, also ohne Link und ohne Zeilenklick.
 *
 * Sortieren und Filtern im Spaltenkopf (LLH-1096, Spec `tabellen-sortieren-filtern`): jede Spalte
 * sortiert, der Zustand filtert im Kopf (mehrere Zustände zugleich, je Wert gezählt) und ersetzt
 * die frühere Segmentleiste „Zustand“, die genau einen zuließ. Eine gefilterte leere Liste zeigt
 * den Filter-Leerzustand der `Datensicht`. Sortierung und Filter stehen in der Adresse und tragen
 * den Rückweg aus der Akte.
 */

const leer = '—';

const GELOESCHT = 'endgültig gelöscht';

function istGeloescht(e: Pick<AufbewahrungEintrag, 'zustand'>): boolean {
  return e.zustand === 'endgueltig_geloescht';
}

/** Löschtermin des Skeletts, beim gelöschten Einsatz der Zeitpunkt der Löschung. */
function loeschung(e: AufbewahrungEintrag): string | undefined {
  return e.endgueltig_geloescht_at ?? e.loeschung_am ?? undefined;
}

/**
 * Kennung der fixierten Spalte. Altbestand ohne Einsatznummer (gerade die Aufbewahrungsfälle)
 * zeigt die Bezeichnung, nie „—": die Zelle ist der Link in die Akte, n Links „—" wären nicht
 * zu unterscheiden.
 */
function kennung(e: Pick<AufbewahrungEintrag, 'einsatznummer_intern' | 'bezeichnung'>) {
  return e.einsatznummer_intern ?? `ohne Nr. · ${e.bezeichnung ?? GELOESCHT}`;
}

const spalten = spaltenFuer<AufbewahrungEintrag>()([
  {
    key: 'nummer',
    title: 'Einsatznummer',
    width: 150,
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
    filter: {
      werte: ZUSTAENDE.map((z) => ({ text: aufbewahrungZustand[z].label, value: z })),
      trifft: (e, wert) => e.zustand === wert,
    },
    render: (_, e) => <StatusTag darstellung={aufbewahrungZustand[e.zustand]} />,
  },
  {
    key: 'bezeichnung',
    title: 'Bezeichnung',
    mindestBreite: 180,
    sortWert: (e) => e.bezeichnung ?? GELOESCHT,
    suchText: (e) => e.bezeichnung ?? GELOESCHT,
    render: (_, e) =>
      e.bezeichnung ?? <Typography.Text type="secondary">{GELOESCHT}</Typography.Text>,
  },
  {
    key: 'abgeschlossen',
    title: 'Abgeschlossen',
    width: 150,
    zahl: true,
    sortWert: (e) => e.abgeschlossen_at,
    render: (_, e) => (e.abgeschlossen_at ? <ZeitAnzeige wert={e.abgeschlossen_at} /> : leer),
  },
  {
    key: 'frist',
    title: 'Frist',
    width: 130,
    zahl: true,
    sortWert: (e) => e.retention_bis,
    render: (_, e) => (e.retention_bis ? <ZeitAnzeige wert={e.retention_bis} /> : leer),
  },
  {
    key: 'vorgemerkt',
    title: 'Vorgemerkt am',
    width: 130,
    abBreite: 'xxl',
    zahl: true,
    sortWert: (e) => e.geloescht_at,
    render: (_, e) => (e.geloescht_at ? <ZeitAnzeige wert={e.geloescht_at} /> : leer),
  },
  {
    key: 'karenz',
    title: 'Karenz-Ende',
    width: 130,
    zahl: true,
    sortWert: (e) => e.karenz_ende,
    render: (_, e) => (e.karenz_ende ? <ZeitAnzeige wert={e.karenz_ende} /> : leer),
  },
  {
    // LFH-751: Fälligkeit eines offenen Einsatz-Antrags (Löschersuchen nach Art. 17).
    key: 'antrag',
    title: 'Schwärzung auf Antrag ab',
    width: 130,
    abBreite: 'xxl',
    zahl: true,
    sortWert: (e) => e.antrag_faellig_at,
    render: (_, e) => (e.antrag_faellig_at ? <ZeitAnzeige wert={e.antrag_faellig_at} /> : leer),
  },
  {
    key: 'geschwaerzt',
    title: 'Geschwärzt am',
    width: 130,
    abBreite: 'xxl',
    zahl: true,
    sortWert: (e) => e.geschwaerzt_at,
    render: (_, e) => (e.geschwaerzt_at ? <ZeitAnzeige wert={e.geschwaerzt_at} /> : leer),
  },
  {
    key: 'loeschung',
    title: 'Löschung am',
    width: 130,
    zahl: true,
    sortWert: (e) => loeschung(e),
    render: (_, e) => {
      const wert = loeschung(e);
      return wert ? <ZeitAnzeige wert={wert} /> : leer;
    },
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
  titel: {
    spalte: 'nummer',
    ziel: (e) => (istGeloescht(e) ? null : adminAufbewahrungAktePfad(e.einsatz_id)),
  },
  status: (e) => aufbewahrungZustand[e.zustand],
  sekundaer: ['bezeichnung', 'frist', 'karenz'],
};

export default function AufbewahrungUebersicht() {
  const { benutzer, laedt: authLaedt } = useAuth();
  const navigate = useNavigate();
  const gedaechtnis = useListenGedaechtnis<Spalte>('aufbewahrung', spalten);
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

  if (!authLaedt && !admin) return <Navigate to={defaultAdminPfad()} replace />;

  return (
    <AdminPage
      titel="Aufbewahrung"
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
        <Datensicht
          bezeichnung="Aufbewahrung"
          form="tabelle"
          spalten={spalten}
          daten={eintraege ?? []}
          zeilenSchluessel={(e) => `einsatz-${e.einsatz_id}`}
          ladend={abfrage.isLoading}
          leerText="Keine abgeschlossenen Einsätze"
          karte={KARTE}
          mehrzahl="Einsätzen"
          gedaechtnis={gedaechtnis}
          onZeileKlick={(e) => {
            if (!istGeloescht(e)) navigate(adminAufbewahrungAktePfad(e.einsatz_id));
          }}
        />
      )}
    </AdminPage>
  );
}
