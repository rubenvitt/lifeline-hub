import { Breadcrumb, Button, Collapse, Form, Input, Space, Tag, Typography } from 'antd';
import { Segmentleiste, StatusChip } from '../components/instrument';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import {
  ladeTiereExport,
  legeTierAn,
  listeTiere,
  tierRegistrierAnzeige,
  type TierEingabe,
} from '../api/einsatzTier';
import { einsatzKeys } from '../api/queryKeys';
import Datensicht, {
  scrolleZurZeile,
  spaltenFuer,
  type Kartenplan,
} from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import FormularEingehaengt from '../components/FormularEingehaengt';
import { useFormularEingehaengt } from '../components/useFormularEingehaengt';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { parseListenZustand, tiereDetailPfad, tiereDruckPfad } from '../routing/deeplinks';
import { useListenGedaechtnis } from '../components/listenGedaechtnis';
import {
  SPEZIES_META,
  TIERE_SICHTEN,
  TIER_STATUS,
  filterTiere,
  halterNummer,
  verbleibText,
  type TiereSicht,
} from './tiere/tierHelfer';
import type { Spezies, Tier, TierStatus } from '../api/types';
import { useFrischAngelegt } from '../components/useFrischAngelegt';
import { useCsvExport } from '../components/useCsvExport';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { EINSATZ_ABGESCHLOSSEN } from '../components/nurAnsicht';
import { modulName } from '../einsatz/modulRegistry';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../anzeige/Ortsfeld';
import { ortEingabe } from '../anzeige/ortsfeldFormular';

/** Formularwerte: der Fundort ist ein Ortsfeld mit Text und Koordinate (LLH-1114). */
type TierFormular = Omit<TierEingabe, 'antreff_ort' | 'antreff_lat' | 'antreff_lon'> & {
  antreff_ort?: OrtsfeldWert;
};

/** Sitzungsfeld der Koordinate neben dem Fundort, als `"lat,lon"` (die Sitzung hält nur Strings). */
const FUNDORT_KOORDINATE = 'antreff_koordinate';

/** Gemerkter Fundort der Sitzung; die Koordinate hängt am Text wie ein gewählter Treffer. */
function gemerkterFundort(einsatzId: number): OrtsfeldWert | undefined {
  const text = liesErfassungsSitzungswert(einsatzId, 'tier', 'antreff_ort');
  if (text === undefined) return undefined;
  const [lat, lon] = (liesErfassungsSitzungswert(einsatzId, 'tier', FUNDORT_KOORDINATE) ?? '')
    .split(',')
    .map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && text.trim() !== ''
    ? { text, koordinate: { lat, lon }, quelle: 'adresse' }
    : { text, koordinate: null };
}

const STATUS_META = TIER_STATUS;

const SPEZIES_KEYS = Object.keys(SPEZIES_META) as Spezies[];
const SPEZIES_WERTE = SPEZIES_KEYS.map((k) => ({ text: SPEZIES_META[k], value: k as string }));
const STATUS_FOLGE = Object.keys(STATUS_META) as TierStatus[];
const STATUS_WERTE = STATUS_FOLGE.map((s) => ({
  text: STATUS_META[s].label.charAt(0).toUpperCase() + STATUS_META[s].label.slice(1),
  value: s as string,
}));

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = TiereSicht;

/** Halter-Kurzanzeige für die Liste. */
function halterAnzeige(t: Tier): React.ReactNode {
  const label = halterNummer(t);
  if (label != null) {
    return t.halter_storniert_at ? (
      <Typography.Text type="secondary">Halter (storniert): {label}</Typography.Text>
    ) : (
      <Tag>{label}</Tag>
    );
  }
  if (t.halter_kontakt) return <Typography.Text>{t.halter_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">unbekannt</Typography.Text>;
}

/**
 * Das eine Spaltenregister der Tierliste. Modulkonstante, weil kein `render` Komponentenzustand
 * liest; durch `spaltenFuer<Tier>()` geführt, nie annotiert — eine Annotation weitete die
 * Schlüsselliterale auf `string`.
 *
 * Sortieren und Filtern (LLH-1096, Muster der Schadenliste): Status und Spezies filtern im
 * Spaltenkopf, jede Spalte mit vergleichbarem Wert sortiert; Halter (Verweis oder Freitext) und
 * Fundort (Freitext) bleiben ohne. Die Spezies ersetzt das frühere Auswahlfeld neben den Reitern:
 * im Kartenzweig steht sie als Auswahlfeld über der Liste, an seiner Stelle. Der Status hat dort
 * keins (`ohneKartenfeld`): die Reiter darüber führen ihn schon.
 */
const tierSpalten = spaltenFuer<Tier>()([
  {
    title: 'Reg.-Nr.',
    key: 'reg',
    width: 90,
    immerSichtbar: true,
    // Über die Zahl sortiert — über den Text läge „T-10" vor „T-9".
    sortWert: (t) => t.registrier_nr,
    suchText: (t) => tierRegistrierAnzeige(t.registrier_nr),
    // Kein Anker: den Titel-Link setzt der Kartenplan über `titel.ziel`, in beiden Zweigen.
    render: (_, t) => (
      <Typography.Text strong>{tierRegistrierAnzeige(t.registrier_nr)}</Typography.Text>
    ),
  },
  {
    title: 'Status',
    key: 'status',
    width: 130,
    sortWert: (t) => STATUS_FOLGE.indexOf(t.status),
    filter: { werte: STATUS_WERTE, trifft: (t, w) => t.status === w, ohneKartenfeld: true },
    render: (_, t) => (
      <StatusChip ton={STATUS_META[t.status].ton} wort={STATUS_META[t.status].label} />
    ),
  },
  {
    // LLH-1092: wohin das Tier gegangen ist, ohne Klick — „—“, solange es nicht abgeschlossen ist.
    title: 'Verbleib',
    key: 'verbleib',
    sortWert: (t) => verbleibText(t),
    suchText: (t) => verbleibText(t),
    render: (_, t) => verbleibText(t) ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Spezies',
    key: 'spezies',
    width: 120,
    sortWert: (t) => SPEZIES_META[t.spezies],
    filter: { werte: SPEZIES_WERTE, trifft: (t, w) => t.spezies === w },
    render: (_, t) => SPEZIES_META[t.spezies],
  },
  {
    title: 'Rufname',
    key: 'rufname',
    sortWert: (t) => t.rufname,
    suchText: (t) => t.rufname,
    render: (_, t) => t.rufname ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Rasse',
    dataIndex: 'rasse_beschreibung',
    key: 'rasse',
    abBreite: 'lg',
    sortWert: (t) => t.rasse_beschreibung,
    suchText: (t) => t.rasse_beschreibung,
    render: (r) => r ?? '—',
  },
  {
    title: 'Halter',
    key: 'halter',
    // Beide Halter-Wege tragen zur Suche bei: die verknüpfte Person über ihre R-Nummer, der frei
    // erfasste Kontakt über seinen Text.
    suchText: (t) => halterNummer(t) ?? t.halter_kontakt,
    render: (_, t) => halterAnzeige(t),
  },
  {
    title: 'seit',
    key: 'seit',
    /**
     * Anders als bei Personen: `TierAnzeige` trägt weder Sichtungskategorie noch -zeitpunkt (das
     * Modul ist bewusst schlank). Keine Dringlichkeitssortierung, nur „seit" aus `erfasst_at` —
     * `geaendert_at` liefe bei jeder Notiz weiter und beantwortete „wann zuletzt angefasst".
     *
     * Keine Breitenschwelle: die Zeitachse ist der Zweck der Spalte.
     */
    sortWert: (t) => t.erfasst_at,
    render: (_, t) => <ZeitAnzeige wert={t.erfasst_at} />,
  },
  {
    title: 'Fundort',
    dataIndex: 'antreff_ort',
    key: 'antreff_ort',
    abBreite: 'xl',
    render: (t) => t ?? '—',
  },
]);

type TierSpaltenKey = (typeof tierSpalten)[number]['key'];

/**
 * Kartenplan der Tierliste. Kein `status`-Slot: `TierStatus` steht nicht im Statusfarb-Vertrag
 * (`theme/statusFarben.ts` führt ihn bewusst draußen), und der Slot nimmt eine `StatusDarstellung`
 * daraus. Die Spalte trägt eine getönte Statusfläche (`TIER_STATUS` in `tiere/tierHelfer.ts`, Ton +
 * Wort); in der Karte steht der Status als Sekundärfeld mit Wort. Ihn in den Vertrag zu heben ist
 * eine eigene Entscheidung.
 */
const tierKarte = (einsatzId: number): Kartenplan<Tier, TierSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (t) => tiereDetailPfad(einsatzId, t.id) },
  sekundaer: ['rufname', 'status', 'seit'],
});

export default function TierePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const [sichtNachEinsatz, setSichtNachEinsatz] = useState<Record<number, Sicht>>({});
  const [highlight, setHighlight] = useState<{ einsatzId: number; tierId: number } | null>(null);
  const sicht = sichtNachEinsatz[einsatzId] ?? 'aktiv';
  /**
   * Sortierung, Kopffilter und Suche stehen in der Adresse (LLH-1096, Muster der Schadenliste); der
   * Hook gehört der Seite und steht vor jedem frühen Ausstieg. Alle Achsen hängen an keinen Daten.
   */
  const gedaechtnis = useListenGedaechtnis<TierSpaltenKey>('tiere', tierSpalten, {
    vorgabe: { spalte: 'reg', richtung: 'ab' },
    einsatzId,
  });
  /** Zählt Neuaufbauten der Sicht, wenn ein neues Tier sonst unter einem Kopffilter fehlte. */
  const [neuaufbau, setNeuaufbau] = useState(0);

  const setSichtFuer = (zielEinsatzId: number, neueSicht: Sicht) => {
    setSichtNachEinsatz((alt) => ({ ...alt, [zielEinsatzId]: neueSicht }));
  };
  /**
   * Ein Reiterwechsel: der Suchbegriff gehört zur Menge des Reiters und fällt weg, Sortierung und
   * Kopffilter gehen mit (die Sicht beginnt beim gemeldeten Stand des Gedächtnisses).
   */
  const wechsleReiter = (neueSicht: Sicht) => {
    gedaechtnis.melde({ ...gedaechtnis.start, suche: '' });
    setSichtFuer(einsatzId, neueSicht);
  };

  // Die Tier-Liste hält der Einsatz-Live-Stream im EinsatzLayout aktuell (`tier` →
  // 'einsatz-tiere').
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const tiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
  });
  const frischAngelegt = useFrischAngelegt<Tier>(einsatzId, einsatzKeys.tiere, tiereQuery);

  const qc = useQueryClient();
  const [modus, setModus] = useState<{
    einsatzId: number;
    wert: 'erfassen' | 'vermisst';
  } | null>(null);
  const aktuellerModus = modus?.einsatzId === einsatzId ? modus.wert : null;
  const [form] = Form.useForm<TierFormular>();
  const geladeneOeffnung = useRef<string | null>(null);
  const formularEinsatzId = useRef(einsatzId);
  /** Hängt das `<Form>` des Dialogs (LFH-627, `components/useFormularEingehaengt.ts`)? */
  const formular = useFormularEingehaengt();

  useEffect(() => {
    if (formularEinsatzId.current !== einsatzId) {
      formularEinsatzId.current = einsatzId;
      if (formular.jeDa.current) form.resetFields();
      geladeneOeffnung.current = null;
    }
    const oeffnung = aktuellerModus === null ? null : `${einsatzId}:tier`;
    if (oeffnung === null) {
      geladeneOeffnung.current = null;
      return;
    }
    // antds `Modal` hängt sein `<Form>` erst nach `open` ein.
    if (!formular.da) return;
    if (geladeneOeffnung.current === oeffnung) return;
    geladeneOeffnung.current = oeffnung;
    form.setFieldValue('antreff_ort', gemerkterFundort(einsatzId));
  }, [aktuellerModus, einsatzId, form, formular.da, formular.jeDa]);

  // Schnellaktion: ?neu=1 öffnet „Tier erfassen" (Sprungpalette, LFH-506). Warten bis der
  // Einsatz geladen ist; Param immer löschen, Maske nur bei Schreibrecht. Eine Kopie statt
  // In-place-Mutation, sonst sähe der zweite StrictMode-Durchlauf den Parameter nicht mehr.
  const [searchParams, setSearchParams] = useSearchParams();
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setModus({ einsatzId, wert: 'erfassen' });
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh, einsatzId]);

  const csvExport = useCsvExport(einsatzId, 'tiere', ladeTiereExport);

  useEffect(() => {
    if (highlight?.einsatzId !== einsatzId) return;
    scrolleZurZeile(highlight.tierId);
  }, [highlight, einsatzId, sicht]);

  /**
   * Anlegen. `onSuccess` invalidiert nur — Schließen macht `onFertig` der Erfassungshülle, Leeren
   * die Hülle auf allen Wegen; ein `resetFields` hier leerte im Serienlauf auch die übernommenen
   * Werte. Kein `onError`: den Grund zeigt die Hülle im Dialog (`speicherung`, LFH-1077).
   */
  const anlegenMutation = useMutation({
    mutationFn: (v: { einsatzId: number; daten: TierEingabe }) => legeTierAn(v.einsatzId, v.daten),
    onMutate: async (v) => {
      // Ein bereits laufender Listen-GET kann vor dem POST gelesen haben und später dessen Ergebnis
      // aus dem Cache verdrängen. Canceln, bevor der Schreibvorgang startet.
      await qc.cancelQueries({ queryKey: einsatzKeys.tiere(v.einsatzId) });
    },
    onSuccess: (tier, variablen) => {
      frischAngelegt.merke(variablen.einsatzId, [tier]);
      setHighlight({ einsatzId: variablen.einsatzId, tierId: tier.id });
      setSichtFuer(variablen.einsatzId, tier.status);
      // Das neue Tier steht in der Sicht: ein Kopffilter auf Spezies oder Status, der es
      // verbärge, fällt (wie früher das Spezies-Feld), die übrigen bleiben.
      if (variablen.einsatzId === einsatzId) {
        const start = gedaechtnis.start;
        const filter = { ...start.filter };
        for (const [spalte, wert] of [
          ['spezies', tier.spezies],
          ['status', tier.status],
        ] as const) {
          if (filter[spalte]?.length && !filter[spalte].includes(wert)) delete filter[spalte];
        }
        if (Object.keys(filter).length !== Object.keys(start.filter).length) {
          gedaechtnis.melde({ ...start, filter });
          setNeuaufbau((n) => n + 1);
        }
      }
      qc.invalidateQueries({ queryKey: einsatzKeys.tiere(variablen.einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(variablen.einsatzId) });
    },
  });
  /*
   * Nur das Anlegen DIESES Einsatzes gehört in den Dialog: ein laufendes aus dem vorigen sperrt
   * hier kein Abbrechen, seine Ablehnung steht hier nicht.
   */
  const diesesAnlegen = anlegenMutation.variables?.einsatzId === einsatzId;
  const anlegenSpeicherung: Speicherung = {
    error: diesesAnlegen ? anlegenMutation.error : null,
    isPending: diesesAnlegen && anlegenMutation.isPending,
    reset: anlegenMutation.reset,
  };

  /**
   * Seitenzustand — nur `einsatzQuery`: Breadcrumb, Titelzeile und `darfImEinsatzSchreiben(...)`
   * hängen an ihr. Deshalb hier ein Frühausstieg, und nur hier.
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const nurAnsicht = !darfSchreiben && einsatz.status !== 'aktiv';

  const alle = frischAngelegt.alle;
  const tiere = filterTiere(alle, { sicht });
  // Der Druck nimmt die Spezies aus dem Kopffilter, wie er in der Adresse steht (LLH-1096).
  const speziesFilter = (parseListenZustand(searchParams).filter.spezies ?? []).filter(
    (s): s is Spezies => SPEZIES_KEYS.includes(s as Spezies),
  );

  /**
   * Listenzustand — an der Stelle der Liste entschieden, nie als Frühausstieg.
   *
   * Gemessen an `alle`, nicht an `tiere`: die gefilterte Menge ist bei Reiter oder Spezies-Filter
   * regelmäßig leer, während Zeilen im Zwischenspeicher stehen.
   *
   * Ohne Zeilen tritt der Fehler an die Stelle der Sicht, sonst behauptete „Keine Tiere in dieser
   * Sicht" eine leere Menge. Mit Zeilen bleiben sie stehen und bekommen ein Banner. Der Ladezweig
   * liegt am Primitiv (`ladend`).
   */
  const listeGescheitert = tiereQuery.isError && alle.length === 0;
  const druckPfad = tiereDruckPfad(einsatzId, { sicht, spezies: speziesFilter });
  const standVeraltet = tiereQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      dataUpdatedAt={tiereQuery.dataUpdatedAt}
      meta={tiereQuery.isSuccess ? `${tiereQuery.data.length} Tiere` : undefined}
      titel={modulName('tiere')}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('tiere') },
          ]}
        />
      }
      aktionen={
        // Ein Fragment, kein `Space`: die Knöpfe sind Kinder der Kopfzeile und teilen sie unter
        // `md` mit dem Auslöser „Weitere“ (LFH-963).
        darfSchreiben && (
          <>
            <Button type="primary" onClick={() => setModus({ einsatzId, wert: 'erfassen' })}>
              Tier erfassen
            </Button>
            <Button onClick={() => setModus({ einsatzId, wert: 'vermisst' })}>
              Vermisst melden
            </Button>
          </>
        )
      }
      // Drucken und CSV öffnen, senden nichts ab — Nebenwege im Kopf, unter `md` hinter
      // „Weitere" (`frontend/AGENTS.md`, Aktionen). Ohne Schreib-Riegel: beide verlangen nur den
      // Lesezugriff, den schon die Liste braucht.
      weitere={{
        name: 'Weitere Aktionen zu den Tieren',
        eintraege: [
          {
            key: 'druck',
            label: 'Drucken / als PDF',
            ziel: druckPfad,
            onWahl: () => navigate(druckPfad),
          },
          {
            key: 'csv',
            label: 'CSV exportieren',
            laeuft: csvExport.laeuft,
            onWahl: csvExport.exportieren,
          },
        ],
      }}
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette) — mit demselben
      // Rechte-Riegel wie der Knopf.
      neueZeile={darfSchreiben ? () => setModus({ einsatzId, wert: 'erfassen' }) : undefined}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (nurAnsicht || csvExport.fehler != null) && (
          <SeitenHinweise
            rechteText={EINSATZ_ABGESCHLOSSEN}
            rechteFehlt={nurAnsicht}
            fehler={csvExport.fehler}
            fehlerTitel="Export fehlgeschlagen"
            fehlerFallback="Keine Verbindung zum Server — Export nicht möglich"
          />
        )
      }
    >
      {/* Die Statussicht als Reiter. Eine Wahl, die die Liste darunter filtert — `radiogroup`, nicht
          `tablist`: es gibt kein eigenes Feld je Segment. Die Spezies filtert im Spaltenkopf
          (LLH-1096), im Kartenzweig als Auswahlfeld der Sicht. */}
      <Space wrap size="middle" align="center" style={{ marginBottom: 12 }}>
        <Segmentleiste
          beschriftung="Tiere nach Status filtern"
          wert={sicht}
          onWechsel={wechsleReiter}
          optionen={TIERE_SICHTEN.map((s) => ({ wert: s.key, label: s.label }))}
        />
      </Space>

      {listeGescheitert ? (
        <SeitenFehler
          text="Tiere konnten nicht geladen werden"
          ursache={tiereQuery.error}
          onWiederholen={() => void tiereQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void tiereQuery.refetch()} />}

          <Datensicht
            /**
             * Vier Reiter, eine Sichtstelle — der Schlüssel trägt deshalb die Statusachse. Ohne ihn
             * reichte React dieselbe Instanz über alle vier Mengen weiter, und der Suchbegriff im
             * Primitiv filterte eine fremde Menge: im Reiter „Vermisst" nach einem Rufnamen
             * gesucht, auf „Alle" gewechselt, und dort fehlen still Zeilen. Dieselbe Falle ist an
             * `PersonenPage` behoben.
             *
             * Seit dem Gedächtnis (LLH-1096) beginnt die neue Instanz beim gemeldeten Stand:
             * Sortierung, Kopffilter und Spaltenwahl gehen mit, den Suchbegriff räumt
             * `wechsleReiter` vorher. `neuaufbau` baut die Sicht neu, wenn ein frisch angelegtes
             * Tier sonst unter einem Kopffilter fehlte.
             *
             * Die Spezies filtert im Kopf, innerhalb der Instanz: der Reiter wechselt das
             * Arbeitsfach, die Spezies engt darin ein.
             *
             * Der Guard (`components/datensicht.guard.test.ts`) prüft nur, ob der Schlüssel die
             * Schalterachse `sicht` nennt; die Spezies-Frage entscheidet er nicht.
             */
            key={`${sicht}-${neuaufbau}`}
            bezeichnung="Tiere im Einsatz"
            spalten={tierSpalten}
            daten={tiere}
            zeilenSchluessel="id"
            ladend={tiereQuery.isLoading}
            leerText="Keine Tiere in dieser Sicht"
            suche={{ platzhalter: 'T-Nr., Rufname, Rasse' }}
            // Vorgabe im Gedächtnis: `reg` absteigend spiegelt die Backend-Ordnung
            // (`ORDER BY t.registrier_nr DESC`), das jüngste Tier oben.
            mehrzahl="Tieren"
            gedaechtnis={gedaechtnis}
            onZeileKlick={(t) => navigate(tiereDetailPfad(einsatzId, t.id))}
            karte={tierKarte(einsatzId)}
            zeilenKlasse={(t) =>
              highlight?.einsatzId === einsatzId && t.id === highlight.tierId
                ? 'zeile-hervorgehoben'
                : undefined
            }
          />
        </>
      )}

      {/* Serienmodus: an einer Sammelstelle kommen die Tiere in Serie an.

          `uebernahme` trägt die zwei Felder, die sich an einer Sammelstelle nicht ändern: der
          Fundort ist die Sammelstelle selbst, und die Spezies müsste sonst je Tier neu
          gewählt werden (das Zurücksetzen fiele auf `initialValues` = 'hund'). Die übrigen
          Felder beschreiben das einzelne Tier.

          Der sitzungsweite Fundort ist ein eigener Vertrag: nach erfolgreicher Mutation
          einsatz- und maskenbezogen gemerkt und beim Öffnen einmal eingesetzt. Er gehört nicht
          zu `initialValues`, damit ein Serien-Reset bei ausgeschaltetem Schalter leer bleibt.

          `status` steht nicht im Formular: er kommt aus dem Modus, mit dem der Dialog geöffnet
          wurde; die Ableitung sitzt in `onErfassen`. */}
      <ErfassungsModal<TierFormular>
        offen={aktuellerModus !== null}
        titel={aktuellerModus === 'vermisst' ? 'Vermisst melden' : 'Tier erfassen'}
        form={form}
        laeuft={anlegenSpeicherung.isPending}
        speicherung={anlegenSpeicherung}
        speicherFehlerTitel="Nicht erfasst"
        speicherFehlerFallback="Erfassen fehlgeschlagen"
        initialValues={{ spezies: 'hund' }}
        serie
        uebernahme={['spezies', 'antreff_ort']}
        onErfassen={async ({ antreff_ort, ...daten }) => {
          const fundort = ortEingabe(antreff_ort);
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          await anlegenMutation.mutateAsync({
            einsatzId,
            daten: {
              ...daten,
              ...(fundort.text != null ? { antreff_ort: fundort.text } : {}),
              ...(fundort.lat != null
                ? { antreff_lat: fundort.lat, antreff_lon: fundort.lon }
                : {}),
              status: aktuellerModus === 'vermisst' ? 'vermisst' : 'aktiv',
            },
          });
        }}
        onErfasst={(daten) => {
          // Erst die zentrale Post-Acceptance-Stufe darf den Sitzungswert ändern: ein Abbruch
          // während des POST besteht die Generation davor nicht. Die Koordinate hängt am Text.
          if (daten.antreff_ort !== undefined) {
            const fundort = ortEingabe(daten.antreff_ort);
            schreibeErfassungsSitzungswert(
              einsatzId,
              'tier',
              'antreff_ort',
              daten.antreff_ort.text,
            );
            schreibeErfassungsSitzungswert(
              einsatzId,
              'tier',
              FUNDORT_KOORDINATE,
              fundort.lat != null ? `${fundort.lat},${fundort.lon}` : '',
            );
          }
        }}
        onFertig={() => setModus((alt) => (alt?.einsatzId === einsatzId ? null : alt))}
        onAbbrechen={() => setModus((alt) => (alt?.einsatzId === einsatzId ? null : alt))}
      >
        <FormularEingehaengt onWechsel={formular.melde} />
        <Form.Item
          label="Spezies"
          name="spezies"
          rules={[{ required: true, message: 'Bitte Spezies wählen' }]}
        >
          <Select options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
        </Form.Item>
        <Form.Item label="Rufname" name="rufname">
          <Input />
        </Form.Item>
        {/* Ortsfeld (LLH-1114): Suche, getippte Koordinate, Vorschau mit Nadel. */}
        <Form.Item label="Fundort" name="antreff_ort">
          <EinsatzOrtsfeld einsatzId={einsatzId} etikett="Fundort" />
        </Form.Item>
        {/* FELDBUDGET (LFH-963, `frontend/AGENTS.md`, Feldbudget): drei sichtbare Felder in
            beiden Modi, der Rest eingeklappt. `forceRender` ist TRAGEND: ohne ihn fehlten die
            eingeklappten Werte in `onFinish`, und die Feldzählung des Budgets wäre nicht prüfbar. */}
        <Collapse
          ghost
          style={{ marginInline: -8 }}
          items={[
            {
              key: 'weitere',
              label: 'Weitere Angaben',
              forceRender: true,
              children: (
                <>
                  <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung">
                    <Input placeholder="z. B. Haflinger, Deutscher Schäferhund" />
                  </Form.Item>
                  {aktuellerModus === 'vermisst' && (
                    <>
                      <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung">
                        <Input />
                      </Form.Item>
                      <Form.Item label="Kennzeichnung" name="kennzeichnung">
                        <Input placeholder="Chip / Tätowierung / Halsband" />
                      </Form.Item>
                      <Form.Item label="Halter-Kontakt" name="halter_kontakt">
                        <Input placeholder="Name, Telefon" />
                      </Form.Item>
                    </>
                  )}
                  <Form.Item label="Notiz" name="notiz">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
