import { Button, Flex, Typography, theme } from 'antd';
import { EinsatzAnzeigeProvider, OrgAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { ladeArchivAkte, ladeArchivEtb } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type {
  ArchivAkte,
  ArchivEtbEintrag,
  ArchivPerson,
  ArchivSchaden,
  ArchivTier,
  EtbTyp,
} from '../api/types';
import { adminAufbewahrungPfad, defaultAdminPfad } from '../admin/adminNav';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { nachFolge, nachText, nachZahl, werteAusKatalog } from '../components/katalogVergleich';
import Markdown from '../components/Markdown';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import SichtungsTag from '../components/SichtungsTag';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import {
  Augenbraue,
  Datenfeld,
  Datenraster,
  Paneel,
  Segmentleiste,
  StatusChip,
  Zeitachseneintrag,
} from '../components/instrument';
import { istAdmin } from '../einsatz/schreibrecht';
import { MELDEWEG_OPTIONEN } from '../etb/schnellerfassungModell';
import { istNachgetragen } from '../etb/typFarben';
import { verfasserText } from '../etb/verfasser';
import { ABSCHLUSS_LABEL, TYP_LABEL } from '../pages/schaeden/schadenHelfer';
import { SPEZIES_META, TIER_STATUS, TIER_VERBLEIB } from '../pages/tiere/tierHelfer';
import { parseRouteId } from '../routing/deeplinks';
import {
  aufbewahrungZustand,
  etbTyp,
  personStatus,
  schadenAusmass,
  schadenStatus,
  sichtung,
} from '../theme/statusFarben';
import { standVerworfen } from './archivAbruf';
import { ETB_TYPEN, VERBLEIB_ART, VERBLEIB_STATUS, primaeraktion } from './archivText';
import { FristWert, useFristAenderung } from './FristPaneel';
import { KategorieWert } from './KategorieFristen';
import { KATEGORIE_TEXT } from './kategorieText';
import Loeschersuchen from './Loeschersuchen';
import WiederherstellenDialog from './WiederherstellenDialog';

/**
 * Pseudonyme Archivakte eines abgeschlossenen Einsatzes — `/admin/aufbewahrung/:einsatzId`,
 * nur für den System-Admin der eigenen Organisation.
 *
 * Vier Paneele: **Aufbewahrung** (Zustand, Fristen, Schwärzung, Kopf ohne Ort und
 * Sachverhalt), **Löschersuchen** (Art. 17, LFH-751: Anträge, Rücknahme, Personensuche),
 * **Register** (Personen, Tiere, Schäden ohne Namen, Kontakte oder Orte) und
 * **Einsatztagebuch** (lesende Zeitachse). Jede Angabe stammt aus einer Retain-Spalte, die
 * Akte sieht deshalb vor und nach der Schwärzung gleich aus.
 *
 * Genau eine Primäraktion je Zustand: „Frist ändern" solange nicht vorgemerkt,
 * „Wiederherstellen" während der Karenz, danach keine (der Server lehnte mit 409 ab).
 *
 * Das Tagebuch ist bewusst NICHT `EtbZeitachse`: deren Aktionen und Deeplinks zielen auf im
 * Archiv nicht lesbare Ziele. Ein Berichtigungsverweis steht als Text, nicht als Link.
 *
 * **Ein gescheiterter Neuabruf zeigt den Zwischenstand nicht wie frisch** (LFH-756): TanStack
 * behält die Daten auch nach einem Fehler. Lehnt der Server ab (`standVerworfen`), verschwindet
 * der Stand; jeder andere Fehler lässt ihn stehen und meldet ihn als veraltet.
 */

const leer = '—';
const ETB_SEITE = 100;
type EtbFilter = EtbTyp | 'alle';
const MELDEWEG = Object.fromEntries(MELDEWEG_OPTIONEN.map((o) => [o.value, o.label]));

/**
 * Sortieren und Filtern im Spaltenkopf (LLH-1096, Spec `tabellen-sortieren-filtern`): die Register
 * sortieren nach Nummer, Status und Zeiten und filtern nach ihren festen Katalogen. Ohne
 * Listengedächtnis: drei Register und die Löschersuchen teilen sich eine Seite, ihre Adresse trägt
 * nur eine Liste (`sort=`, `f.<spalte>=`). Die Wahl gilt, solange die Akte offen ist.
 */
// Zeiten kommen als ISO-Zeitstempel in UTC: ihre Textfolge ist die Zeitfolge.
type Register = { registrier_nr: number; erfasst_at: string; storniert_at?: string | null };

const OHNE_SICHTUNG = 'ohne';
const SICHTUNG_WERTE = [
  ...werteAusKatalog(sichtung),
  { text: 'ohne Sichtung', value: OHNE_SICHTUNG },
];

function nrSpalte<T extends Register & { registrier_anzeige: string }>(): KatalogSpalte<T> {
  return {
    key: 'nr',
    title: 'Nr.',
    width: 90,
    zahl: true,
    sorter: nachZahl((z: T) => z.registrier_nr),
    render: (_, z) => z.registrier_anzeige,
  };
}

const personSpalten: KatalogSpalte<ArchivPerson>[] = [
  nrSpalte<ArchivPerson>(),
  {
    key: 'status',
    title: 'Status',
    width: 150,
    sorter: nachFolge(Object.keys(personStatus), (p: ArchivPerson) => p.status),
    filters: werteAusKatalog(personStatus),
    onFilter: (w, p) => p.status === w,
    render: (_, p) => <StatusTag darstellung={personStatus[p.status]} />,
  },
  {
    key: 'sichtung',
    title: 'Sichtung',
    width: 130,
    sorter: nachFolge(Object.keys(sichtung), (p: ArchivPerson) => p.aktuelle_sichtung),
    filters: SICHTUNG_WERTE,
    onFilter: (w, p) => (p.aktuelle_sichtung ?? OHNE_SICHTUNG) === w,
    render: (_, p) =>
      p.aktuelle_sichtung ? <SichtungsTag kategorie={p.aktuelle_sichtung} /> : leer,
  },
  {
    key: 'verbleib',
    title: 'Verbleib',
    width: 200,
    render: (_, p) =>
      p.aktuelle_verbleib_art
        ? [
            VERBLEIB_ART[p.aktuelle_verbleib_art],
            p.aktueller_verbleib_status && VERBLEIB_STATUS[p.aktueller_verbleib_status],
          ]
            .filter(Boolean)
            .join(' · ')
        : leer,
  },
  {
    key: 'erfasst',
    title: 'Erfasst',
    width: 150,
    zahl: true,
    sorter: nachText((z: Register) => z.erfasst_at),
    render: (_, p) => <ZeitAnzeige wert={p.erfasst_at} />,
  },
  {
    key: 'storniert',
    title: 'Storniert',
    width: 150,
    zahl: true,
    sorter: nachText((z: Register) => z.storniert_at),
    render: (_, p) => (p.storniert_at ? <ZeitAnzeige wert={p.storniert_at} /> : leer),
  },
  {
    // LFH-751: eine auf Antrag geschwärzte Person ist als solche gekennzeichnet.
    key: 'loeschersuchen',
    title: 'Löschersuchen',
    width: 260,
    render: (_, p) =>
      p.auf_antrag_geschwaerzt_at ? (
        <span data-lfh="auf-antrag-geschwaerzt">
          auf Antrag geschwärzt · <ZeitAnzeige wert={p.auf_antrag_geschwaerzt_at} />
        </span>
      ) : (
        leer
      ),
  },
];

const tierSpalten: KatalogSpalte<ArchivTier>[] = [
  nrSpalte<ArchivTier>(),
  {
    key: 'art',
    title: 'Tierart',
    width: 140,
    sorter: nachText((t: ArchivTier) => SPEZIES_META[t.spezies]),
    filters: werteAusKatalog(SPEZIES_META),
    onFilter: (w, t) => t.spezies === w,
    render: (_, t) => SPEZIES_META[t.spezies],
  },
  {
    key: 'status',
    title: 'Status',
    width: 150,
    sorter: nachFolge(Object.keys(TIER_STATUS), (t: ArchivTier) => t.status),
    filters: werteAusKatalog(TIER_STATUS),
    onFilter: (w, t) => t.status === w,
    render: (_, t) => (
      <StatusChip ton={TIER_STATUS[t.status].ton} wort={TIER_STATUS[t.status].label} />
    ),
  },
  {
    key: 'abschluss',
    // Dasselbe Wort wie auf der Seite des Tiers (LLH-1092).
    title: 'Verbleib',
    width: 200,
    // Nur am abgeschlossenen Tier: beim Wiederaufnehmen bleibt der Grund gespeichert, gilt aber
    // nicht mehr (wie `verbleibText` in Liste und Druck).
    render: (_, t) =>
      t.status === 'abgeschlossen' && t.abschluss_grund ? TIER_VERBLEIB[t.abschluss_grund] : leer,
  },
  {
    key: 'erfasst',
    title: 'Erfasst',
    width: 150,
    zahl: true,
    sorter: nachText((z: Register) => z.erfasst_at),
    render: (_, t) => <ZeitAnzeige wert={t.erfasst_at} />,
  },
  {
    key: 'storniert',
    title: 'Storniert',
    width: 150,
    zahl: true,
    sorter: nachText((z: Register) => z.storniert_at),
    render: (_, t) => (t.storniert_at ? <ZeitAnzeige wert={t.storniert_at} /> : leer),
  },
];

const schadenSpalten: KatalogSpalte<ArchivSchaden>[] = [
  nrSpalte<ArchivSchaden>(),
  {
    key: 'typ',
    title: 'Typ',
    width: 160,
    sorter: nachText((s: ArchivSchaden) => TYP_LABEL[s.typ]),
    filters: werteAusKatalog(TYP_LABEL),
    onFilter: (w, s) => s.typ === w,
    render: (_, s) => TYP_LABEL[s.typ],
  },
  {
    key: 'ausmass',
    title: 'Ausmaß',
    width: 140,
    sorter: nachFolge(Object.keys(schadenAusmass), (s: ArchivSchaden) => s.ausmass),
    filters: werteAusKatalog(schadenAusmass),
    onFilter: (w, s) => s.ausmass === w,
    render: (_, s) => <StatusTag darstellung={schadenAusmass[s.ausmass]} />,
  },
  {
    key: 'status',
    title: 'Status',
    width: 150,
    sorter: nachFolge(Object.keys(schadenStatus), (s: ArchivSchaden) => s.status),
    filters: werteAusKatalog(schadenStatus),
    onFilter: (w, s) => s.status === w,
    render: (_, s) => <StatusTag darstellung={schadenStatus[s.status]} />,
  },
  {
    key: 'abschluss',
    title: 'Abschlussgrund',
    width: 190,
    filters: werteAusKatalog(ABSCHLUSS_LABEL),
    onFilter: (w, s) => s.abschluss_grund === w,
    render: (_, s) => (s.abschluss_grund ? ABSCHLUSS_LABEL[s.abschluss_grund] : leer),
  },
  {
    key: 'erfasst',
    title: 'Erfasst',
    width: 150,
    zahl: true,
    sorter: nachText((z: Register) => z.erfasst_at),
    render: (_, s) => <ZeitAnzeige wert={s.erfasst_at} />,
  },
  {
    key: 'storniert',
    title: 'Storniert',
    width: 150,
    zahl: true,
    sorter: nachText((z: Register) => z.storniert_at),
    render: (_, s) => (s.storniert_at ? <ZeitAnzeige wert={s.storniert_at} /> : leer),
  },
];

function Registerteil<T extends object>({
  titel,
  leerText,
  mehrzahl,
  spalten,
  daten,
}: {
  titel: string;
  leerText: string;
  mehrzahl: string;
  spalten: KatalogSpalte<T>[];
  daten: T[];
}) {
  const { token } = theme.useToken();
  return (
    <section style={{ marginBottom: token.marginLG }}>
      <Augenbraue als="h3" style={{ marginBottom: token.marginXS }}>
        {`${titel} · ${daten.length}`}
      </Augenbraue>
      <KatalogTabelle<T>
        rowKey={(z) => String((z as { registrier_nr: number }).registrier_nr)}
        pagination={false}
        columns={spalten}
        dataSource={daten}
        locale={{ emptyText: leerText }}
        mehrzahl={mehrzahl}
      />
    </section>
  );
}

/** Reine Anzeige des Berichtigungsverweises: die laufende Nummer, wenn der Grundeintrag in
 *  der geladenen Menge steht, sonst ein allgemeiner Text — nie die DB-`id`. */
export function berichtigungText(
  e: ArchivEtbEintrag,
  nrVonId: ReadonlyMap<number, number>,
): string | null {
  if (e.berichtigt_eintrag_id == null) return null;
  const nr = nrVonId.get(e.berichtigt_eintrag_id);
  return nr != null ? `berichtigt Nr. ${nr}` : 'berichtigt einen älteren Eintrag';
}

/**
 * Hinweiszeile eines Archiv-Eintrags: Nachtrag, Berichtigungsverweis und Veranlassung —
 * dieselben Angaben wie im Tagebuch des Einsatzes, aber als Text, nie als Link.
 */
export function archivHinweis(
  e: ArchivEtbEintrag,
  nrVonId: ReadonlyMap<number, number>,
  zeitpunkt: (utc: string) => string,
): string | undefined {
  const teile = [
    istNachgetragen(e.ereigniszeit, e.received_at)
      ? `nachgetragen um ${zeitpunkt(e.received_at)}`
      : null,
    berichtigungText(e, nrVonId),
    e.veranlassung ? `Veranlassung: ${e.veranlassung}` : null,
  ].filter((t): t is string => t != null);
  return teile.length > 0 ? teile.join(' · ') : undefined;
}

function ArchivEtb({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const { zeitpunkt } = useAnzeigeKonventionen();
  const [filter, setFilter] = useState<EtbFilter>('alle');
  const typ = filter === 'alle' ? undefined : filter;
  const abfrage = useInfiniteQuery({
    queryKey: globalKeys.aufbewahrungEtb(einsatzId, typ),
    queryFn: ({ pageParam }) =>
      ladeArchivEtb(einsatzId, { typ, beforeLfdNr: pageParam, limit: ETB_SEITE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < ETB_SEITE ? undefined : letzte[letzte.length - 1]?.lfd_nr,
  });
  const verworfen = abfrage.isError && standVerworfen(abfrage.error);
  const eintraege = verworfen ? [] : (abfrage.data?.pages.flat() ?? []);
  const nrVonId = new Map(eintraege.map((e) => [e.id, e.lfd_nr]));

  let inhalt: ReactNode;
  if (abfrage.isLoading) inhalt = <SeitenSkeleton />;
  else if (abfrage.isError && eintraege.length === 0) {
    inhalt = (
      <SeitenFehler
        text="Einsatztagebuch nicht ladbar"
        ursache={abfrage.error}
        onWiederholen={() => void abfrage.refetch()}
      />
    );
  } else if (eintraege.length === 0) {
    inhalt = <Typography.Text type="secondary">Keine Einträge.</Typography.Text>;
  } else {
    inhalt = (
      <ol data-lfh="archiv-zeitachse" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {eintraege.map((e) => (
          <Zeitachseneintrag
            key={e.id}
            als="li"
            zeit={<ZeitAnzeige wert={e.ereigniszeit} rolle="kurz" />}
            nr={`Nr. ${e.lfd_nr}`}
            typ={e.typ}
            typwort={etbTyp[e.typ].label}
            meta={e.von || e.an ? `${e.von || leer} → ${e.an || leer}` : undefined}
            toenung={e.typ === 'berichtigung' ? 'berichtigung' : undefined}
            hinweis={archivHinweis(e, nrVonId, zeitpunkt)}
            verfasser={verfasserText(e)}
            weg={e.meldeweg ? MELDEWEG[e.meldeweg] : undefined}
          >
            {/* Unter dem Paneelkopf (h2) — `#` im Eintrag wird h3. */}
            <Markdown variante="kompakt" unterEbene={2}>
              {e.inhalt}
            </Markdown>
          </Zeitachseneintrag>
        ))}
      </ol>
    );
  }

  return (
    <Paneel titel="Einsatztagebuch" meta="ETB im Wortlaut">
      <div style={{ padding: token.padding }}>
        <Segmentleiste<EtbFilter>
          beschriftung="Eintragstyp"
          wert={filter}
          onWechsel={setFilter}
          optionen={[
            { wert: 'alle', label: 'alle' },
            ...ETB_TYPEN.map((t) => ({ wert: t, label: etbTyp[t].label })),
          ]}
          style={{ marginBottom: token.marginSM }}
        />
        {abfrage.isRefetchError && eintraege.length > 0 && (
          <div style={{ marginBottom: token.marginSM }}>
            <SeitenStandVeraltet onWiederholen={() => void abfrage.refetch()} />
          </div>
        )}
        {inhalt}
        {/* Ein gescheitertes Nachladen meldet sich hier, sonst wäre es von „nichts Älteres“ nicht zu
           unterscheiden. Die geladenen Seiten bleiben stehen. */}
        {abfrage.isFetchNextPageError && !verworfen && (
          <div style={{ marginTop: token.marginSM }}>
            <SeitenFehler text="Ältere Einträge nicht ladbar" ursache={abfrage.error} />
          </div>
        )}
        {abfrage.hasNextPage && (
          <Flex justify="center" style={{ marginTop: token.marginSM }}>
            <Button
              onClick={() => void abfrage.fetchNextPage()}
              loading={abfrage.isFetchingNextPage}
            >
              Ältere laden
            </Button>
          </Flex>
        )}
      </div>
    </Paneel>
  );
}

function AkteInhalt({
  einsatzId,
  akte,
  veraltet,
}: {
  einsatzId: number;
  akte: ArchivAkte;
  /** Der Neuabruf ist gescheitert, ohne dass der Server abgelehnt hätte: Stand bleibt, als alt. */
  veraltet?: { onWiederholen: () => void };
}) {
  const { token } = theme.useToken();
  const [wiederherstellenOffen, setWiederherstellenOffen] = useState(false);
  const frist = useFristAenderung(einsatzId, akte.kopf.retention_bis);
  const { kopf } = akte;
  const label = kopf.einsatznummer_intern ?? kopf.bezeichnung;
  const aktion = primaeraktion(akte.zustand);

  return (
    <AdminPage
      titel={
        kopf.einsatznummer_intern
          ? `${kopf.einsatznummer_intern} · ${kopf.bezeichnung}`
          : kopf.bezeichnung
      }
      beschreibung="Pseudonym: ohne Namen, Kontakte, Orte und Sachverhalt"
      hinweis={veraltet && <SeitenStandVeraltet onWiederholen={veraltet.onWiederholen} />}
      aktionen={
        aktion === 'frist' ? (
          <Button type="primary" onClick={frist.oeffnen}>
            Frist ändern
          </Button>
        ) : aktion === 'wiederherstellen' ? (
          <Button type="primary" onClick={() => setWiederherstellenOffen(true)}>
            Wiederherstellen
          </Button>
        ) : undefined
      }
    >
      <Flex vertical gap={token.marginLG}>
        <Paneel titel="Aufbewahrung" koerperPolster>
          <Datenraster spalten={3} beschriftung="Aufbewahrung">
            <Datenfeld label="Zustand">
              <StatusTag darstellung={aufbewahrungZustand[akte.zustand]} />
            </Datenfeld>
            <Datenfeld label="Frist" mono={kopf.retention_bis != null}>
              <FristWert einsatz={{ status: 'abgeschlossen', retention_bis: kopf.retention_bis }} />
            </Datenfeld>
            <Datenfeld label="Abgeschlossen" mono>
              {kopf.abgeschlossen_at ? <ZeitAnzeige wert={kopf.abgeschlossen_at} /> : leer}
            </Datenfeld>
            <Datenfeld label="Zur Löschung vorgemerkt" mono>
              {kopf.geloescht_at ? <ZeitAnzeige wert={kopf.geloescht_at} /> : leer}
            </Datenfeld>
            <Datenfeld label="Karenz-Ende" mono>
              {akte.karenz_ende ? <ZeitAnzeige wert={akte.karenz_ende} /> : leer}
            </Datenfeld>
            <Datenfeld label="Geschwärzt" mono>
              {kopf.geschwaerzt_at ? <ZeitAnzeige wert={kopf.geschwaerzt_at} /> : leer}
            </Datenfeld>
            {akte.antrag_faellig_at && (
              <Datenfeld label="Schwärzung auf Antrag ab" mono>
                <ZeitAnzeige wert={akte.antrag_faellig_at} />
              </Datenfeld>
            )}
            <Datenfeld label="Stichwort">{kopf.stichwort ?? leer}</Datenfeld>
            <Datenfeld label="Leitstellen-Nr." mono>
              {kopf.leitstellen_nr ?? leer}
            </Datenfeld>
            <Datenfeld label="Betroffene (Erstmeldung)" mono>
              {kopf.anzahl_betroffene_initial ?? leer}
            </Datenfeld>
            <Datenfeld label="Begonnen" mono>
              <ZeitAnzeige wert={kopf.begonnen_at} />
            </Datenfeld>
          </Datenraster>
          {/* Fehler eines Frist-PUT ohne offenen Dialog — der Dialog zeigt seinen selbst. */}
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler fehler={frist.fehlerAussen} />
          </div>
        </Paneel>

        {/* LFH-749: Aufbewahrung je Datenkategorie, nur lesend — ändern geht am Einsatz. */}
        <Paneel titel="Datenkategorien" koerperPolster>
          <Datenraster spalten={3} beschriftung="Datenkategorien">
            {akte.kategorien.map((k) => (
              <Datenfeld key={k.kategorie} label={KATEGORIE_TEXT[k.kategorie].bezeichnung}>
                <KategorieWert eintrag={k} aktiv={false} />
              </Datenfeld>
            ))}
          </Datenraster>
        </Paneel>

        <Loeschersuchen einsatzId={einsatzId} akte={akte} />

        <Paneel titel="Register" koerperPolster>
          <Registerteil
            titel="Personen"
            mehrzahl="Personen"
            leerText="Keine Personen erfasst"
            spalten={personSpalten}
            daten={akte.personen}
          />
          <Registerteil
            titel="Tiere"
            mehrzahl="Tieren"
            leerText="Keine Tiere erfasst"
            spalten={tierSpalten}
            daten={akte.tiere}
          />
          <Registerteil
            titel="Schäden"
            mehrzahl="Schäden"
            leerText="Keine Schäden erfasst"
            spalten={schadenSpalten}
            daten={akte.schaeden}
          />
        </Paneel>

        <ArchivEtb einsatzId={einsatzId} />
      </Flex>
      {frist.dialoge}
      {wiederherstellenOffen && (
        <WiederherstellenDialog
          einsatzId={einsatzId}
          einsatzLabel={label}
          onSchliessen={() => setWiederherstellenOffen(false)}
        />
      )}
    </AdminPage>
  );
}

export default function ArchivAktePage() {
  const { einsatzId: roh } = useParams();
  const einsatzId = parseRouteId(roh);
  const { benutzer, laedt: authLaedt } = useAuth();
  const admin = istAdmin(benutzer);
  const abfrage = useQuery({
    queryKey: globalKeys.aufbewahrungAkte(einsatzId ?? 0),
    queryFn: () => ladeArchivAkte(einsatzId!),
    enabled: admin && einsatzId != null,
  });

  if (!authLaedt && !admin) return <Navigate to={defaultAdminPfad()} replace />;
  if (einsatzId == null) return <Navigate to={adminAufbewahrungPfad()} replace />;
  if (abfrage.isLoading || authLaedt) return <SeitenSkeleton />;
  if (!abfrage.data || (abfrage.isError && standVerworfen(abfrage.error))) {
    return (
      <AdminPage titel="Archivakte">
        <SeitenFehler
          text="Archivakte nicht ladbar"
          ursache={abfrage.error}
          onWiederholen={() => void abfrage.refetch()}
        />
      </AdminPage>
    );
  }
  // Anzeige und Frist-Eingabe in der Zone dieses Einsatzes; ist sie nicht lesbar, in der der
  // Organisation (LFH-692, Spec `zeiteingabe`, „Zone außerhalb eines Einsatzes“).
  return (
    <OrgAnzeigeProvider>
      <EinsatzAnzeigeProvider einsatzId={einsatzId}>
        <AkteInhalt
          einsatzId={einsatzId}
          akte={abfrage.data}
          veraltet={
            abfrage.isRefetchError ? { onWiederholen: () => void abfrage.refetch() } : undefined
          }
        />
      </EinsatzAnzeigeProvider>
    </OrgAnzeigeProvider>
  );
}
