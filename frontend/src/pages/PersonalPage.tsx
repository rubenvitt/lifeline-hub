import { Alert, App, Breadcrumb, Button, Modal, Space, Tag } from 'antd';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { POSITION_LABELS, POSITION_OPTIONEN } from '../api/personal';
import { listePersonalStatus } from '../api/personalStatus';
import {
  updateDisposition,
  entlasseDisposition,
  listeEinsatzPersonal,
  listEntlassenesPersonal,
  reaktiviereDisposition,
  storniereDisposition,
} from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { kraefteuebersichtPfad, einheitenPfad, fahrzeugePfad } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import KraftZeitachse from '../kraefte/KraftZeitachse';
import { dauerText, kraftDauern, type KraftDauern } from '../kraefte/zeitachse';
import { listePersonalPerioden } from '../api/kraefteZeitachse';
import { abrufZustand } from '../api/abrufZustand';
import { useUhr } from '../abloesung/useUhr';
import { monoStil } from '../components/instrument';
import AdhocPersonModal from '../kraefte/AdhocPersonModal';
import PersonalDisponierenModal from '../kraefte/PersonalDisponierenModal';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzPersonal, StaerkePosition } from '../api/types';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import Datensicht, { scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import {
  KATEGORIE_REIHENFOLGE,
  KATEGORIE_WERTE,
  kategorieEtikett,
  kategorieVon,
} from '../kraefte/statusAchse';
import { statusKategorie } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import DemoMarke from '../components/DemoMarke';
import { personalStatusDarstellung } from '../kraefte/mittelStatus';
import { useZeilenFehler } from '../components/useZeilenFehler';
import {
  katalogStatusWechsel,
  useOptimistischesZeilenUpdate,
} from '../kraefte/useOptimistischesZeilenUpdate';
import { KennungsLink } from '../components/kennungsLink';
import { modulName } from '../einsatz/modulRegistry';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import { useNewGesture } from './einsatzabschnitte/useNewGesture';

export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [disponierenOffen, setDisponierenOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  /** Offene Rückfrage „Stornieren“ (LLH-1079): als `<Modal>` außerhalb der Zeilen-`map`. */
  const [stornoFuer, setStornoFuer] = useState<{ id: number; name: string } | null>(null);
  const isNewGestureStorno = useNewGesture(stornoFuer !== null);

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
  // Struktur-Listen zum Auflösen von einheit_id/fahrzeug_id → Klartext-Label (Gegenrichtung zur
  // Fahrzeugseite).
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  // Kräfte-Zeitachse (LFH-552): Perioden je Person für „Einsatzdauer" und „Ruhe". Scheitert der
  // Abruf, bleiben die Zellen leer — ein „—" behauptete sonst „keine Ereignisse".
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachsePersonal(einsatzId),
    queryFn: () => listePersonalPerioden(einsatzId),
  });
  const uhr = useUhr(60_000);

  // Cross-Modul-Deeplink ?personal=<id> hebt die Zeile hervor und scrollt sie ins Bild
  // (best-effort).
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
  // Ablehnungen an der Zeile, je Disposition gemerkt; alle Zeilenaktionen teilen den Speicher, die
  // zuletzt begonnene zählt (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077). Der Dialog
  // zeigt seinen Fehler über `speicherung` selbst.
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
  const positionMutation = useMutation({
    mutationFn: (v: { epId: number; position: StaerkePosition | null }) =>
      updateDisposition(einsatzId, v.epId, { staerke_position: v.position }),
    onMutate: (v) => zeilen.beginne(v.epId),
    onSuccess: invalidate,
    onError: (e, v) => zeilen.melde(v.epId, e, 'Position nicht gespeichert'),
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { epId: number; bemerkung: string }) =>
      updateDisposition(einsatzId, v.epId, { bemerkung: v.bemerkung }),
    onMutate: (v) => zeilen.beginne(v.epId),
    onSuccess: invalidate,
    onError: (e, v) => zeilen.melde(v.epId, e, 'Bemerkung nicht gespeichert'),
  });
  /*
   * Erneut disponieren (LLH-1079) hat zwei Wege mit je eigenem Fehlerort (`frontend/AGENTS.md`,
   * „Rückwege und Fehler“): die Aktion im Block „Entlassen“ meldet an ihrem Eintrag, Rückgängig
   * aus dem Toast im Seitenhinweis — die Zeile ist dann weg, der Block meist eingeklappt.
   */
  const reaktivierenMutation = useMutation({
    mutationFn: (epId: number) => reaktiviereDisposition(einsatzId, epId),
    onMutate: (epId) => zeilen.beginne(epId),
    onSuccess: invalidate,
    onError: (e, epId) => zeilen.melde(epId, e, 'Nicht erneut disponiert'),
  });
  const [rueckgaengigFehler, setRueckgaengigFehler] = useState<unknown>(null);
  // Die nächste Rücknahme aus dem Toast räumt den Grund der vorigen.
  const rueckgaengigMutation = useMutation({
    mutationFn: (epId: number) => reaktiviereDisposition(einsatzId, epId),
    onMutate: () => setRueckgaengigFehler(null),
    onSuccess: invalidate,
    onError: (e) => {
      setRueckgaengigFehler(e);
      invalidate();
    },
  });
  // Entlassen ist umkehrbar: keine Rückfrage, sondern ein Rückgängig-Toast (`frontend/AGENTS.md`,
  // „Destruktiv ist nicht gleich destruktiv“, design.md D8).
  const entlassenMutation = useMutation({
    mutationFn: (v: { epId: number; name: string }) => entlasseDisposition(einsatzId, v.epId),
    onMutate: (v) => zeilen.beginne(v.epId),
    onSuccess: (_, v) => {
      invalidate();
      zeigeRueckgaengig(message, `${v.name} entlassen`, () => rueckgaengigMutation.mutate(v.epId));
    },
    onError: (e, v) => zeilen.melde(v.epId, e, 'Nicht entlassen'),
  });
  // Stornieren ist unumkehrbar und nur kurz nach einer Fehldisposition möglich; der Server nennt
  // den Grund einer Ablehnung, er steht an der Zeile.
  const stornierenMutation = useMutation({
    mutationFn: (epId: number) => storniereDisposition(einsatzId, epId),
    onMutate: (epId) => zeilen.beginne(epId),
    onSuccess: invalidate,
    onError: (e, epId) => zeilen.melde(epId, e, 'Nicht storniert'),
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
  /** Läuft für diese Zeile Entlassen oder Stornieren? Dann keine zweite Handlung. */
  const isZeileBusy = (epId: number) =>
    (entlassenMutation.isPending && entlassenMutation.variables?.epId === epId) ||
    (stornierenMutation.isPending && stornierenMutation.variables === epId);
  const stornoEintraege = [{ key: 'stornieren', label: 'Stornieren', gefahr: true as const }];

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

  const einheitById = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e] as const));
  const fahrzeugById = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f] as const));
  const stati = statusQuery.data ?? [];

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

  /**
   * Spaltenregister der Personalseite — die breiteste Fläche (9 Spalten) und damit der erste
   * Adressat des Spaltenschalters. Durch `spaltenFuer<EinsatzPersonal>()` geführt, nicht annotiert.
   *
   * ── Kein `abBreite` auf `position` ──
   *
   * antds `xl` liegt bei 1200 px; auf dem Führungs-Tablet (1024–1280 px) verschwände die Spalte
   * genau dort, wo sie gebraucht wird. `position` ist eine von zwei Schreib-Bedienungen, und es
   * gibt keine Detailroute als Ausweichort. Wer sie weghaben will, nimmt
   * `spaltenAusVoreinstellung`; dann steht sie im Schalter und im Zähler.
   *
   * ── Gemessen gegen 1180 und 1440 (LFH-975) ──
   *
   * `name` fließt (`mindestBreite`, LFH-523), alle übrigen tragen eine Zahlbreite; so bricht
   * Langtext um, statt die Tabelle zu verbreitern, und „Ruhe“ und die Aktionen bleiben im Bild.
   * Unter `xl` weicht `funktion`, unter `xxl` weichen `traeger`, `fahrzeug` und `einheit` — alle
   * über den Spaltenschalter und im Zähler. Wer eine Breite ändert, misst neu
   * (`e2e/gate1-ueberlauf.spec.ts`, „Kräfte-Listen“): neben dem Aufklapp-Auslöser braucht die
   * Kennung bei 1440 rund 250 px, sonst rutscht „Zeitachse“ in eine zweite Zeile.
   */
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

  const spalten = spaltenFuer<EinsatzPersonal>()([
    {
      title: 'Name',
      key: 'name',
      immerSichtbar: true,
      mindestBreite: 180,
      sortWert: (ep) => ep.name,
      suchText: (ep) => ep.name,
      // Der Deeplink der Fahrzeug-/Einheitsspalte wandert nicht hierher: nur die Titelspalte dürfte
      // `titel.ziel` tragen, und `personalPfad` zeigte auf diese Seite.
      // `wrap`: neben dem Aufklapp-Auslöser darf die Marke unter den Namen rutschen, statt die
      // Fließspalte über ihr Maß zu drücken (LFH-975).
      render: (_, ep) => (
        <Space wrap>
          {ep.name}
          {ep.ist_adhoc && <Tag>ad-hoc</Tag>}
          {ep.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    {
      title: 'Funktion',
      dataIndex: 'funktion',
      key: 'funktion',
      width: 140,
      abBreite: 'xl',
      sortWert: (ep) => ep.funktion,
      suchText: (ep) => ep.funktion,
      render: (t) => t ?? '—',
    },
    {
      title: 'Träger',
      dataIndex: 'traegerorganisation',
      key: 'traeger',
      width: 160,
      abBreite: 'xxl',
      filter: traegerFilter,
      render: (t) => t ?? '—',
    },
    {
      title: 'Fahrzeug',
      key: 'fahrzeug',
      width: 160,
      abBreite: 'xxl',
      render: (_, ep) => {
        const f = ep.fahrzeug_id != null ? fahrzeugById.get(ep.fahrzeug_id) : undefined;
        if (!f) return '—';
        const label = f.kennzeichen ? `${f.funkrufname} (${f.kennzeichen})` : f.funkrufname;
        return (
          <KennungsLink to={fahrzeugePfad(einsatzId, { fahrzeug: f.id })}>{label}</KennungsLink>
        );
      },
    },
    {
      title: 'Einheit',
      key: 'einheit',
      width: 140,
      abBreite: 'xxl',
      render: (_, ep) => {
        const e = ep.einheit_id != null ? einheitById.get(ep.einheit_id) : undefined;
        if (!e) return '—';
        return (
          <KennungsLink to={einheitenPfad(einsatzId, { einheit: e.id })}>{e.name}</KennungsLink>
        );
      },
    },
    {
      title: 'Position',
      key: 'position',
      width: 150,
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            style={{ minWidth: 130 }}
            value={ep.staerke_position ?? undefined}
            placeholder="—"
            allowClear
            options={POSITION_OPTIONEN}
            onChange={(position) =>
              positionMutation.mutate({ epId: ep.id, position: position ?? null })
            }
          />
        ) : ep.staerke_position ? (
          POSITION_LABELS[ep.staerke_position]
        ) : (
          '—'
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
          // Die Zusage lässt die Zelle bis zur Antwort offen (`BemerkungZelle`, LFH-1077).
          onSpeichern={(val) => bemerkungMutation.mutateAsync({ epId: ep.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            width: 170,
            immerSichtbar: true,
            // Entlassen ist umkehrbar: `danger` mit Abstand, keine Rückfrage; Stornieren steht im
            // Zeilenmenü und fragt nach (LLH-1079, design.md D8).
            render: (_: unknown, ep: EinsatzPersonal) => (
              <Space size="middle">
                <Button
                  danger
                  loading={
                    entlassenMutation.isPending && entlassenMutation.variables?.epId === ep.id
                  }
                  disabled={isZeileBusy(ep.id)}
                  aria-label={`${ep.name} entlassen`}
                  onClick={() => entlassenMutation.mutate({ epId: ep.id, name: ep.name })}
                >
                  Entlassen
                </Button>
                <MenueAusloeser
                  eintraege={stornoEintraege}
                  zugaenglicherName={`Weitere Aktionen zu ${ep.name}`}
                  gesperrt={isZeileBusy(ep.id)}
                  laeuft={stornierenMutation.isPending && stornierenMutation.variables === ep.id}
                  onWahl={() => setStornoFuer({ id: ep.id, name: ep.name })}
                />
              </Space>
            ),
          },
        ]
      : []),
  ]);

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
        (!darfSchreiben && einsatz.status !== 'aktiv') || rueckgaengigFehler != null ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {!darfSchreiben && einsatz.status !== 'aktiv' && (
              <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
            )}
            <SeitenHinweise
              fehler={rueckgaengigFehler}
              fehlerTitel="Nicht erneut disponiert"
              fehlerFallback="Rückgängig fehlgeschlagen"
            />
          </Space>
        ) : null
      }
    >
      {/* `titel` ohne `ziel`: `personalPfad` ist eine Query-Param-Selektion auf diese Seite,
          der Link zeigte auf sich selbst und machte die Namenszelle zum Link. Die echten
          Fremd-Links (Fahrzeug, Einheit) bleiben in ihren Zellen.

          `zufluss` bleibt `sammelbanner`: zwei Auswahlfelder in der Zeile (Position, Status),
          eigener wie fremder Wechsel läuft über eine Invalidierung. */}

      {/* Der Statuskatalog trägt die Auswahlliste jeder Statuszelle. Fällt er aus, wäre der
          Statuswechsel lautlos unmöglich; die Meldung steht deshalb über der Tabelle.

          An `darfSchreiben` gekoppelt: wer nur liest, sieht `StatusBadge` aus den Zeilendaten
          und verliert nichts. (Die Positionsspalte bleibt bedienbar — `POSITION_OPTIONEN` ist
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
          <Datensicht
            bezeichnung="Personal im Einsatz"
            spalten={spalten}
            daten={eps}
            zeilenSchluessel="id"
            ladend={epQuery.isLoading}
            leerText="Noch kein Personal disponiert"
            suche={{ platzhalter: 'Name, Funktion' }}
            standardSortierung={{ spalte: 'name', richtung: 'auf' }}
            spaltenAusVoreinstellung={['bemerkung']}
            zeilenFehler={(p) => zeilen.grund(p.id)}
            gruppen={{
              schluessel: (ep) => kategorieVon(ep.status_kategorie),
              etikett: kategorieEtikett,
              reihenfolge: KATEGORIE_REIHENFOLGE,
              // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
              unterEbene: 1,
            }}
            zeilenKlasse={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
            // Zeitachse der Person (LFH-552) ohne Seitenwechsel — Inline-Expander statt Drawer.
            aufklappen={{
              etikett: 'Zeitachse',
              zugaenglicherName: (ep) => `Zeitachse zu ${ep.name}`,
              inhalt: (ep) => (
                <KraftZeitachse
                  einsatzId={einsatzId}
                  art="person"
                  id={ep.id}
                  kennung={ep.name}
                  darfSchreiben={darfSchreiben}
                />
              ),
            }}
            karte={{
              art: 'plan',
              titel: { spalte: 'name' },
              status: (ep) => personalStatusDarstellung(ep),
              // Der Bedienweg sitzt am Status-, nicht am Aktions-Slot: der ist mit „Entlassen"
              // belegt, und `Datensicht` sichert genau eine Primäraktion zu.
              statusBedienung: (ep) => (darfSchreiben ? statusBedienungVon(ep) : null),
              sekundaer: ['funktion', 'einheit', 'fahrzeug'],
              aktion: darfSchreiben
                ? {
                    etikett: 'Entlassen',
                    zugaenglicherName: (ep) => `${ep.name} entlassen`,
                    onKlick: (ep) => entlassenMutation.mutate({ epId: ep.id, name: ep.name }),
                  }
                : undefined,
              weitere: darfSchreiben
                ? {
                    eintraege: () => stornoEintraege,
                    zugaenglicherName: (ep) => `Weitere Aktionen zu ${ep.name}`,
                    laeuft: (ep) => isZeileBusy(ep.id),
                    onWahl: (_, ep) => setStornoFuer({ id: ep.id, name: ep.name }),
                  }
                : undefined,
            }}
          />
          <EntlassenBlock
            titel="Entlassen"
            endeWort="entlassen"
            eintraege={entlassene.map((ep) => ({
              id: ep.id,
              name: ep.name,
              zusatz: ep.funktion,
              beendetAt: ep.beendet_at,
            }))}
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

      {/* Die Rückfrage vor dem Unumkehrbaren steht als `<Modal>`, nicht im Menü (LFH-683). Sie
          nennt ihre Person und schließt, wenn die Zeile entfällt. */}
      <Modal
        open={stornoFuer !== null && eps.some((ep) => ep.id === stornoFuer.id)}
        title={stornoFuer ? `${stornoFuer.name} stornieren?` : undefined}
        onCancel={() => {
          if (isNewGestureStorno()) setStornoFuer(null);
        }}
        destroyOnHidden
        footer={
          <Space size="middle">
            <Button
              onClick={() => {
                if (isNewGestureStorno()) setStornoFuer(null);
              }}
            >
              Abbrechen
            </Button>
            <Button
              danger
              onClick={() => {
                if (!stornoFuer || !isNewGestureStorno()) return;
                setStornoFuer(null);
                stornierenMutation.mutate(stornoFuer.id);
              }}
            >
              Stornieren
            </Button>
          </Space>
        }
      >
        Die Person erscheint danach in keiner Liste und keinem Nachweis.
      </Modal>

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
