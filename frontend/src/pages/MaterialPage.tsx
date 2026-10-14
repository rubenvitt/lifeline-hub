import { Alert, App, Breadcrumb, Button, Collapse, Form, Input, Modal, Space, Tag } from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { ErfassungsModal } from '../components/Erfassung';
import { MengenFeld } from '../components/MengenFeld';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { listeMaterial } from '../api/material';
import {
  updateDisposition,
  disponiereAdhoc,
  disponiereMaterial,
  listEinsatzMaterial,
  listEntlassenesMaterial,
  nimmAusDemEinsatz,
  reaktiviereDisposition,
  storniereDisposition,
  type MaterialAdhocEingabe,
} from '../api/einsatzMaterial';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { materialStatus, type StatusDarstellung } from '../theme/statusFarben';
import DemoMarke from '../components/DemoMarke';
import { demoGroupedOptions } from '../stammdaten/demoAuswahl';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { useOptimistischesZeilenUpdate } from '../kraefte/useOptimistischesZeilenUpdate';
import { modulName } from '../einsatz/modulRegistry';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import { useNewGesture } from './einsatzabschnitte/useNewGesture';

/**
 * Die Farbentscheidung für den Materialstatus liegt in `theme/statusFarben.ts` (`materialStatus`).
 * Diese Datei hält nur Reihenfolge und Filterwerte, abgeleitet aus der Vertragskarte — ein
 * Behandlungsweg für dieses Enum, gemeinsam mit `pages/uhs/MaterialTab.tsx`.
 */
const STATUS_REIHENFOLGE = Object.keys(materialStatus) as MaterialStatus[];

/** Menüwerte mit `darstellung` — der Farbpunkt im Statusmenü kommt aus dem Vertrag. */
const STATUS_OPTIONEN: StatusOption<MaterialStatus>[] = STATUS_REIHENFOLGE.map((s) => ({
  wert: s,
  label: materialStatus[s].label,
  darstellung: materialStatus[s],
}));

function statusDarstellung(em: EinsatzMaterial): StatusDarstellung {
  return materialStatus[em.status];
}
/** Filterwerte auf der eigenen Materialachse (fünf Werte), nicht auf der Kräfte-Kategorie. */
const STATUS_FILTER_WERTE = STATUS_REIHENFOLGE.map((s) => ({
  value: s,
  text: materialStatus[s].label,
}));

/**
 * Inline-Mengen-Editor: lokaler Zustand, committet erst bei Blur/Enter (min 1). Der Riegel hält
 * bis zum neuen Serverstand; eine Ablehnung löst ihn (LFH-1077): sonst bliebe das Feld nach dem
 * ersten Fehler stumm, weil `em.menge` sich nie ändert. Der getippte Wert bleibt stehen, den
 * Grund zeigt die Zeile.
 */
function MengeZelle({
  em,
  onChange,
}: {
  em: EinsatzMaterial;
  onChange: (menge: number) => Promise<unknown>;
}) {
  const [wert, setWert] = useState<number>(em.menge);
  const pendingRef = useRef(false);
  // Abgelehnte Menge: das Verlassen schickt sie nicht noch einmal (sonst ginge sie bei jedem Klick
  // in eine andere Zelle erneut hinaus), Enter als ausdrücklicher Wiederholungsweg schon.
  const abgelehntRef = useRef<number | null>(null);
  useEffect(() => {
    setWert(em.menge);
    pendingRef.current = false;
    abgelehntRef.current = null;
  }, [em.menge]);
  const commit = (perEnter: boolean) => {
    if (pendingRef.current || wert < 1 || wert === em.menge) return;
    if (!perEnter && wert === abgelehntRef.current) return;
    const gesendet = wert;
    pendingRef.current = true;
    onChange(gesendet).catch(() => {
      pendingRef.current = false;
      abgelehntRef.current = gesendet;
    });
  };
  return (
    // Die Höhe kommt aus `controlHeight` und zieht mit der Dichtestufe mit. Die Breite bleibt fest:
    // sie trägt eine zweistellige Menge, keine Trefffläche. Der Name nennt die Position, sonst
    // hörte man in jeder Zeile nur „Menge“.
    <MengenFeld
      beschriftung={`Menge ${em.bezeichnung}`}
      style={{ width: 80 }}
      value={wert}
      onChange={(v) => setWert(v ?? 1)}
      onBlur={() => commit(false)}
      onPressEnter={() => commit(true)}
    />
  );
}

/** Werte des Disponier-Dialogs für Stamm-Material. */
interface StammDisposition {
  material_id: number;
  menge: number;
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [disponierenOffen, setDisponierenOffen] = useState(false);
  const [stammForm] = Form.useForm<StammDisposition>();
  /** Offene Rückfrage „Stornieren“ (LLH-1079): als `<Modal>` außerhalb der Zeilen-`map`. */
  const [stornoFuer, setStornoFuer] = useState<{ id: number; name: string } | null>(null);
  const isNewGestureStorno = useNewGesture(stornoFuer !== null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const emQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
  });
  // Aus dem Einsatz genommenes Material (LLH-1079 Teil II): getrennt geliefert, die Liste kennt es
  // nicht. Auf dem Draht heißt der Endzustand `entlassen`.
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.materialEntlassene(einsatzId),
    queryFn: () => listEntlassenesMaterial(einsatzId),
  });
  const poolQuery = useQuery({
    queryKey: globalKeys.materialListe('im-dienst'),
    queryFn: () => listeMaterial(true),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  // Ablehnungen an der Zeile, je Disposition gemerkt; alle Zeilenaktionen teilen den Speicher, die
  // zuletzt begonnene zählt (`frontend/AGENTS.md`, „Rückwege und Fehler“, LFH-1077). Die Dialoge
  // zeigen ihren Fehler über `speicherung` selbst.
  const zeilen = useZeilenFehler<number>();

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) =>
      disponiereMaterial(einsatzId, v.materialId, v.menge),
    // Schließen und Leeren gehören der Erfassungshülle (`onFertig`).
    onSuccess: () => {
      message.success('Material disponiert');
      invalidate();
    },
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(
        einsatzId,
        {
          bezeichnung: w.bezeichnung,
          kategorie: w.kategorie,
          bestandsnummer: w.bestandsnummer,
          traegerorganisation: w.traegerorganisation,
        },
        w.menge ?? 1,
      ),
    // Nur invalidieren und melden: geschlossen wird über `onFertig`, geleert von der
    // Erfassungshülle auf allen Wegen, auch beim Abbrechen.
    onSuccess: () => {
      invalidate();
      message.success('Ad-hoc-Material disponiert');
    },
  });
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) =>
      updateDisposition(einsatzId, v.emId, { menge: v.menge }),
    onMutate: (v) => zeilen.beginne(v.emId),
    onSuccess: invalidate,
    onError: (e, v) => zeilen.melde(v.emId, e, 'Menge nicht gespeichert'),
  });
  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzMaterial,
    { emId: number; status: MaterialStatus }
  >({
    queryKey: einsatzKeys.material(einsatzId),
    mutationFn: (v) => updateDisposition(einsatzId, v.emId, { status: v.status }),
    zeilenId: (v) => v.emId,
    anwenden: (em, v) => ({ ...em, status: v.status }),
    nochOptimistisch: (em, v) => em.status === v.status,
    zuruecknehmen: (em, vorher) => ({ ...em, status: vorher.status }),
    onBeginn: (v) => zeilen.beginne(v.emId),
    onFehler: (e, v) => zeilen.melde(v.emId, e, 'Status nicht geändert'),
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      updateDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onMutate: (v) => zeilen.beginne(v.emId),
    onSuccess: invalidate,
    onError: (e, v) => zeilen.melde(v.emId, e, 'Bemerkung nicht gespeichert'),
  });
  /*
   * Erneut disponieren (LLH-1079) hat zwei Wege mit je eigenem Fehlerort (`frontend/AGENTS.md`,
   * „Rückwege und Fehler“): die Aktion im Block meldet an ihrem Eintrag, Rückgängig aus dem Toast
   * im Seitenhinweis — die Zeile ist dann weg, der Block meist eingeklappt.
   */
  const reaktivierenMutation = useMutation({
    mutationFn: (emId: number) => reaktiviereDisposition(einsatzId, emId),
    onMutate: (emId) => zeilen.beginne(emId),
    onSuccess: invalidate,
    onError: (e, emId) => zeilen.melde(emId, e, 'Nicht erneut disponiert'),
  });
  const [rueckgaengigFehler, setRueckgaengigFehler] = useState<unknown>(null);
  // Die nächste Rücknahme aus dem Toast räumt den Grund der vorigen.
  const rueckgaengigMutation = useMutation({
    mutationFn: (emId: number) => reaktiviereDisposition(einsatzId, emId),
    onMutate: () => setRueckgaengigFehler(null),
    onSuccess: invalidate,
    onError: (e) => {
      setRueckgaengigFehler(e);
      invalidate();
    },
  });
  // Aus dem Einsatz nehmen ist umkehrbar: keine Rückfrage, sondern ein Rückgängig-Toast
  // (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“, design.md D8). Rückgängig
  // setzt Einheit und UHS nicht wieder. Die Einheit verliert ein Mitglied: ihre Liste mit.
  const herausnehmenMutation = useMutation({
    mutationFn: (v: { emId: number; name: string }) => nimmAusDemEinsatz(einsatzId, v.emId),
    onMutate: (v) => zeilen.beginne(v.emId),
    onSuccess: (_, v) => {
      invalidate();
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      zeigeRueckgaengig(message, `${v.name} aus dem Einsatz genommen`, () =>
        rueckgaengigMutation.mutate(v.emId),
      );
    },
    onError: (e, v) => zeilen.melde(v.emId, e, 'Nicht aus dem Einsatz genommen'),
  });
  // Stornieren ist unumkehrbar und nur kurz nach einer Fehldisposition möglich; der Server nennt
  // den Grund einer Ablehnung, er steht an der Zeile.
  const stornierenMutation = useMutation({
    mutationFn: (emId: number) => storniereDisposition(einsatzId, emId),
    onMutate: (emId) => zeilen.beginne(emId),
    onSuccess: invalidate,
    onError: (e, emId) => zeilen.melde(emId, e, 'Nicht storniert'),
  });

  // Seitenzustand: nur `einsatzQuery` — ohne sie tragen weder Breadcrumb noch
  // `darfImEinsatzSchreiben` etwas. Alles andere wird an Ort und Stelle entschieden, nie als
  // Frühausstieg.
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  const ems = emQuery.data ?? [];
  const entlassene = entlasseneQuery.data ?? [];
  /** Läuft für diese Zeile Herausnehmen oder Stornieren? Dann keine zweite Handlung. */
  const isZeileBusy = (emId: number) =>
    (herausnehmenMutation.isPending && herausnehmenMutation.variables?.emId === emId) ||
    (stornierenMutation.isPending && stornierenMutation.variables === emId);
  const stornoEintraege = [{ key: 'stornieren', label: 'Stornieren', gefahr: true as const }];

  /**
   * Gemeinsamer Bedienweg für Tabellen- und Kartenzweig (Herleitung in `FahrzeugePage.tsx`). Ohne
   * `farbe`: `materialStatus` kennt keine Mandantenfarbe (nur `rolle` + `label`).
   */
  const statusBedienungVon = (em: EinsatzMaterial) => {
    const laeuft = statusMutation.isPending && statusMutation.variables?.emId === em.id;
    return {
      optionen: STATUS_OPTIONEN,
      aktuell: laeuft ? statusMutation.variables?.status : em.status,
      kennung: em.bezeichnung,
      laeuft,
      gesperrt: statusMutation.isPending,
      onWaehlen: (wert: string | number) => {
        if (!statusMutation.isPending) {
          statusMutation.mutate({ emId: em.id, status: wert as MaterialStatus });
        }
      },
    };
  };

  /**
   * Listenzustand — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im Zwischenspeicher
   * tritt der Fehler an die Stelle der Datensicht, sonst behauptete „Noch kein Material disponiert"
   * eine leere Disposition. Mit Zeilen bleiben sie stehen und bekommen ein Banner: echt, nur
   * womöglich alt.
   *
   * Gemessen an `ems`, der ungefilterten Menge: Suche und Filter leben im Primitiv; an ihrer
   * Restmenge gemessen kippte die Seite bei jedem engen Filter in den Fehlerzweig.
   */
  const listeGescheitert = emQuery.isError && ems.length === 0;
  const standVeraltet = emQuery.isError && ems.length > 0;

  // Kein Dedup wie bei Fahrzeugen: dieselbe Material-Art darf mehrfach als getrennte Position
  // disponiert werden (Mengen-Splitting auf Einheiten).
  // LFH-733: Demo-Stammdaten bleiben wählbar, stehen aber als Gruppe hinter den echten.
  const poolOptionen = demoGroupedOptions(
    poolQuery.data ?? [],
    (m) => `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  );

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, ob die Liste ankam. Scheitert der Abruf,
   * bleibt `poolOptionen` leer, und das Feld behauptete „Kein Material im Dienst". Ohne Fehler
   * bleibt der Bestandswortlaut.
   *
   * Kein `kein403`: die Material-Route ist org-lesbar ohne Admin-Schranke.
   */
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, {
      allgemein: 'Materialliste konnte nicht geladen werden',
    }) ?? 'Kein Material im Dienst';

  /**
   * Kategoriefilter aus den eigenen Daten; `undefined` ohne Werte. Das Feld erscheint erst mit dem
   * ersten gepflegten Wert — ein dauerhaft leeres Filterfeld sieht wie ein Werkzeug aus und ist
   * keins.
   */
  const kategorieWerte = [...new Set(ems.map((m) => m.kategorie).filter((k): k is string => !!k))]
    .sort()
    .map((k) => ({ text: k, value: k }));
  const kategorieFilter =
    kategorieWerte.length > 0
      ? { werte: kategorieWerte, trifft: (m: EinsatzMaterial, w: string) => m.kategorie === w }
      : undefined;

  /**
   * Spaltenregister der Materialseite. `EinsatzMaterialAnzeige` hat kein `status_kategorie`;
   * gruppiert und gefiltert wird auf der eigenen Fünf-Werte-Achse (`MaterialStatus`), dieselbe
   * Grenze wie in `filtereKraefte`.
   */
  const spalten = spaltenFuer<EinsatzMaterial>()([
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      immerSichtbar: true,
      sortWert: (m) => m.bezeichnung,
      suchText: (m) => m.bezeichnung,
      render: (_, em) => (
        <Space>
          {em.bezeichnung}
          {em.ist_adhoc && <Tag>ad-hoc</Tag>}
          {em.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      filter: kategorieFilter,
      suchText: (m) => m.kategorie,
      render: (t) => t ?? '—',
    },
    {
      title: 'Menge',
      key: 'menge',
      sortWert: (m) => m.menge,
      render: (_, em) =>
        darfSchreiben ? (
          <MengeZelle
            em={em}
            onChange={(menge) => mengeMutation.mutateAsync({ emId: em.id, menge })}
          />
        ) : (
          em.menge
        ),
    },
    {
      title: 'Status',
      key: 'status',
      filter: { werte: STATUS_FILTER_WERTE, trifft: (m, w) => m.status === w },
      // Kein `Select` mit Mindestbreite (die 390-px-Karte scheiterte daran). Deskriptor ganz
      // gespreizt — Herleitung in `FahrzeugePage.tsx`.
      render: (_, em) => (
        <StatusWahl
          darstellung={statusDarstellung(em)}
          darfSchreiben={darfSchreiben}
          {...statusBedienungVon(em)}
        />
      ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, em) => (
        <BemerkungZelle
          wert={em.bemerkung}
          kennung={em.bezeichnung}
          darfSchreiben={darfSchreiben}
          // Die Zusage lässt die Zelle bis zur Antwort offen (`BemerkungZelle`, LFH-1077).
          onSpeichern={(val) => bemerkungMutation.mutateAsync({ emId: em.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            // Herausnehmen ist umkehrbar: `danger` mit Abstand, keine Rückfrage; Stornieren steht
            // im Zeilenmenü und fragt nach (LLH-1079, design.md D8, wie die Fahrzeugseite).
            render: (_: unknown, em: EinsatzMaterial) => (
              <Space size="middle">
                <Button
                  danger
                  loading={
                    herausnehmenMutation.isPending && herausnehmenMutation.variables?.emId === em.id
                  }
                  disabled={isZeileBusy(em.id)}
                  aria-label={`${em.bezeichnung} aus dem Einsatz nehmen`}
                  onClick={() => herausnehmenMutation.mutate({ emId: em.id, name: em.bezeichnung })}
                >
                  Aus dem Einsatz nehmen
                </Button>
                <MenueAusloeser
                  eintraege={stornoEintraege}
                  zugaenglicherName={`Weitere Aktionen zu ${em.bezeichnung}`}
                  gesperrt={isZeileBusy(em.id)}
                  laeuft={stornierenMutation.isPending && stornierenMutation.variables === em.id}
                  onWahl={() => setStornoFuer({ id: em.id, name: em.bezeichnung })}
                />
              </Space>
            ),
          },
        ]
      : []),
  ]);

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('material') },
          ]}
        />
      }
      titel={modulName('material')}
      meta={emQuery.isSuccess ? `${ems.length} Positionen` : undefined}
      dataUpdatedAt={emQuery.dataUpdatedAt}
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
      /**
       * Der Kopf ÖFFNET nur (LFH-983, `frontend/AGENTS.md`, Bedien-Leitlinie): disponiert wird im
       * Dialog mit Absende-Knopf im `<form>`. Vorher stand hier eine Maske, die direkt absendete.
       */
      aktionen={
        darfSchreiben && (
          <Space wrap style={{ minWidth: 0 }}>
            <Button type="primary" onClick={() => setDisponierenOffen(true)}>
              Material disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )
      }
    >
      {/* Der Status steht im `karte.status`-Slot mit der Vertragsrolle aus
          `theme/statusFarben.ts` (`materialStatus`), und `statusBedienung` macht das Etikett
          zum Auslöser — nur so ist der Statuswechsel auf der 390-px-Karte erreichbar.

          `titel` ohne `ziel`: Material hat keine Detailroute. */}

      {/* Kein Katalog-Banner: der Materialstatus ist das lokale Enum `MaterialStatus` (fünf
          Werte) und kann nicht ausfallen, anders als der Statuskatalog der Fahrzeug- und
          Personalseite.

          Der Listenfehler tauscht die Datensicht aus: `Datensicht` führt den Kartenzweig an
          `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponiertes Material konnte nicht geladen werden"
          ursache={emQuery.error}
          onWiederholen={() => void emQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void emQuery.refetch()} />}
          <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />
          <Datensicht
            bezeichnung="Material im Einsatz"
            spalten={spalten}
            daten={ems}
            zeilenSchluessel="id"
            ladend={emQuery.isLoading}
            leerText="Noch kein Material disponiert"
            suche={{ platzhalter: 'Bezeichnung, Kategorie' }}
            standardSortierung={{ spalte: 'bezeichnung', richtung: 'auf' }}
            zeilenFehler={(em) => zeilen.grund(em.id)}
            gruppen={{
              schluessel: (m) => m.status,
              etikett: (w) => materialStatus[w as MaterialStatus]?.label ?? w,
              reihenfolge: STATUS_REIHENFOLGE,
              // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
              unterEbene: 1,
            }}
            karte={{
              art: 'plan',
              titel: { spalte: 'bezeichnung' },
              status: (em) => statusDarstellung(em),
              statusBedienung: (em) => (darfSchreiben ? statusBedienungVon(em) : null),
              // Zwei Sekundärfelder: `status` steht im Slot darüber und stünde sonst doppelt.
              sekundaer: ['kategorie', 'menge'],
              aktion: darfSchreiben
                ? {
                    etikett: 'Aus dem Einsatz nehmen',
                    zugaenglicherName: (em) => `${em.bezeichnung} aus dem Einsatz nehmen`,
                    onKlick: (em) =>
                      herausnehmenMutation.mutate({ emId: em.id, name: em.bezeichnung }),
                  }
                : undefined,
              weitere: darfSchreiben
                ? {
                    eintraege: () => stornoEintraege,
                    zugaenglicherName: (em) => `Weitere Aktionen zu ${em.bezeichnung}`,
                    laeuft: (em) => isZeileBusy(em.id),
                    onWahl: (_, em) => setStornoFuer({ id: em.id, name: em.bezeichnung }),
                  }
                : undefined,
            }}
          />
          {/* Der Nachweis bleibt erreichbar (Spec `kraefte-entlassung`); Wortlaut LLH-1093. */}
          <EntlassenBlock
            titel="Aus dem Einsatz genommen"
            endeWort="aus dem Einsatz genommen"
            eintraege={entlassene.map((em) => ({
              id: em.id,
              name: em.bezeichnung,
              zusatz: `×${em.menge}`,
              beendetAt: em.beendet_at,
            }))}
            aktion={
              darfSchreiben
                ? {
                    etikett: 'Erneut disponieren',
                    onKlick: (emId) => reaktivierenMutation.mutate(emId),
                    laeuft: (emId) =>
                      reaktivierenMutation.isPending && reaktivierenMutation.variables === emId,
                  }
                : undefined
            }
            fehler={(emId) => zeilen.grund(emId)}
          />
        </>
      )}

      {/* Die Rückfrage vor dem Unumkehrbaren steht als `<Modal>`, nicht im Menü (LFH-683). Sie
          nennt ihre Position und schließt, wenn die Zeile entfällt. */}
      <Modal
        open={stornoFuer !== null && ems.some((em) => em.id === stornoFuer.id)}
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
        Das Material erscheint danach in keiner Liste und keinem Nachweis.
      </Modal>

      {/* Stamm-Material disponieren. Serienmodus, weil eine Anlieferung mehrere Positionen bringt.
          Die Pflichtprüfung meldet ein fehlendes Material; der Knopf ist nie grau ohne Grund. */}
      <ErfassungsModal<StammDisposition>
        offen={disponierenOffen}
        titel="Material disponieren"
        form={stammForm}
        erfassenText="Disponieren"
        serie
        initialValues={{ menge: 1 }}
        laeuft={disponiereMutation.isPending}
        speicherung={disponiereMutation}
        speicherFehlerTitel="Nicht disponiert"
        speicherFehlerFallback="Disponieren fehlgeschlagen"
        onErfassen={async (w) => {
          await disponiereMutation.mutateAsync({ materialId: w.material_id, menge: w.menge });
        }}
        onFertig={() => setDisponierenOffen(false)}
        onAbbrechen={() => setDisponierenOffen(false)}
      >
        <Form.Item
          label="Material"
          name="material_id"
          rules={[{ required: true, message: 'Material wählen' }]}
        >
          <Select options={poolOptionen} notFoundContent={poolInhalt} />
        </Form.Item>
        <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
          <MengenFeld beschriftung="Menge" style={{ width: 120 }} />
        </Form.Item>
      </ErfassungsModal>

      {/* Ad-hoc-Erfassung auf der Schnellerfassungs-Hülle.

          Serienmodus, weil Ad-hoc-Material stückweise nachkommt. Wertübernahme auf Kategorie
          und Trägerorganisation — sie bleiben über eine Anlieferung gleich und stehen deshalb
          hinten: was sich je Position ändert (Bezeichnung, Menge), kommt zuerst.

          Feldbudget: höchstens vier sichtbare Felder. Die Bestandsnummer ist das fünfte; bei
          Spenden und Fremdmaterial gibt es sie meist nicht. Sie liegt unter „Weitere Angaben".

          `forceRender` registriert das Feld ab dem ersten Bild im Formular statt erst beim
          Aufklappen. Den eingetippten Wert rettet es nicht — der überlebt das Zuklappen ohnehin
          (antd baut den Bereich nicht ab, `Form.Item` bewahrt per Vorgabe). */}
      <ErfassungsModal<MaterialAdhocEingabe & { menge: number }>
        offen={adhocOffen}
        titel="Ad-hoc-Material ohne Stammeintrag"
        form={form}
        erfassenText="Disponieren"
        serie
        uebernahme={['kategorie', 'traegerorganisation']}
        initialValues={{ menge: 1 }}
        laeuft={adhocMutation.isPending}
        speicherung={adhocMutation}
        speicherFehlerTitel="Nicht disponiert"
        speicherFehlerFallback="Disponieren fehlgeschlagen"
        // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage lässt die Hülle die Werte
        // stehen. Den Grund zeigt die Hülle über `speicherung`.
        onErfassen={async (w) => {
          await adhocMutation.mutateAsync(w);
        }}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input placeholder="z. B. Spende-Decken" />
        </Form.Item>
        <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
          <MengenFeld beschriftung="Menge" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item label="Kategorie" name="kategorie">
          <Input />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <Input placeholder="z. B. THW" />
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: 'Weitere Angaben',
              forceRender: true,
              children: (
                <Form.Item label="Bestandsnummer" name="bestandsnummer" style={{ marginBottom: 0 }}>
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
