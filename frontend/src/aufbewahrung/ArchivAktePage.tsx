import { Button, Flex, Typography, theme } from 'antd';
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
import Markdown from '../components/Markdown';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
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
import { SPEZIES_META, TIER_ABSCHLUSS, TIER_STATUS } from '../pages/tiere/tierHelfer';
import { parseRouteId } from '../routing/deeplinks';
import {
  aufbewahrungZustand,
  etbTyp,
  personStatus,
  schadenAusmass,
  schadenStatus,
} from '../theme/statusFarben';
import { ETB_TYPEN, VERBLEIB_ART, VERBLEIB_STATUS, primaeraktion } from './archivText';
import { FristWert, useFristAenderung } from './FristPaneel';
import WiederherstellenDialog from './WiederherstellenDialog';

/**
 * Pseudonyme Archivakte eines abgeschlossenen Einsatzes (LFH-23, design.md D8) —
 * `/admin/aufbewahrung/:einsatzId`, nur für den System-Admin der eigenen Organisation.
 *
 * Drei Paneele: **Aufbewahrung** (Zustand, Frist, Vormerkung, Karenz-Ende, Schwärzung und der
 * Kopf ohne Einsatzort und Sachverhalt), **Register** (Personen, Tiere, Schäden als Tabellen:
 * Registriernummer und Kategorien, keine Namen, Kontakte oder Orte) und **Einsatztagebuch**
 * (lesende Zeitachse im Wortlaut). Jede Angabe stammt aus einer Retain-Spalte der
 * Schwärzungs-Registry; die Akte sieht deshalb vor und nach der Schwärzung gleich aus.
 *
 * **Genau eine Primäraktion im Kopf-Slot, je Zustand:** „Frist ändern" solange der Einsatz
 * nicht vorgemerkt ist, „Wiederherstellen" während der Karenz, keine nach Karenz-Ende oder
 * Schwärzung (der Server lehnte dort mit 409 ab).
 *
 * Das Tagebuch ist bewusst NICHT `EtbZeitachse`: die bringt Berichtigen, Folgeaufträge und
 * Deeplinks mit, deren Ziele im Archiv nicht lesbar sind. Ein Berichtigungsverweis steht als
 * Text („berichtigt Nr. 7"), nicht als Link.
 */

const leer = '—';
const ETB_SEITE = 100;
type EtbFilter = EtbTyp | 'alle';
const MELDEWEG = Object.fromEntries(MELDEWEG_OPTIONEN.map((o) => [o.value, o.label]));

const personSpalten: KatalogSpalte<ArchivPerson>[] = [
  { key: 'nr', title: 'Nr.', width: 90, zahl: true, render: (_, p) => p.registrier_anzeige },
  {
    key: 'status',
    title: 'Status',
    width: 150,
    render: (_, p) => <StatusTag darstellung={personStatus[p.status]} />,
  },
  {
    key: 'sichtung',
    title: 'Sichtung',
    width: 130,
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
    render: (_, p) => <ZeitAnzeige wert={p.erfasst_at} />,
  },
  {
    key: 'storniert',
    title: 'Storniert',
    width: 150,
    zahl: true,
    render: (_, p) => (p.storniert_at ? <ZeitAnzeige wert={p.storniert_at} /> : leer),
  },
];

const tierSpalten: KatalogSpalte<ArchivTier>[] = [
  { key: 'nr', title: 'Nr.', width: 90, zahl: true, render: (_, t) => t.registrier_anzeige },
  { key: 'art', title: 'Tierart', width: 140, render: (_, t) => SPEZIES_META[t.spezies] },
  {
    key: 'status',
    title: 'Status',
    width: 150,
    render: (_, t) => (
      <StatusChip ton={TIER_STATUS[t.status].ton} wort={TIER_STATUS[t.status].label} />
    ),
  },
  {
    key: 'abschluss',
    title: 'Abschlussgrund',
    width: 200,
    render: (_, t) => (t.abschluss_grund ? TIER_ABSCHLUSS[t.abschluss_grund] : leer),
  },
  {
    key: 'erfasst',
    title: 'Erfasst',
    width: 150,
    zahl: true,
    render: (_, t) => <ZeitAnzeige wert={t.erfasst_at} />,
  },
  {
    key: 'storniert',
    title: 'Storniert',
    width: 150,
    zahl: true,
    render: (_, t) => (t.storniert_at ? <ZeitAnzeige wert={t.storniert_at} /> : leer),
  },
];

const schadenSpalten: KatalogSpalte<ArchivSchaden>[] = [
  { key: 'nr', title: 'Nr.', width: 90, zahl: true, render: (_, s) => s.registrier_anzeige },
  { key: 'typ', title: 'Typ', width: 160, render: (_, s) => TYP_LABEL[s.typ] },
  {
    key: 'ausmass',
    title: 'Ausmaß',
    width: 140,
    render: (_, s) => <StatusTag darstellung={schadenAusmass[s.ausmass]} />,
  },
  {
    key: 'status',
    title: 'Status',
    width: 150,
    render: (_, s) => <StatusTag darstellung={schadenStatus[s.status]} />,
  },
  {
    key: 'abschluss',
    title: 'Abschlussgrund',
    width: 190,
    render: (_, s) => (s.abschluss_grund ? ABSCHLUSS_LABEL[s.abschluss_grund] : leer),
  },
  {
    key: 'erfasst',
    title: 'Erfasst',
    width: 150,
    zahl: true,
    render: (_, s) => <ZeitAnzeige wert={s.erfasst_at} />,
  },
  {
    key: 'storniert',
    title: 'Storniert',
    width: 150,
    zahl: true,
    render: (_, s) => (s.storniert_at ? <ZeitAnzeige wert={s.storniert_at} /> : leer),
  },
];

function Registerteil<T extends object>({
  titel,
  leerText,
  spalten,
  daten,
}: {
  titel: string;
  leerText: string;
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
  formatZeit: (utc: string) => string,
): string | undefined {
  const teile = [
    istNachgetragen(e.ereigniszeit, e.received_at)
      ? `nachgetragen um ${formatZeit(e.received_at)}`
      : null,
    berichtigungText(e, nrVonId),
    e.veranlassung ? `Veranlassung: ${e.veranlassung}` : null,
  ].filter((t): t is string => t != null);
  return teile.length > 0 ? teile.join(' · ') : undefined;
}

function ArchivEtb({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const { formatZeit } = useAnzeigeKonventionen();
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
  const eintraege = abfrage.data?.pages.flat() ?? [];
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
            zeit={<ZeitAnzeige wert={e.ereigniszeit} format="dtg" />}
            nr={`Nr. ${e.lfd_nr}`}
            typ={e.typ}
            typwort={etbTyp[e.typ].label}
            meta={e.von || e.an ? `${e.von || leer} → ${e.an || leer}` : undefined}
            toenung={e.typ === 'berichtigung' ? 'berichtigung' : undefined}
            hinweis={archivHinweis(e, nrVonId, formatZeit)}
            verfasser={verfasserText(e)}
            weg={e.meldeweg ? MELDEWEG[e.meldeweg] : undefined}
          >
            {/* Unter dem Paneelkopf (h2) — `#` im Eintrag wird h3 (LFH-621). */}
            <Markdown variante="kompakt" unterEbene={2}>
              {e.inhalt}
            </Markdown>
          </Zeitachseneintrag>
        ))}
      </ol>
    );
  }

  return (
    <Paneel titel="Einsatztagebuch" meta="ETB im Wortlaut · gesetzliches Aufbewahrungsskelett">
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
        {inhalt}
        {/* Ein gescheitertes Nachladen meldet sich dort, wo die Person steht (H14/LFH-535):
            ohne diese Zeile stünde der Knopf wieder bereit, und ein Fehlschlag wäre von
            „nichts Älteres“ nicht zu unterscheiden. Die geladenen Seiten bleiben stehen. */}
        {abfrage.isFetchNextPageError && (
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

function AkteInhalt({ einsatzId, akte }: { einsatzId: number; akte: ArchivAkte }) {
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
      beschreibung="Pseudonyme Archivakte — Namen, Kontakte, Orte und der Sachverhalt erscheinen hier nicht, auch nicht während der Karenz."
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

        <Paneel titel="Register" koerperPolster>
          <Registerteil
            titel="Personen"
            leerText="Keine Personen erfasst"
            spalten={personSpalten}
            daten={akte.personen}
          />
          <Registerteil
            titel="Tiere"
            leerText="Keine Tiere erfasst"
            spalten={tierSpalten}
            daten={akte.tiere}
          />
          <Registerteil
            titel="Schäden"
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
  if (!abfrage.data) {
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
  return <AkteInhalt einsatzId={einsatzId} akte={abfrage.data} />;
}
