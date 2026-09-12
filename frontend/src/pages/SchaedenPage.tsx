import StatusTag from '../components/StatusTag';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { schadenDetailPfad } from '../routing/deeplinks';
import { Alert, Breadcrumb, Button, Space, Tabs, Tag, Typography } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeSchaeden, schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import type { Ausmass, Schaden, SchadenTyp } from '../api/types';
import {
  AUSMASS_META,
  STATUS_META,
  TYP_LABEL,
  filterSchaeden,
  geschaedigtAnzeige,
} from './schaeden/schadenHelfer';
import SchadenErfassenModal from './schaeden/SchadenErfassenModal';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { flaeche } from '../theme/tokens';

type Sicht = 'offen' | 'uebergeben' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'offen', label: 'Offen' },
  { key: 'uebergeben', label: 'Übergeben' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

/**
 * Das EINE Spaltenregister der Schadensliste (LFH-340 · C5, Bauform aus LFH-330 · B2).
 *
 * Funktion von `einsatzId` statt Modulkonstante — anders als `tierSpalten`: die
 * Geschädigt-Spalte baut Deeplinks (`geschaedigtAnzeige(s, einsatzId)`). Durch
 * `spaltenFuer<Schaden>()` geführt, nie annotiert: eine Annotation weitete die
 * Schlüsselliterale auf `string`, und der Kartenplan nähme danach jeden Tippfehler
 * unbemerkt an.
 *
 * TYP UND AUSMASS SIND SPALTENFILTER, keine Selects über der Liste mehr. Beide sind
 * geschlossene Wertemengen aus `schadenHelfer` und stehen damit dort, wo die Werte
 * stehen; die frühere Werkzeugzeile trug drei Bedienelemente für etwas, das das
 * Primitiv mitbringt. Die Reiterachse (Status) bleibt außen — sie ist das Arbeitsfach,
 * nicht eine Einengung darin.
 */
const schaedenSpalten = (einsatzId: number) =>
  spaltenFuer<Schaden>()([
    {
      title: 'Reg.-Nr.',
      key: 'reg',
      immerSichtbar: true,
      // Über die ZAHL sortiert — über den Text läge „S-10" vor „S-9".
      sortWert: (s) => s.registrier_nr,
      suchText: (s) => schadenRegistrierAnzeige(s.registrier_nr),
      // KEIN Anker: den Titel-Link setzt der Kartenplan über `titel.ziel`, in beiden Zweigen.
      render: (_, s) => (
        <Typography.Text strong>{schadenRegistrierAnzeige(s.registrier_nr)}</Typography.Text>
      ),
    },
    {
      title: 'Typ',
      key: 'typ',
      sortWert: (s) => TYP_LABEL[s.typ],
      filter: {
        werte: (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({
          text: TYP_LABEL[t],
          value: t,
        })),
        trifft: (s, wert) => s.typ === wert,
      },
      render: (_, s) => <Tag>{TYP_LABEL[s.typ]}</Tag>,
    },
    {
      title: 'Ausmaß',
      key: 'ausmass',
      // Nach SCHWERE sortiert, nicht alphabetisch: „gering" vor „groß" vor „katastrophal"
      // wäre alphabetisch g-g-k und damit zufällig fast richtig, „mittel" fiele ans Ende.
      sortWert: (s) => (Object.keys(AUSMASS_META) as Ausmass[]).indexOf(s.ausmass),
      filter: {
        werte: (Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({
          text: AUSMASS_META[a].label,
          value: a,
        })),
        trifft: (s, wert) => s.ausmass === wert,
      },
      render: (_, s) => <StatusTag darstellung={AUSMASS_META[s.ausmass]} />,
    },
    {
      title: 'Ort',
      key: 'ort',
      ellipsis: true,
      sortWert: (s) => s.ort,
      // Beschreibung trägt zur Suche bei, ohne eine eigene Spalte zu belegen: sie ist
      // Fließtext und in einer Vergleichstabelle nicht lesbar, aber das, wonach jemand
      // sucht, der den Ort nicht mehr weiß.
      suchText: (s) => [s.ort, s.beschreibung].filter(Boolean).join(' '),
      render: (_, s) => s.ort,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, s) => (
        <StatusTag
          darstellung={{
            ...STATUS_META[s.status],
            label:
              STATUS_META[s.status].label +
              (s.status === 'uebergeben' && s.uebergeben_an ? ` (${s.uebergeben_an})` : ''),
          }}
        />
      ),
    },
    {
      title: 'seit',
      key: 'seit',
      /**
       * Alter des Eintrags aus `erfasst_at`. `geaendert_at` wäre der naheliegende und
       * falsche Griff: es läuft bei jeder Übergabe und jedem Statuswechsel weiter und
       * beantwortet „wann wurde der Satz zuletzt angefasst", nicht „seit wann steht dieser
       * Schaden offen" — dieselbe Unterscheidung wie in `TierePage.tsx`.
       *
       * Keine Breitenschwelle: die Zeitachse ist der Zweck dieser Spalte, und eine Spalte,
       * die schon unter 1200 px verschwindet, wäre in jeder jsdom-Prüfung abwesend.
       */
      sortWert: (s) => s.erfasst_at,
      render: (_, s) => <ZeitAnzeige wert={s.erfasst_at} />,
    },
    {
      title: 'Verortet',
      key: 'verortet',
      /**
       * LFH-340 · C5, Befund M39. Die Liste sagte kein Wort darüber, welche Schäden auf der
       * Karte stehen — und genau das ist die Frage, mit der man vor der Karte sitzt.
       *
       * Als IKONE, nicht als Emoji: ein Emoji nimmt Zeichnung, Farbe und Breite aus der
       * Systemschrift statt aus dem Entwurf und stünde in eigener Farbe neben einer Zeile,
       * deren Farbgebung Bedeutung trägt. Die `aria-hidden`-Hülle ist Pflicht — ein
       * `@ant-design/icons`-Knoten bringt ein eigenes englisches `aria-label` mit
       * („environment"), das sonst in jeder Zeile als eigenes Vorleseziel steht.
       *
       * Filterachse statt Sortierung: „zeig mir die Unverorteten" ist die Arbeitsfrage,
       * „sortiere nach verortet" ist keine.
       */
      sortWert: (s) => (s.lat != null && s.lon != null ? 1 : 0),
      filter: {
        werte: [
          { text: 'verortet', value: 'ja' },
          { text: 'nicht verortet', value: 'nein' },
        ],
        trifft: (s, wert) => (s.lat != null && s.lon != null) === (wert === 'ja'),
      },
      render: (_, s) =>
        s.lat != null && s.lon != null ? (
          <span aria-label="verortet" role="img">
            <EnvironmentOutlined aria-hidden />
          </span>
        ) : (
          <Typography.Text type="secondary" aria-label="nicht verortet" role="img">
            —
          </Typography.Text>
        ),
    },
    {
      title: 'Geschädigt',
      key: 'geschaedigt',
      abBreite: 'lg',
      suchText: (s) =>
        s.geschaedigt_personal_name ?? s.geschaedigt_organisation_name ?? s.geschaedigt_kontakt,
      render: (_, s) => geschaedigtAnzeige(s, einsatzId),
    },
  ]);

type SchadenSpaltenKey = ReturnType<typeof schaedenSpalten>[number]['key'];

const schadenKarte = (einsatzId: number): Kartenplan<Schaden, SchadenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (s) => schadenDetailPfad(einsatzId, s.id) },
  sekundaer: ['ort', 'ausmass', 'seit'],
});

export default function SchaedenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sicht, setSicht] = useState<Sicht>('offen');

  const [erfassenOffen, setErfassenOffen] = useState(false);

  // Schaden-Liste wird über den konsolidierten Einsatz-Live-Stream (useEinsatzLiveStream
  // im EinsatzLayout, `schaden`-Event → 'einsatz-schaeden') live gehalten — LFH-206.
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });

  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const spalten = useMemo(() => schaedenSpalten(einsatzId), [einsatzId]);

  // Schnellaktion: ?neu=1 öffnet die Erfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setErfassenOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh]);

  /**
   * SEITENZUSTAND — nur `einsatzQuery` (LFH-331 · B3, D3), und erst seit LFH-340 · C5.
   *
   * Bis dahin stand hier ausdrücklich KEIN Frühausstieg, begründet damit, dass die Seite
   * „keine Breadcrumb trägt und ohne den Einsatz auskommt". Beides ist mit dem gemeinsamen
   * Seitenkopf nicht mehr wahr: Breadcrumb, Titelzeile und Einsatz-Status hängen an
   * `einsatzQuery.data`. Ohne sie gäbe es keinen Rahmen, in dem ein Listenfehler stehen
   * könnte — dieselbe Lage wie auf `PersonenPage`/`TierePage`, und deshalb dieselbe Antwort.
   */
  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const alle = schaedenQuery.data ?? [];
  const sichtbar = filterSchaeden(alle, { sicht });

  /**
   * LISTENZUSTAND — an der Stelle der Liste entschieden, nie als Frühausstieg
   * (LFH-331 · B3, D3).
   *
   * Gemessen wird an `alle`, NICHT an `sichtbar`: die gefilterte Menge ist bei gesetztem
   * Reiter, Spaltenfilter oder Suchbegriff regelmäßig leer, während Zeilen im
   * Zwischenspeicher stehen — an ihr gemessen kippte die Seite bei jedem engen Filter in
   * den Fehlerzweig.
   *
   * Ohne Zeilen tritt der Fehler an die Stelle der Liste, sonst behauptet „Keine Schäden
   * in dieser Sicht" eine leere Menge, wo bloß der Abruf scheiterte. Mit Zeilen bleiben sie
   * stehen und bekommen ein Banner: echt, nur womöglich alt. Der Ladezweig steht bewusst
   * nicht hier, sondern am Primitiv (`ladend`).
   */
  const listeGescheitert = schaedenQuery.isError && alle.length === 0;
  const standVeraltet = schaedenQuery.isError && alle.length > 0;

  const orgId = einsatz.org_id ?? 0;

  return (
    <EinsatzSeite
      breite={flaeche.seiteBreit}
      dataUpdatedAt={schaedenQuery.dataUpdatedAt}
      titel={
        <Space>
          Schäden
          {/* BEFUND wie in `PersonalPage`/`FahrzeugePage`: `EinsatzStatus` hat keine
              Statusrolle in `theme/statusFarben.ts` (Spec §1.3 listet acht Vertrags-Enums,
              dieses ist keins davon). Der Tag bleibt deshalb auf antd-Farbnamen und rohem
              Enum-Wert stehen — erfunden wird hier nichts. */}
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Schäden' },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Button type="primary" onClick={() => setErfassenOffen(true)}>
            Schnellerfassung
          </Button>
        )
      }
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette, LFH-391 · B5)
      // — mit DEMSELBEN Rechte-Riegel wie der Knopf darüber.
      neueZeile={darfSchreiben ? () => setErfassenOffen(true) : undefined}
      hinweis={
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />

      {listeGescheitert ? (
        <SeitenFehler
          text="Schäden konnten nicht geladen werden"
          ursache={schaedenQuery.error}
          onWiederholen={() => void schaedenQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && (
            <SeitenStandVeraltet onWiederholen={() => void schaedenQuery.refetch()} />
          )}

          <Datensicht
            /**
             * Vier Reiter, EINE Sichtstelle — der Schlüssel trägt deshalb die Statusachse.
             * Ohne ihn steht dieselbe Instanz über allen vier Mengen: React sieht denselben
             * Komponententyp an derselben Baumstelle und montiert nicht neu, sondern reicht
             * weiter. Suchbegriff und Spaltenfilter leben IM Primitiv und filterten danach
             * eine Menge, für die sie nie gemeint waren — im Reiter „Offen" nach einer
             * Straße gesucht, auf „Alle" gewechselt, und dort steht eine fremde Menge auf
             * diesen Ort zusammengestrichen. Kein Fehler, keine Warnung, nur fehlende
             * Zeilen. Dieselbe Falle ist an `PersonenPage` und `TierePage` gemessen und
             * dort ebenso behoben.
             */
            key={sicht}
            bezeichnung="Schäden im Einsatz"
            spalten={spalten}
            daten={sichtbar}
            zeilenSchluessel="id"
            ladend={schaedenQuery.isLoading}
            leerText="Keine Schäden in dieser Sicht"
            suche={{ platzhalter: 'S-Nr., Ort, Beschreibung' }}
            // Spiegelt die Backend-Ordnung (`ORDER BY registrier_nr DESC`): der jüngste
            // Schaden oben. Die Sortierung liegt jetzt trotzdem im Client — der Sortierpfeil
            // der Spalte dreht sie um, ohne einen Nachladevorgang.
            standardSortierung={{ spalte: 'reg', richtung: 'ab' }}
            onZeileKlick={(s) => navigate(schadenDetailPfad(einsatzId, s.id))}
            karte={schadenKarte(einsatzId)}
          />
        </>
      )}

      <SchadenErfassenModal
        open={erfassenOffen}
        onClose={() => setErfassenOffen(false)}
        einsatzId={einsatzId}
        orgId={orgId}
        orgName={einsatz.org_name ?? 'Eigene Organisation'}
      />
    </EinsatzSeite>
  );
}
