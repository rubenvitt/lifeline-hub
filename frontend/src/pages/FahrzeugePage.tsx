import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Collapse,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  aktualisiereDisposition,
  disponiereAdhoc,
  disponiereFahrzeug,
  entferneDisposition,
  gibBesatzungFrei,
  listeEinsatzFahrzeuge,
  ordneBesatzungZu,
  type AdhocEingabe,
} from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug, EinsatzPersonal, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import EinsatzSeite from '../components/EinsatzSeite';
import { monoStil, Segmentleiste } from '../components/instrument';
import {
  kraefteuebersichtPfad,
  parseFahrzeugeAnsicht,
  type FahrzeugeAnsicht,
} from '../routing/deeplinks';
import { listeEinheiten } from '../api/einheiten';
import FmsTableau from '../kraefte/FmsTableau';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import Datensicht, { scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import { ErfassungsModal } from '../components/Erfassung';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import {
  KATEGORIE_REIHENFOLGE,
  KATEGORIE_WERTE,
  kategorieEtikett,
  kategorieVon,
} from '../kraefte/statusAchse';
import { einsatzStatus, statusKategorie } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import StatusTag from '../components/StatusTag';
import DemoMarke from '../components/DemoMarke';
import { demoGruppierteOptionen } from '../stammdaten/demoAuswahl';
import { fahrzeugStatusDarstellung } from '../kraefte/mittelStatus';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import {
  katalogStatusWechsel,
  useOptimistischesZeilenUpdate,
} from '../kraefte/useOptimistischesZeilenUpdate';

/**
 * Ist-Besatzungsstärke aus den Stärke-Positionen der zugeordneten Kräfte, clientseitig gezählt und
 * bewusst orthogonal zur Einheiten-Stärke. Eine Kraft ohne F/UF-Position ist trotzdem auf dem
 * Fahrzeug und zählt als Mannschaft (Sammeltopf), sodass Σ die tatsächliche Kopfzahl bleibt.
 */
function istBesatzungsStaerke(crew: EinsatzPersonal[]): Staerke {
  const s: Staerke = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };
  for (const m of crew) {
    if (m.staerke_position === 'fuehrer') s.fuehrer += 1;
    else if (m.staerke_position === 'unterfuehrer') s.unterfuehrer += 1;
    else s.mannschaft += 1;
  }
  return s;
}

/** Soll gilt als erfüllt, wenn Ist in JEDER Position (F/UF/M) ≥ Soll ist (Überbesetzung zählt mit). */
function istSollErfuellt(ist: Staerke, soll: Staerke): boolean {
  return (
    ist.fuehrer >= soll.fuehrer &&
    ist.unterfuehrer >= soll.unterfuehrer &&
    ist.mannschaft >= soll.mannschaft
  );
}

/**
 * Besatzungs-Ist als Ampel-Badge: neutral ohne hinterlegtes Soll (kein Urteil möglich; kein
 * Blau, weil Blau bedient, LFH-891), grün bei erfülltem Soll (nur Ist), sonst rot mit Soll in
 * Klammern. Die Klammer ist zugleich das nicht-farbliche Signal für Unterbesetzung, `title`
 * ergänzt grün/neutral.
 */
function BesatzungsStaerkeBadge({ ist, soll }: { ist: Staerke; soll: Staerke | null }) {
  if (!soll) {
    return (
      <Tag title="kein Soll hinterlegt">
        <StaerkeAnzeige wert={ist} />
      </Tag>
    );
  }
  if (istSollErfuellt(ist, soll)) {
    return (
      <Tag color="green" title="Soll erfüllt">
        <StaerkeAnzeige wert={ist} />
      </Tag>
    );
  }
  return (
    <Tag color="red" title="unterbesetzt">
      <StaerkeAnzeige wert={ist} /> (Soll <StaerkeAnzeige wert={soll} />)
    </Tag>
  );
}

/**
 * Besatzungs-Block je disponiertem Fahrzeug: Mitglieder (über `fahrzeug_id`), Ist/Soll als
 * `Staerke`, Frei-Pool-Picker (nur `fahrzeug_id == null`). Eine Kraft in einer anderen Einheit als
 * das Fahrzeug wird markiert.
 */
function BesatzungsBlock({
  ef,
  personal,
  darfSchreiben,
  freiInhalt,
  onZuordnen,
  onFreigeben,
}: {
  ef: EinsatzFahrzeug;
  personal: EinsatzPersonal[];
  darfSchreiben: boolean;
  /**
   * Text des Frei-Pools, wenn er nichts anzubieten hat — vom Aufrufer entschieden, weil nur dort
   * bekannt ist, ob die Personalliste ankam. Der Block zeigt den Zustand an und urteilt nicht über
   * ihn.
   */
  freiInhalt: string;
  onZuordnen: (epId: number) => void;
  onFreigeben: (epId: number) => void;
}) {
  const crew = personal.filter((p) => p.fahrzeug_id === ef.id);
  const frei = personal.filter((p) => p.fahrzeug_id == null);
  const ist = istBesatzungsStaerke(crew);
  return (
    <div style={{ paddingLeft: 8 }}>
      <Space size={abstand.sm} style={{ marginBottom: abstand.sm }}>
        <Typography.Text type="secondary">Besatzung</Typography.Text>
        <BesatzungsStaerkeBadge ist={ist} soll={ef.soll_besatzung ?? null} />
      </Space>
      {crew.length === 0 ? (
        <div>
          <Typography.Text type="secondary">Keine Besatzung zugeordnet</Typography.Text>
        </div>
      ) : (
        crew.map((m) => (
          <Space
            key={m.id}
            style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 420 }}
          >
            <Space size={abstand.sm}>
              <span>
                {m.name}
                {m.staerke_position ? ` (${m.staerke_position})` : ''}
              </span>
              {m.einheit_id != null && m.einheit_id !== ef.einheit_id && (
                <Tag color="orange" style={{ margin: 0 }}>
                  andere Einheit
                </Tag>
              )}
            </Space>
            {darfSchreiben && (
              <Button danger onClick={() => onFreigeben(m.id)}>
                Freigeben
              </Button>
            )}
          </Space>
        ))
      )}
      {darfSchreiben && (
        <Select
          style={{ width: '100%', maxWidth: 420, marginTop: 8 }}
          placeholder="Kraft zur Besatzung …"
          value={null}
          notFoundContent={freiInhalt}
          options={frei.map((p) => ({ value: p.id, label: p.name }))}
          onSelect={(epId) => onZuordnen(Number(epId))}
        />
      )}
    </div>
  );
}

/**
 * Zwei Ansichten derselben Menge (LFH-642): die Tabelle zum Pflegen und Vergleichen, das
 * FMS-Tableau als Überblicksfläche mit Statuswahl. Beide lesen dieselbe Query und bedienen dieselbe
 * `statusMutation` — das Tableau ist kein zweites Modul.
 */
const ANSICHT_OPTIONEN = [
  { wert: 'liste', label: 'Liste' },
  { wert: 'tableau', label: 'FMS-Tableau' },
] as const satisfies readonly { wert: FahrzeugeAnsicht; label: string }[];

export default function FahrzeugePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [form] = Form.useForm<AdhocEingabe>();
  // Je Einsatz, damit ein Einsatzwechsel in derselben Instanz nicht die Ansicht des vorigen
  // mitnimmt (Muster `PersonenPage`).
  const [ansichtNachEinsatz, setAnsichtNachEinsatz] = useState<Record<number, FahrzeugeAnsicht>>(
    {},
  );
  const ansicht = ansichtNachEinsatz[einsatzId] ?? 'liste';
  const setzeAnsicht = (a: FahrzeugeAnsicht) =>
    setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: a }));

  // Sichtvorgabe ?ansicht= (Sprungmarke „FMS-Tableau"), apply-then-clean. Geräumt wird auch ein
  // unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag. Über den Setter
  // direkt (stabil, `setzeAnsicht` ist je Render neu). Geklont statt in-place gelöscht:
  // `?fahrzeug=` räumt `useQueryParamSelektion` getrennt und später.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!searchParams.has('ansicht')) return;
    const vorgabe = parseFahrzeugeAnsicht(searchParams);
    if (vorgabe) setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: vorgabe }));
    const rest = new URLSearchParams(searchParams);
    rest.delete('ansicht');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, einsatzId]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const efQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const statusQuery = useQuery({
    queryKey: globalKeys.fahrzeugStatus(),
    queryFn: listeFahrzeugStatus,
  });
  const poolQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('im-dienst'),
    queryFn: () => listeFahrzeuge(true),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  // Nur das Tableau gliedert nach Einheit/Abschnitt. Die Route hängt am Modul `einheiten`, nicht an
  // `fahrzeuge` — ist es gesperrt, läuft das Tableau ungegliedert weiter.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: ansicht === 'tableau',
  });

  // Cross-Modul-Deeplink ?fahrzeug=<id> hebt die Zeile hervor (Scroll best-effort). Im Tableau gibt
  // es keine Zeile, `scrolleZurZeile` liefe still ins Leere; der Deeplink schaltet deshalb auf die
  // Liste.
  useQueryParamSelektion('fahrzeug', efQuery.isSuccess, (fid) => {
    if (!(efQuery.data ?? []).some((f) => f.id === fid)) return;
    setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'liste' }));
    setHighlightId(fid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    scrolleZurZeile(highlightId);
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = useFehlerMeldung();

  const disponiereMutation = useMutation({
    mutationFn: (fahrzeugId: number) => disponiereFahrzeug(einsatzId, fahrzeugId),
    onSuccess: () => {
      message.success('Fahrzeug disponiert');
      invalidate();
    },
    onError: fehler,
  });
  // Schließen und Leeren gehören der Erfassungshülle: sie schließt über `onFertig` (nur beim
  // Einzel-Erfassen) und setzt auf beiden Wegen zurück. Ein Reset hier wäre doppelt und im
  // Serienmodus falsch, weil er die übernommenen Werte mitlöschte.
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: invalidate,
    onError: fehler,
  });
  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzFahrzeug,
    { efId: number; statusId: number }
  >({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    mutationFn: (v) => aktualisiereDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    zeilenId: (v) => v.efId,
    ...katalogStatusWechsel<EinsatzFahrzeug>(statusQuery.data),
    // Der Einheitenstatus ist aus den Fahrzeugen abgeleitet — nicht auf das Live-Ereignis warten,
    // das ohne Stream (offline, Proxy) nie käme.
    onErfolg: () => void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
    onFehler: fehler,
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { efId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.efId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (efId: number) => entferneDisposition(einsatzId, efId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const besatzungZuMutation = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => ordneBesatzungZu(einsatzId, v.efId, v.epId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const besatzungFreiMutation = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => gibBesatzungFrei(einsatzId, v.efId, v.epId),
    onSuccess: invalidate,
    onError: fehler,
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const efs = efQuery.data ?? [];

  /**
   * Listenzustand — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im Zwischenspeicher
   * tritt der Fehler an die Stelle der Datensicht, sonst behauptete „Noch keine Fahrzeuge
   * disponiert" eine leere Disposition. Mit Zeilen bleiben sie stehen und bekommen ein Banner:
   * echt, nur womöglich alt.
   *
   * Gemessen an `efs`, der ungefilterten Menge: Suche, Trägerfilter und Gruppenachse leben im
   * Primitiv; an ihrer Restmenge gemessen kippte die Seite bei jedem engen Filter in den
   * Fehlerzweig und nähme die Schalter, um ihn wieder aufzumachen.
   *
   * Nicht zu verwechseln mit dem Statuskatalog-Banner weiter unten: das steht zusätzlich über der
   * Tabelle und tauscht nichts aus.
   */
  const listeGescheitert = efQuery.isError && efs.length === 0;
  const standVeraltet = efQuery.isError && efs.length > 0;

  const stati = statusQuery.data ?? [];
  const personal = personalQuery.data ?? [];

  /**
   * Der Katalog als Menüwerte — einmal gebaut, von beiden Zweigen gelesen. Der Fahrzeugkatalog ist
   * mandantengepflegt (FMS 0–9 ist der Seed, nicht die Obergrenze), deshalb kommen Beschriftung,
   * Kategorie und Farbe aus der Antwort. `fms_anker` bleibt Sortierachse und ist keine Bedienform:
   * die Spalte ist nullable, ein Ziffernfeld darauf hätte Löcher.
   */
  const statusOptionen: StatusOption<number>[] = stati.map((s) => ({
    wert: s.id,
    label: s.label,
    darstellung: s.kategorie ? statusKategorie[s.kategorie] : undefined,
    farbe: s.farbe,
  }));

  /**
   * Der gemeinsame Bedienweg für Tabellen- und Kartenzweig; zwei Formen für dieselbe Handlung
   * liefen beim Umstellen einer der Stellen auseinander.
   *
   * `aktuell` zeigt während der Mutation den angefragten Wert: der Zeilendatensatz trägt ihn durch
   * das optimistische `setQueryData` schon, der Riegel hält die Anzeige aber auch stabil, wenn ein
   * Refetch dazwischenfunkt.
   */
  const statusBedienungVon = (ef: EinsatzFahrzeug) => {
    const laeuft = statusMutation.isPending && statusMutation.variables?.efId === ef.id;
    return {
      optionen: statusOptionen,
      aktuell: laeuft ? statusMutation.variables?.statusId : ef.status_id,
      farbe: ef.status_farbe,
      kennung: ef.funkrufname,
      laeuft,
      // Sichtbar gesperrt, solange irgendwo eine Statusmutation läuft — der Riegel in `onWaehlen`
      // wirkt ohnehin, aber ein Auslöser, der klickbar aussieht und nichts tut, ist schlechter als
      // ein gesperrter.
      gesperrt: statusMutation.isPending,
      onWaehlen: (wert: string | number) => {
        if (!statusMutation.isPending)
          statusMutation.mutate({ efId: ef.id, statusId: Number(wert) });
      },
    };
  };
  const disponierteIds = new Set(
    efs.map((e) => e.fahrzeug_id).filter((x): x is number => x != null),
  );
  // LFH-733: Demo-Stammdaten bleiben wählbar, stehen aber als Gruppe hinter den echten.
  const poolOptionen = demoGruppierteOptionen(
    (poolQuery.data ?? []).filter((f) => !disponierteIds.has(f.id)),
    (f) => `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}`,
  );

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, ob die Liste ankam. Scheitert der Abruf,
   * filtert der Ausdruck darüber auf die leere Menge, und das Feld behauptete „Keine freien
   * Fahrzeuge". `nichtGefundenInhalt` liefert nur im Fehlerfall einen Text, sonst bleibt der
   * Bestandswortlaut.
   *
   * Kein `kein403`: die Fahrzeug- und Personal-Routen sind org-lesbar ohne Admin-Schranke. Ein „nur
   * für Admins" am Fahrzeug-Pool wäre ein erfundener Fehlerfall.
   */
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, {
      allgemein: 'Fahrzeugliste konnte nicht geladen werden',
    }) ?? 'Keine freien Fahrzeuge';
  const besatzungInhalt =
    nichtGefundenInhalt(personalQuery, {
      allgemein: 'Kräfte konnten nicht geladen werden',
    }) ?? 'Keine freien Kräfte';

  /**
   * Trägerfilter aus den eigenen Daten (Muster der Kräfteübersicht). `undefined`, wenn kein
   * Fahrzeug eine Trägerorganisation trägt — ein Filterfeld ohne Optionen wäre Rauschen. Folge: das
   * Feld erscheint erst mit dem ersten gepflegten Wert, nach dem Laden, mit kleiner Verschiebung in
   * der umbrechenden Werkzeugzeile. Gewollt: ein dauerhaft leeres Filterfeld sieht wie ein Werkzeug
   * aus und ist keins.
   */
  const traegerWerte = [
    ...new Set(efs.map((e) => e.traegerorganisation).filter((t): t is string => !!t)),
  ]
    .sort()
    .map((t) => ({ text: t, value: t }));
  const traegerFilter =
    traegerWerte.length > 0
      ? {
          werte: traegerWerte,
          trifft: (e: EinsatzFahrzeug, w: string) => e.traegerorganisation === w,
        }
      : undefined;

  /**
   * Spaltenregister der Fahrzeugseite, durch `spaltenFuer<EinsatzFahrzeug>()` geführt und nicht
   * annotiert: eine Annotation weitete die Schlüsselliterale auf `string`, und der Kartenplan nähme
   * jeden Tippfehler an.
   *
   * ── `abBreite` nur für lesende Spalten ──
   *
   * `abBreite` versteckt eine Spalte, ohne dass der Nutzer sie zurückholen kann. Schreibtragende
   * Spalten (`status`, `bemerkung`, `aktionen`) bekommen deshalb nie eins; soll eine weichen, dann
   * über `spaltenAusVoreinstellung` — dann steht sie im Spaltenschalter und im Zähler.
   */
  const spalten = spaltenFuer<EinsatzFahrzeug>()([
    {
      title: 'Funkrufname',
      key: 'funkrufname',
      immerSichtbar: true,
      sortWert: (ef) => ef.funkrufname,
      suchText: (ef) => ef.funkrufname,
      render: (_, ef) => (
        <Space>
          {/* Funkrufname in Mono. */}
          <span style={monoStil(13)}>{ef.funkrufname}</span>
          {ef.ist_adhoc && <Tag>ad-hoc</Tag>}
          {ef.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    {
      title: 'Typ',
      dataIndex: 'fahrzeugtyp',
      key: 'typ',
      sortWert: (ef) => ef.fahrzeugtyp,
      suchText: (ef) => ef.fahrzeugtyp,
      render: (t) => t ?? '—',
    },
    {
      title: 'Kennzeichen',
      dataIndex: 'kennzeichen',
      key: 'kennzeichen',
      abBreite: 'lg',
      suchText: (ef) => ef.kennzeichen,
      render: (t) => t ?? '—',
    },
    {
      title: 'Träger',
      dataIndex: 'traegerorganisation',
      key: 'traeger',
      filter: traegerFilter,
      render: (t) => t ?? '—',
    },
    {
      title: 'Status',
      key: 'status',
      // Gefiltert wird über die Kategorie, nicht über `status_id`: die ID kommt aus dem
      // Mandantenkatalog und stimmte nicht mit den Gruppen derselben Achse überein.
      filter: {
        werte: KATEGORIE_WERTE,
        trifft: (ef, w) => kategorieVon(ef.status_kategorie) === w,
      },
      // Der Auslöser ist das Etikett, das Menü liegt im Portal — kein `Select`, dessen
      // Mindestbreite die 390-px-Karte sprengte. Der Deskriptor wird ganz gespreizt: würden
      // `optionen` und `onWaehlen` hier eigens gesetzt, könnten Tabelle und Karte unbemerkt
      // auseinanderlaufen.
      render: (_, ef) => (
        <StatusWahl
          darstellung={fahrzeugStatusDarstellung(ef)}
          darfSchreiben={darfSchreiben}
          {...statusBedienungVon(ef)}
        />
      ),
    },
    {
      title: 'Besatzung',
      key: 'besatzung',
      render: (_, ef) => (
        <BesatzungsStaerkeBadge
          ist={istBesatzungsStaerke(personal.filter((p) => p.fahrzeug_id === ef.id))}
          soll={ef.soll_besatzung ?? null}
        />
      ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ef) => (
        <BemerkungZelle
          wert={ef.bemerkung}
          kennung={ef.funkrufname}
          darfSchreiben={darfSchreiben}
          onSpeichern={(val) => bemerkungMutation.mutate({ efId: ef.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, ef: EinsatzFahrzeug) => (
              <Popconfirm
                title="Aus Einsatz entfernen?"
                onConfirm={() => entfernenMutation.mutate(ef.id)}
              >
                {/* Kein `danger`: Rot ist Gefahr, nicht Bedienung. Der zweite Handgriff ist die
                    Rückfrage, nicht die Farbe. */}
                <Button>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

  return (
    <EinsatzSeite
      dataUpdatedAt={gemeinsamerDatenstand(efQuery.dataUpdatedAt, personalQuery.dataUpdatedAt)}
      meta={efQuery.isSuccess ? `${efs.length} Fahrzeuge` : undefined}
      titel={
        <Space>
          Fahrzeuge
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Fahrzeuge' },
          ]}
        />
      }
      aktionen={
        // `wrap` plus `maxWidth`: das `minWidth: 260` des Auswahlfeldes und der Knopf daneben
        // ergeben mehr als 390 px. Der Umbruch im Seitenkopf allein reicht nicht — er schiebt den
        // Block nur unter den Titel, wo er weiter zu breit ist.
        <Space wrap style={{ minWidth: 0 }}>
          {/* Der Umschalter steht auch ohne Schreibrecht: lesen kann jeder beide Ansichten. */}
          <Segmentleiste<FahrzeugeAnsicht>
            beschriftung="Ansicht"
            optionen={ANSICHT_OPTIONEN}
            wert={ansicht}
            onWechsel={setzeAnsicht}
          />
          {darfSchreiben && (
            <>
              <Select
                style={{ minWidth: 260, maxWidth: '100%' }}
                placeholder="Stamm-Fahrzeug disponieren …"
                value={null}
                options={poolOptionen}
                notFoundContent={poolInhalt}
                loading={disponiereMutation.isPending}
                disabled={disponiereMutation.isPending}
                onSelect={(fahrzeugId) => {
                  if (fahrzeugId != null) disponiereMutation.mutate(fahrzeugId);
                }}
              />
              <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Fahrzeug</Button>
            </>
          )}
        </Space>
      }
      hinweis={
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      {/* `karte.titel` trägt bewusst kein `ziel`: `fahrzeugePfad` ist eine
          Query-Param-Selektion auf diese Seite, der Link zeigte auf sich selbst. Tastaturziel
          der Karte ist die Primäraktion; eine Karte im Nur-Lese-Modus hat unter `md` kein
          fokussierbares Element.

          `zufluss` bleibt `sammelbanner`: der Status wird in der Zeile gewechselt, eigen wie
          fremd über eine Invalidierung. */}

      {/* Der Statuskatalog trägt die Auswahlliste jeder Statuszelle. Fällt er aus, wäre der
          Statuswechsel lautlos unmöglich; die Meldung steht deshalb über der Tabelle.

          An `darfSchreiben` gekoppelt: wer nur liest, sieht `StatusBadge` aus den Zeilendaten
          und verliert nichts. */}
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
          „Noch keine Fahrzeuge disponiert" eine leere Disposition, wenn bloß die Verbindung
          abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponierte Fahrzeuge konnten nicht geladen werden"
          ursache={efQuery.error}
          onWiederholen={() => void efQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void efQuery.refetch()} />}
          <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />
          {ansicht === 'tableau' ? (
            <FmsTableau
              fahrzeuge={efs}
              katalog={stati}
              einheiten={einheitenQuery.data ?? null}
              // Nur ohne Daten: scheitert bloß ein Refetch, steht die bekannte Gliederung weiter
              // da.
              einheitenHinweis={
                einheitenQuery.isError && !einheitenQuery.data
                  ? 'Einheiten nicht abrufbar — Fahrzeuge ohne Gliederung'
                  : undefined
              }
              darfSchreiben={darfSchreiben}
              bedienungVon={statusBedienungVon}
              ladend={efQuery.isLoading || einheitenQuery.isLoading}
            />
          ) : (
            <Datensicht
              bezeichnung="Fahrzeuge im Einsatz"
              spalten={spalten}
              daten={efs}
              zeilenSchluessel="id"
              ladend={efQuery.isLoading}
              leerText="Noch keine Fahrzeuge disponiert"
              suche={{ platzhalter: 'Funkrufname, Typ, Kennzeichen' }}
              standardSortierung={{ spalte: 'funkrufname', richtung: 'auf' }}
              spaltenAusVoreinstellung={['bemerkung']}
              gruppen={{
                schluessel: (ef) => kategorieVon(ef.status_kategorie),
                etikett: kategorieEtikett,
                reihenfolge: KATEGORIE_REIHENFOLGE,
                // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
                unterEbene: 1,
              }}
              zeilenKlasse={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
              // Besatzung je Fahrzeug eingeklappt, über den beschrifteten Auslöser in Tabelle UND
              // Karte aufklappbar (LFH-697); die Ist/Soll-Stärke steht dauerhaft in der
              // Besatzungs-Spalte bzw. im Sekundärfeld.
              aufklappen={{
                etikett: 'Besatzung',
                zugaenglicherName: (ef) => `Besatzung zu ${ef.funkrufname}`,
                inhalt: (ef) => (
                  <BesatzungsBlock
                    ef={ef}
                    personal={personal}
                    darfSchreiben={darfSchreiben}
                    freiInhalt={besatzungInhalt}
                    onZuordnen={(epId) => besatzungZuMutation.mutate({ efId: ef.id, epId })}
                    onFreigeben={(epId) => besatzungFreiMutation.mutate({ efId: ef.id, epId })}
                  />
                ),
              }}
              karte={{
                art: 'plan',
                titel: { spalte: 'funkrufname' },
                // Nicht das `render` der Statusspalte — der Slot nimmt die Vertragsachse als
                // Deskriptor. Beide Zweige tragen dieselbe Darstellung und denselben Bedienweg; die
                // Mandantenfarbe geht über `statusBedienung.farbe` mit und steht auf Rand und Text,
                // nie auf der Fläche.
                status: (ef) => fahrzeugStatusDarstellung(ef),
                // Der Bedienweg sitzt hier und nicht im `aktion`-Slot: der ist mit „Entfernen"
                // belegt, und `Datensicht` sichert genau eine Primäraktion zu.
                statusBedienung: (ef) => (darfSchreiben ? statusBedienungVon(ef) : null),
                sekundaer: ['typ', 'traeger', 'besatzung'],
                aktion: darfSchreiben
                  ? {
                      etikett: 'Entfernen',
                      bestaetigung: 'Aus Einsatz entfernen?',
                      onKlick: (ef) => entfernenMutation.mutate(ef.id),
                    }
                  : undefined,
              }}
            />
          )}
        </>
      )}

      {/* Ad-hoc-Disposition als Schnellerfassung.

          Serienmodus, weil der Regelfall eine Menge ist: trifft eine fremde Einheit ein, werden
          ihre Fahrzeuge nacheinander erfasst. `Trägerorganisation` und `Fahrzeugtyp` überleben
          das Speichern (`uebernahme`) — beim Zug einer Einheit ist der Träger für alle gleich
          und der Typ oft auch.

          Feldbudget: vier sichtbare Felder, `OPTA` liegt unter „Weitere Angaben" — bei einem
          ad-hoc erfassten Fremdfahrzeug meist unbekannt, während Funkrufname, Typ, Träger und
          Kennzeichen ablesbar sind.

          `forceRender` am Klapp-Bereich: das eingeklappte Feld bleibt im Baum, damit ein
          eingetragener und wieder zugeklappter Wert beim Absenden mitgeht und das Feld für
          Tastatur und Prüfung existiert. */}
      <ErfassungsModal<AdhocEingabe>
        offen={adhocOffen}
        titel="Ad-hoc-Fahrzeug disponieren"
        form={form}
        erfassenText="Disponieren"
        serie
        uebernahme={['traegerorganisation', 'fahrzeugtyp']}
        laeuft={adhocMutation.isPending}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der Datensatz
        // ankam. Den Fehlertext meldet `onError` der Mutation.
        onErfassen={(w) => adhocMutation.mutateAsync(w)}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item
          label="Funkrufname"
          name="funkrufname"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input placeholder="z. B. Florian Nachbarstadt 44/1" />
        </Form.Item>
        <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp">
          <Input />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <Input placeholder="z. B. Feuerwehr Nachbarstadt" />
        </Form.Item>
        <Form.Item label="Kennzeichen" name="kennzeichen">
          <Input />
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: 'Weitere Angaben',
              forceRender: true,
              children: (
                <Form.Item label="OPTA" name="opta">
                  <Input />
                </Form.Item>
              ),
            },
          ]}
        />
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
