import { Alert, Breadcrumb, Button, Space, Tag } from 'antd';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { ladeEinsatz } from '../api/einsaetze';
import { PERSONAL_BEMERKUNG_MAX } from '../api/eingabegrenzen';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { listePersonalStatus } from '../api/personalStatus';
import { listeQualifikationen } from '../api/qualifikationen';
import {
  updateDisposition,
  listeEinsatzPersonal,
  listEntlassenesPersonal,
  reaktiviereDisposition,
} from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { einsatzkraftPfad, kraefteuebersichtPfad } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import { dauerText, kraftDauern, type KraftDauern } from '../kraefte/zeitachse';
import { listePersonalPerioden } from '../api/kraefteZeitachse';
import { abrufZustand } from '../api/abrufZustand';
import { useUhr } from '../abloesung/useUhr';
import { monoStil } from '../components/instrument';
import AdhocPersonModal from '../kraefte/AdhocPersonModal';
import PersonalDisponierenModal from '../kraefte/PersonalDisponierenModal';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzPersonal } from '../api/types';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import Datensicht, { scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import { KATEGORIE_WERTE, kategorieVon } from '../kraefte/statusAchse';
import { statusKategorie } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import DemoMarke from '../components/DemoMarke';
import { personalStatusDarstellung } from '../kraefte/mittelStatus';
import { useZeilenFehler } from '../components/useZeilenFehler';
import {
  katalogStatusWechsel,
  useOptimistischesZeilenUpdate,
} from '../kraefte/useOptimistischesZeilenUpdate';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import EinsatzfunktionZelle from '../kraefte/EinsatzfunktionZelle';
import { einsatzfunktionVorschlaege, funktionText } from '../kraefte/einsatzfunktionKern';
import EinheitAngabe from '../kraefte/EinheitAngabe';
import FahrzeugAngabe from '../kraefte/FahrzeugAngabe';
import PositionAngabe from '../kraefte/PositionAngabe';
import { buildEinheitGruppen, buildEinheitOptions } from '../kraefte/einteilungKern';
import { useEinteilungSchreiben } from '../kraefte/useEinteilungSchreiben';

/**
 * Die Personalliste eines Einsatzes (LLH-1060, Spec `personal-ansicht`): gruppiert nach Einheit,
 * Einheit, Fahrzeug und Position in der Zeile änderbar, der Name führt in die Personenansicht
 * (`EinsatzkraftPage`). Entlassen, Stornieren und die Zeitachse stehen nur dort (D8).
 */
export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [disponierenOffen, setDisponierenOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const schreiben = useEinteilungSchreiben(einsatzId);

  // Einheit und Fahrzeug hängen am Recht ihres Moduls (D3): ohne Freigabe weder Spalte noch Abruf.
  const freigaben = useModulFreigaben(einsatzId);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const fahrzeugeFrei = istKeyFreigegeben('fahrzeuge', freigaben);
  const abschnitteFrei = istKeyFreigegeben('einsatzabschnitte', freigaben);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const epQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  // Entlassene Kräfte (LLH-1079): getrennt geliefert, die Liste und ihre Zahlen kennen sie nicht.
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.personalEntlassene(einsatzId),
    queryFn: () => listEntlassenesPersonal(einsatzId),
  });
  const statusQuery = useQuery({
    queryKey: globalKeys.personalStatus(),
    queryFn: listePersonalStatus,
  });
  // Vorschläge der Einsatzfunktion (LLH-1067, D1): fehlt der Katalog, bleiben Vorgaben und Vergebenes.
  const qualifikationenQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenFrei,
  });
  // Rang der Abschnitte ordnet Geschwister im Kräftebaum (LLH-1025); ohne Freigabe die Eingabefolge.
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: einheitenFrei && abschnitteFrei,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugeFrei,
  });
  // Kräfte-Zeitachse (LFH-552): Perioden je Person für „Einsatzdauer" und „Ruhe". Scheitert der
  // Abruf, bleiben die Zellen leer — ein „—" behauptete sonst „keine Ereignisse".
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachsePersonal(einsatzId),
    queryFn: () => listePersonalPerioden(einsatzId),
  });
  const uhr = useUhr(60_000);

  // `?personal=<id>` bleibt Zeilenmarke (D2): Lagekarte und Schaden springen hierher, um die Person
  // im Vergleich zu sehen; die Zeile wird hervorgehoben und ins Bild gerollt (best-effort).
  useQueryParamSelektion('personal', epQuery.isSuccess, (pid) => {
    if ((epQuery.data ?? []).some((p) => p.id === pid)) setHighlightId(pid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    scrolleZurZeile(highlightId);
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  // Ablehnungen von Status, Bemerkung und „Erneut disponieren“ an der Zeile, je Disposition
  // gemerkt (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077). Einheit, Fahrzeug, Position
  // und Einsatzfunktion zeigen ihren Grund selbst an der Angabe (`InlineAngabe`, D4).
  const zeilen = useZeilenFehler<number>();

  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzPersonal,
    { epId: number; statusId: number }
  >({
    queryKey: einsatzKeys.personal(einsatzId),
    mutationFn: (v) => updateDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    zeilenId: (v) => v.epId,
    ...katalogStatusWechsel<EinsatzPersonal>(statusQuery.data),
    onBeginn: (v) => zeilen.beginne(v.epId),
    onFehler: (e, v) => zeilen.melde(v.epId, e, 'Status nicht geändert'),
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { epId: number; bemerkung: string }) =>
      updateDisposition(einsatzId, v.epId, { bemerkung: v.bemerkung }),
    onMutate: (v) => zeilen.beginne(v.epId),
    onSuccess: invalidate,
    onError: (e, v) => zeilen.melde(v.epId, e, 'Bemerkung nicht gespeichert'),
  });
  // Erneut disponieren (LLH-1079) bleibt im Block „Entlassen“ unter der Liste; die Ablehnung steht
  // an ihrem Eintrag.
  const reaktivierenMutation = useMutation({
    mutationFn: (epId: number) => reaktiviereDisposition(einsatzId, epId),
    onMutate: (epId) => zeilen.beginne(epId),
    onSuccess: invalidate,
    onError: (e, epId) => zeilen.melde(epId, e, 'Nicht erneut disponiert'),
  });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  const eps = epQuery.data ?? [];
  const entlassene = entlasseneQuery.data ?? [];

  /**
   * Listenzustand — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im Zwischenspeicher
   * tritt der Fehler an die Stelle der Datensicht, sonst behauptete „Noch kein Personal disponiert"
   * eine leere Disposition. Mit Zeilen bleiben sie stehen und bekommen ein Banner: echt, nur
   * womöglich alt.
   *
   * Gemessen an `eps`, der ungefilterten Menge: Suche, Trägerfilter und Gruppenachse leben im
   * Primitiv; an ihrer Restmenge gemessen kippte die Seite bei jedem engen Filter in den
   * Fehlerzweig.
   *
   * Nicht zu verwechseln mit dem Statuskatalog-Banner weiter unten: das steht zusätzlich über der
   * Tabelle und tauscht nichts aus.
   */
  const listeGescheitert = epQuery.isError && eps.length === 0;
  const standVeraltet = epQuery.isError && eps.length > 0;

  const einheiten = einheitenQuery.data ?? [];
  const abschnitte = abschnitteFrei ? (abschnitteQuery.data ?? []) : [];
  const einheitOptionen = buildEinheitOptions(einheiten, abschnitte);
  // Ohne geladene Einheitenliste ungruppiert: „Einheit #12“ als Etikett gibt es nicht (D6).
  const einheitGruppen = buildEinheitGruppen(
    einheitenFrei ? einheitenQuery.data : undefined,
    abschnitte,
  );
  const fahrzeuge = fahrzeugeQuery.data ?? [];
  const stati = statusQuery.data ?? [];
  const vorschlaege = einsatzfunktionVorschlaege({
    vergeben: eps.map((ep) => ep.einsatzfunktion),
    qualifikationen: (qualifikationenQuery.data ?? []).map((q) => q.label),
  });

  /**
   * Der Katalog als Menüwerte — einmal gebaut, von Tabellen- und Kartenzweig gelesen.
   * Mandantengepflegt wie beim Fahrzeug; zu viele Werte für eine waagerechte Reihe.
   */
  const statusOptionen: StatusOption<number>[] = stati.map((s) => ({
    wert: s.id,
    label: s.label,
    darstellung: s.kategorie ? statusKategorie[s.kategorie] : undefined,
    farbe: s.farbe,
  }));

  /** Gemeinsamer Bedienweg für beide Zweige — Herleitung in `FahrzeugePage.tsx`. */
  const statusBedienungVon = (ep: EinsatzPersonal) => {
    const laeuft = statusMutation.isPending && statusMutation.variables?.epId === ep.id;
    return {
      optionen: statusOptionen,
      aktuell: laeuft ? statusMutation.variables?.statusId : ep.status_id,
      farbe: ep.status_farbe,
      kennung: ep.name,
      laeuft,
      gesperrt: statusMutation.isPending,
      onWaehlen: (wert: string | number) => {
        if (!statusMutation.isPending)
          statusMutation.mutate({ epId: ep.id, statusId: Number(wert) });
      },
    };
  };

  /**
   * Trägerfilter aus den eigenen Daten; `undefined` ohne Werte. Das Feld erscheint erst mit dem
   * ersten gepflegten Wert, nach dem Laden — gewollt: ein dauerhaft leeres Filterfeld sieht wie ein
   * Werkzeug aus und ist keins.
   */
  const traegerWerte = [
    ...new Set(eps.map((e) => e.traegerorganisation).filter((t): t is string => !!t)),
  ]
    .sort()
    .map((t) => ({ text: t, value: t }));
  const traegerFilter =
    traegerWerte.length > 0
      ? {
          werte: traegerWerte,
          trifft: (e: EinsatzPersonal, w: string) => e.traegerorganisation === w,
        }
      : undefined;

  const periodenBereit = abrufZustand(periodenQuery) === 'daten';
  const dauernJePerson = new Map<number, KraftDauern>(
    (periodenQuery.data ?? []).map((p) => [p.personal_id, kraftDauern(p.perioden, uhr.valueOf())]),
  );
  /** Dauerzelle: leer ohne Daten, „—" ohne Ereignis (keine erfundene 0). */
  const dauerZelle = (minuten: number | null | undefined) =>
    periodenBereit ? (
      <span style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>
        {minuten == null ? '—' : dauerText(minuten)}
      </span>
    ) : null;

  /**
   * Spaltenregister der Personalliste (D7): Name | Funktion | Einheit | Fahrzeug | Position |
   * Status | Einsatzdauer, dazu Träger, Ruhe und Bemerkung im Spaltenschalter
   * (`spaltenAusVoreinstellung`). Durch `spaltenFuer<EinsatzPersonal>()` geführt, nicht annotiert.
   *
   * ── Einheit und Fahrzeug ohne `abBreite` ──
   *
   * Die Einteilung ist der Zweck der Liste am Fükw und am Führungs-Tablet; unter `xxl` verschwände
   * sie genau dort. Ohne Freigabe ihres Moduls entfällt die Spalte ganz, statt mit „—“ eine freie
   * Kraft zu behaupten (D3, D7).
   *
   * ── Gemessen gegen 1180 und 1440 (LFH-975) ──
   *
   * `name` fließt (`mindestBreite`, LFH-523), alle übrigen tragen eine Zahlbreite; so bricht
   * Langtext um, statt die Tabelle zu verbreitern. Einheit, Fahrzeug und Position sind so breit,
   * dass ihre Aufforderung („Fahrzeug eintragen“) in `kompakt` eine Zeile hält; ein langer
   * Einheitsname bricht um. Unter `xl` weicht `funktion`, über den Spaltenschalter und im Zähler.
   * Wer eine Breite ändert, misst neu (`e2e/gate1-ueberlauf.spec.ts`, „Kräfte-Listen“).
   */
  const spalten = spaltenFuer<EinsatzPersonal>()([
    {
      title: 'Name',
      key: 'name',
      immerSichtbar: true,
      mindestBreite: 180,
      sortWert: (ep) => ep.name,
      suchText: (ep) => ep.name,
      // Der Name ist `karte.titel.ziel` und führt in die Personenansicht (D8); das `render` trägt
      // deshalb keinen Anker. `wrap`: eine Marke darf unter einen langen Namen rutschen, statt die
      // Fließspalte über ihr Maß zu drücken (LFH-975).
      render: (_, ep) => (
        <Space wrap size={4}>
          {ep.name}
          {ep.ist_adhoc && <Tag>ad-hoc</Tag>}
          {ep.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    // Einsatzfunktion inline mit Vorschlägen, die Qualifikation sichtbar darunter (LLH-1067).
    // Sortiert wird nach der einen Funktionsangabe, gesucht in beiden.
    {
      title: 'Funktion',
      key: 'funktion',
      width: 140,
      abBreite: 'xl',
      sortWert: (ep) => funktionText(ep),
      suchText: (ep) => [ep.einsatzfunktion, ep.funktion].filter(Boolean).join(' '),
      render: (_, ep) => (
        <EinsatzfunktionZelle
          name={ep.name}
          einsatzfunktion={ep.einsatzfunktion}
          funktion={ep.funktion}
          vorschlaege={vorschlaege}
          darfSchreiben={darfSchreiben}
          onSpeichern={(einsatzfunktion) => schreiben.angabe(ep.id, { einsatzfunktion })}
        />
      ),
    },
    {
      title: 'Träger',
      dataIndex: 'traegerorganisation',
      key: 'traeger',
      width: 160,
      filter: traegerFilter,
      render: (t) => t ?? '—',
    },
    ...(einheitenFrei
      ? [
          {
            title: 'Einheit',
            key: 'einheit' as const,
            width: 150,
            sortWert: (ep: EinsatzPersonal) =>
              einheitOptionen.find((o) => o.id === ep.einheit_id)?.pfad ?? '',
            render: (_: unknown, ep: EinsatzPersonal) => (
              <EinheitAngabe
                kennung={ep.name}
                wert={ep.einheit_id ?? null}
                optionen={einheitOptionen}
                darfSchreiben={darfSchreiben}
                onSpeichern={schreiben.einheit(ep.id)}
              />
            ),
          },
        ]
      : []),
    ...(fahrzeugeFrei
      ? [
          {
            title: 'Fahrzeug',
            key: 'fahrzeug' as const,
            width: 150,
            sortWert: (ep: EinsatzPersonal) =>
              fahrzeuge.find((f) => f.id === ep.fahrzeug_id)?.funkrufname ?? '',
            render: (_: unknown, ep: EinsatzPersonal) => (
              <FahrzeugAngabe
                kennung={ep.name}
                wert={ep.fahrzeug_id ?? null}
                einheitId={ep.einheit_id ?? null}
                fahrzeuge={fahrzeuge}
                einheiten={einheiten}
                darfSchreiben={darfSchreiben}
                onSpeichern={schreiben.fahrzeug(ep.id)}
              />
            ),
          },
        ]
      : []),
    {
      title: 'Position',
      key: 'position',
      width: 140,
      render: (_, ep) => (
        <PositionAngabe
          kennung={ep.name}
          wert={ep.staerke_position ?? null}
          darfSchreiben={darfSchreiben}
          onSpeichern={(staerke_position) => schreiben.angabe(ep.id, { staerke_position })}
        />
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      // Gefiltert wird über die Kategorie, nicht über `status_id`: die ID kommt aus dem
      // Mandantenkatalog und passte nicht zu den Gruppen.
      filter: {
        werte: KATEGORIE_WERTE,
        trifft: (ep, w) => kategorieVon(ep.status_kategorie) === w,
      },
      // Kein `Select` mit Mindestbreite (die 390-px-Karte scheiterte daran). Deskriptor ganz
      // gespreizt — Herleitung in `FahrzeugePage.tsx`.
      render: (_, ep) => (
        <StatusWahl
          darstellung={personalStatusDarstellung(ep)}
          darfSchreiben={darfSchreiben}
          {...statusBedienungVon(ep)}
        />
      ),
    },
    // Einsatzwert im Lagevortrag (LFH-552): laufende Dauer bzw. Ruhe seit der letzten Periode.
    {
      title: 'Einsatzdauer',
      key: 'einsatzdauer',
      width: 104,
      render: (_, ep) => dauerZelle(dauernJePerson.get(ep.id)?.laufend?.minuten),
    },
    {
      title: 'Ruhe',
      key: 'ruhe',
      width: 88,
      render: (_, ep) => dauerZelle(dauernJePerson.get(ep.id)?.ruheMinuten),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      width: 200,
      render: (_, ep) => (
        <BemerkungZelle
          wert={ep.bemerkung}
          kennung={ep.name}
          darfSchreiben={darfSchreiben}
          max={PERSONAL_BEMERKUNG_MAX}
          // Die Zusage lässt die Zelle bis zur Antwort offen (`BemerkungZelle`, LFH-1077).
          onSpeichern={(val) => bemerkungMutation.mutateAsync({ epId: ep.id, bemerkung: val })}
        />
      ),
    },
  ]);

  /**
   * Höchstens drei Kartenfelder (`Datensicht`): die Einteilung zuerst; fehlt eine Spalte mangels
   * Freigabe, rückt die Funktion nach.
   */
  const kartenFelder = (
    [
      einheitenFrei ? 'einheit' : null,
      fahrzeugeFrei ? 'fahrzeug' : null,
      'position',
      'funktion',
    ] as const
  )
    .filter((k) => k != null)
    .slice(0, 3) as ['einheit' | 'fahrzeug' | 'position' | 'funktion'];

  return (
    <EinsatzSeite
      meta={epQuery.isSuccess ? `${eps.length} Kräfte` : undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        epQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        fahrzeugeQuery.dataUpdatedAt,
      )}
      titel={modulName('personal')}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('personal') },
          ]}
        />
      }
      // Der Kopf ÖFFNET nur (LFH-983): disponiert wird im Dialog, nie schon beim Auswählen.
      aktionen={
        darfSchreiben && (
          <Space wrap style={{ minWidth: 0 }}>
            <Button type="primary" onClick={() => setDisponierenOffen(true)}>
              Personal disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Person</Button>
          </Space>
        )
      }
      hinweis={
        !darfSchreiben && einsatz.status !== 'aktiv' ? (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        ) : null
      }
    >
      {/* Der Statuskatalog trägt die Auswahlliste jeder Statuszelle. Fällt er aus, wäre der
          Statuswechsel lautlos unmöglich; die Meldung steht deshalb über der Tabelle.

          An `darfSchreiben` gekoppelt: wer nur liest, sieht `StatusBadge` aus den Zeilendaten
          und verliert nichts. (Die Positionsangabe bleibt bedienbar — `POSITION_OPTIONEN` ist
          ein lokales Enum.) */}
      {darfSchreiben && statusQuery.isError && (
        <div style={{ marginBottom: abstand.md }}>
          <SeitenFehler
            text="Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich"
            ursache={statusQuery.error}
            onWiederholen={() => void statusQuery.refetch()}
          />
        </div>
      )}

      {/* Der Listenfehler tauscht die Datensicht aus: `Datensicht` führt den Kartenzweig an
          `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete
          „Noch kein Personal disponiert" eine leere Disposition, wenn bloß die Verbindung
          abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponiertes Personal konnte nicht geladen werden"
          ursache={epQuery.error}
          onWiederholen={() => void epQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void epQuery.refetch()} />}
          <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />
          {/* `zufluss` bleibt `sammelbanner`: Einheitswechsel, Status und Position sind Bedienziele
              der Zeile. Wechselt eine Person unter Fokus oder Zeiger die Einheit, hält die
              Schleuse Platz und Folge, bis beide die Sicht verlassen (D6). */}
          <Datensicht
            bezeichnung="Personal im Einsatz"
            spalten={spalten}
            daten={eps}
            zeilenSchluessel="id"
            ladend={epQuery.isLoading}
            leerText="Noch kein Personal disponiert"
            suche={{ platzhalter: 'Name, Funktion' }}
            standardSortierung={{ spalte: 'name', richtung: 'auf' }}
            spaltenAusVoreinstellung={['traeger', 'ruhe', 'bemerkung']}
            zeilenFehler={(p) => zeilen.grund(p.id)}
            gruppen={
              einheitGruppen
                ? {
                    ...einheitGruppen,
                    // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
                    unterEbene: 1,
                  }
                : undefined
            }
            zeilenKlasse={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
            karte={{
              art: 'plan',
              titel: { spalte: 'name', ziel: (ep) => einsatzkraftPfad(einsatzId, ep.id) },
              status: (ep) => personalStatusDarstellung(ep),
              statusBedienung: (ep) => (darfSchreiben ? statusBedienungVon(ep) : null),
              sekundaer: kartenFelder,
            }}
          />
          <EntlassenBlock
            titel="Entlassen"
            endeWort="entlassen"
            eintraege={entlassene.map((ep) => ({
              id: ep.id,
              name: ep.name,
              zusatz: funktionText(ep),
              beendetAt: ep.beendet_at,
            }))}
            ziel={(epId) => einsatzkraftPfad(einsatzId, epId)}
            aktion={
              darfSchreiben
                ? {
                    etikett: 'Erneut disponieren',
                    onKlick: (epId) => reaktivierenMutation.mutate(epId),
                    laeuft: (epId) =>
                      reaktivierenMutation.isPending && reaktivierenMutation.variables === epId,
                  }
                : undefined
            }
            fehler={(epId) => zeilen.grund(epId)}
          />
        </>
      )}

      {/* Personal aus dem Stamm disponieren: eine Gruppe in einem Absenden, optional in Einheit
          und Fahrzeug (LLH-1100), im Serienmodus wie die Ad-hoc-Kette. */}
      <PersonalDisponierenModal
        offen={disponierenOffen}
        einsatzId={einsatzId}
        serie
        onSchliessen={() => setDisponierenOffen(false)}
      />

      {/* Ad-hoc-Disposition mit Serienmodus: an der Bereitstellung wird eine Helferkette am
          Stück aufgenommen. Trägerorganisation und Stärke-Position überleben das Speichern,
          weil sie sich über eine Kette am seltensten ändern. Maske und Feldbudget liegen im
          Bauteil, das auch der Stab öffnet. */}
      <AdhocPersonModal
        offen={adhocOffen}
        einsatzId={einsatzId}
        serie
        onSchliessen={() => setAdhocOffen(false)}
      />
    </EinsatzSeite>
  );
}
