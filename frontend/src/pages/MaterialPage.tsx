import { Alert, App, Breadcrumb, Button, Collapse, Form, Input, InputNumber, Popconfirm, Space, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { ErfassungsModal } from '../components/Erfassung';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import Datenstand from '../components/Datenstand';
import { nichtGefundenInhalt, SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeMaterial } from '../api/material';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereMaterial, entferneDisposition,
  listeEinsatzMaterial, type MaterialAdhocEingabe,
} from '../api/einsatzMaterial';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import type { StatusDarstellung } from '../theme/statusFarben';

/**
 * Die fünf Materialzustände — NUR Beschriftung, bewusst OHNE Farbachse.
 *
 * ── WARUM HIER KEINE STATUSROLLE STEHT (LFH-339 · C4) ────────────────────────────────
 *
 * Der Materialstatus liegt ausserhalb des A2-Statusfarb-Vertrags; `statusFarben.ts` nennt
 * diese Datei namentlich als draussen, und ihn hineinzuziehen wäre der Bestands-Sweep, den
 * A2 ausdrücklich verbietet. Die Zielform-Spec §4 zieht die Linie genauso: Material fällt
 * nicht heraus, aber seine Ausnahme „wirkt auf die FARBE (§4b), nicht auf die Anordnung".
 *
 * Eine Rollenzuordnung — auch eine lokale — wäre eine Farbentscheidung, und sie bricht an
 * einem gemessenen Punkt: `im_einsatz` war Blau, und Blau ist im A0-System `bedien`.
 * „Rot bedient nichts, `bedien` ist blau" heisst umgekehrt, dass es für diesen Zustand
 * keine ehrliche Rolle gibt. Erfunden wird deshalb keine.
 *
 * Was bleibt: der TEXT trägt den Zustand — er ist der zweite Kanal (WCAG 1.4.1) und war es
 * immer. Die frühere `color`-Achse (antd-Preset-Namen, als Vollfläche gerendert) ist
 * ersatzlos weg: sie widersprach §4b, und ein Farbwert ohne Rolle ist genau die Sorte
 * zweite Wahrheit, die A2 aufgeräumt hat. Die Frage, welche Rollen dieser Katalog
 * bekommen soll, bleibt offen — sie ist eine eigene Entscheidung, kein Nebenprodukt.
 */
const STATUS_META: Record<MaterialStatus, { label: string }> = {
  einsatzbereit: { label: 'einsatzbereit' },
  im_einsatz: { label: 'im Einsatz' },
  defekt: { label: 'defekt' },
  verbraucht: { label: 'verbraucht' },
  desinfektion_noetig: { label: 'Desinfektion nötig' },
};
const STATUS_REIHENFOLGE = Object.keys(STATUS_META) as MaterialStatus[];

/**
 * Menüwerte OHNE `darstellung` — damit rendert `StatusWahl` keinen Farbpunkt. Das ist
 * kein Mangel, sondern die offene Farbfrage, sichtbar gelassen statt überschrieben.
 */
const STATUS_OPTIONEN: StatusOption<MaterialStatus>[] = STATUS_REIHENFOLGE.map((s) => ({
  wert: s,
  label: STATUS_META[s].label,
}));

/**
 * Etikett des Auslösers. `neutral` heisst hier „ausserhalb des Farbvertrags", NICHT
 * „dieser Zustand ist neutral" — dieselbe Unterscheidung, die `statusFarben.ts` bei
 * `verfuegbarkeit.gesperrt` schon trifft („ein bewusster Zustand, keine Gefahr").
 */
function statusDarstellung(em: EinsatzMaterial): StatusDarstellung {
  return { rolle: 'neutral', label: STATUS_META[em.status].label };
}
/** Filterwerte auf der EIGENEN Materialachse (fünf Werte), nicht auf der Kräfte-Kategorie. */
const STATUS_FILTER_WERTE = STATUS_REIHENFOLGE.map((s) => ({ value: s, text: STATUS_META[s].label }));

/** Inline-Mengen-Editor: lokaler Zustand, committet erst bei Blur/Enter (min 1). */
function MengeZelle({ em, onChange }: { em: EinsatzMaterial; onChange: (menge: number) => void }) {
  const [wert, setWert] = useState<number>(em.menge);
  const pendingRef = useRef(false);
  useEffect(() => { setWert(em.menge); pendingRef.current = false; }, [em.menge]);
  const commit = () => {
    if (pendingRef.current || wert < 1 || wert === em.menge) return;
    pendingRef.current = true;
    onChange(wert);
  };
  return (
    // Keine Klein-Variante: die Höhe kommt aus `controlHeight` und zieht mit der
    // Dichtestufe mit (LFH-339 · C4 — die letzte Einzelstelle des B5i-Bündels). Die
    // Breite bleibt fest: sie trägt eine zweistellige Menge, keine Trefffläche.
    <InputNumber
      min={1} style={{ width: 80 }} value={wert}
      onChange={(v) => setWert(v ?? 1)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [poolAuswahl, setPoolAuswahl] = useState<number | null>(null);
  const [poolMenge, setPoolMenge] = useState<number>(1);

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const emQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const poolQuery = useQuery({ queryKey: globalKeys.materialListe('im-dienst'), queryFn: () => listeMaterial(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) => disponiereMaterial(einsatzId, v.materialId, v.menge),
    onSuccess: () => {
      message.success('Material disponiert');
      invalidate();
      setPoolAuswahl(null);
      setPoolMenge(1);
    },
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(einsatzId, {
        bezeichnung: w.bezeichnung, kategorie: w.kategorie, bestandsnummer: w.bestandsnummer,
        traegerorganisation: w.traegerorganisation,
      }, w.menge ?? 1),
    // Nur invalidieren und melden (LFH-332 · B4): geschlossen wird über `onFertig`,
    // geleert wird von der Erfassungshülle — auf BEIDEN Wegen, auch beim Abbrechen.
    // Das frühere `resetFields()` hier lief neben `setAdhocOffen(false)` und ließ den
    // Abbruch-Weg ungeleert zurück; genau diese Asymmetrie behebt die Hülle.
    onSuccess: () => { invalidate(); message.success('Ad-hoc-Material disponiert'); },
    onError: fehler,
  });
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) => aktualisiereDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: invalidate, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { emId: number; status: MaterialStatus }) =>
      aktualisiereDisposition(einsatzId, v.emId, { status: v.status }),
    onMutate: async (v) => {
      const queryKey = einsatzKeys.material(einsatzId);
      await qc.cancelQueries({ queryKey });
      const vorher = qc.getQueryData<EinsatzMaterial[]>(queryKey)?.find((em) => em.id === v.emId);
      qc.setQueryData<EinsatzMaterial[]>(queryKey, (alt) =>
        alt?.map((em) => em.id === v.emId ? { ...em, status: v.status } : em),
      );
      return { vorher };
    },
    onSuccess: (serverStand) => {
      qc.setQueryData<EinsatzMaterial[]>(einsatzKeys.material(einsatzId), (alt) =>
        alt?.map((em) => em.id === serverStand.id ? serverStand : em),
      );
    },
    onError: (e, v, kontext) => {
      const vorher = kontext?.vorher;
      if (vorher) {
        qc.setQueryData<EinsatzMaterial[]>(einsatzKeys.material(einsatzId), (aktuell) =>
          aktuell?.map((em) => em.id === v.emId && em.status === v.status
            ? { ...em, status: vorher.status }
            : em),
        );
      }
      fehler(e);
    },
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate, onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (emId: number) => entferneDisposition(einsatzId, emId),
    onSuccess: invalidate, onError: fehler,
  });

  // Seitenzustand (LFH-331 · B3): NUR `einsatzQuery` — ohne sie tragen weder Breadcrumb
  // noch `darfImEinsatzSchreiben` etwas. Alles andere wird an Ort und Stelle entschieden,
  // nie als Frühausstieg. Der drehende Kreisel und das knopflose Alert von früher hatten
  // beide keinen Weg zurück; jetzt steht überall derselbe „Erneut abrufen".
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

  const ems = emQuery.data ?? [];

  /**
   * Gemeinsamer Bedienweg für Tabellen- und Kartenzweig — Herleitung siehe
   * `FahrzeugePage.tsx`. Ohne `farbe`: der Materialkatalog hat keine (siehe `STATUS_META`).
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
   * LISTENZUSTAND — zwei Lagen, zwei Antworten (D3). Der Fehler allein reicht als
   * Bedingung NICHT.
   *
   * Ohne Zeilen im Zwischenspeicher tritt der Fehler an die Stelle der Datensicht, sonst
   * behauptet „Noch kein Material disponiert" eine leere Disposition, wo bloß der Abruf
   * scheiterte. MIT Zeilen bleiben sie stehen und bekommen ein Banner: sie sind echt, nur
   * womöglich alt. Ein Fehler, der die Zeilen wegräumt, nähme der Einsatzkraft Daten, die
   * sie eben noch hatte — das Gegenteil dessen, wofür `SeitenStandVeraltet` gebaut ist.
   *
   * Gemessen an `ems`, der UNGEFILTERTEN Menge (Muster aus `TierePage`/`SchaedenPage`):
   * Suche und Filter leben IM Primitiv, an ihrer Restmenge gemessen kippte die Seite bei
   * jedem engen Filter in den Fehlerzweig — und nähme dem Bediener die Schalter, mit denen
   * er ihn wieder aufmachen könnte.
   */
  const listeGescheitert = emQuery.isError && ems.length === 0;
  const standVeraltet = emQuery.isError && ems.length > 0;

  // Kein Dedup wie bei Fahrzeugen: dieselbe Material-Art darf mehrfach (als getrennte
  // Position) disponiert werden (Mengen-Splitting auf Einheiten).
  const poolOptionen = (poolQuery.data ?? []).map((m) => ({
    value: m.id, label: `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  }));

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, OB die Liste überhaupt ankam
   * (LFH-331 · B3). Scheitert der Abruf, bleibt `poolOptionen` leer und das Feld behauptete
   * „Kein Material im Dienst" — eine Aussage über den Bestand, die niemand geprüft hat.
   * Ohne Fehler bleibt der Bestandswortlaut byte-gleich stehen.
   *
   * KEIN `kein403`: `src/routes/material.rs` ist org-lesbar ohne Admin-Schranke.
   */
  const poolInhalt = nichtGefundenInhalt(poolQuery, {
    allgemein: 'Materialliste konnte nicht geladen werden',
  }) ?? 'Kein Material im Dienst';

  /**
   * Kategoriefilter aus den EIGENEN Daten; `undefined` ohne Werte. Bewusste Folge: das Feld
   * erscheint erst mit dem ersten gepflegten Wert. Ein dauerhaft leeres Filterfeld sieht wie
   * ein Werkzeug aus und ist keins — der Tausch ist gewollt.
   */
  const kategorieWerte = [...new Set(ems.map((m) => m.kategorie).filter((k): k is string => !!k))]
    .sort()
    .map((k) => ({ text: k, value: k }));
  const kategorieFilter = kategorieWerte.length > 0
    ? { werte: kategorieWerte, trifft: (m: EinsatzMaterial, w: string) => m.kategorie === w }
    : undefined;

  /**
   * Spaltenregister der Materialseite (LFH-330 · B2).
   *
   * `EinsatzMaterialAnzeige` hat KEIN `status_kategorie` — 15 Felder, am generierten Typ
   * geprüft. Gruppiert und gefiltert wird deshalb auf der EIGENEN Fünf-Werte-Achse
   * (`MaterialStatus`), nicht auf verfügbar/gebunden/nicht verfügbar. Dieselbe Grenze zieht
   * `filtereKraefte` schon in der Datenschicht. Ein hierher gemapptes Feld wäre erfunden.
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
          {em.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    {
      title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie',
      filter: kategorieFilter, suchText: (m) => m.kategorie, render: (t) => t ?? '—',
    },
    {
      title: 'Menge',
      key: 'menge',
      sortWert: (m) => m.menge,
      render: (_, em) =>
        darfSchreiben
          // `MengeZelle` bleibt unangetastet (samt ihrer Klein-Variante) — ihr Abbau ist
          // LFH-333/B5, nicht dieser Umbau.
          ? <MengeZelle em={em} onChange={(menge) => mengeMutation.mutate({ emId: em.id, menge })} />
          : em.menge,
    },
    {
      title: 'Status',
      key: 'status',
      filter: { werte: STATUS_FILTER_WERTE, trifft: (m, w) => m.status === w },
      // Kein `Select` mehr: `minWidth: 170` war hier sogar breiter als bei Fahrzeug und
      // Personal — die Zahl, an der die 390-px-Karte scheiterte (LFH-339 · C4).
      render: (_, em) => {
        const b = statusBedienungVon(em);
        return (
          <StatusWahl<MaterialStatus>
            darstellung={statusDarstellung(em)}
            aktuell={b.aktuell}
            optionen={STATUS_OPTIONEN}
            kennung={em.bezeichnung}
            onWaehlen={(status) => {
              if (!statusMutation.isPending) statusMutation.mutate({ emId: em.id, status });
            }}
            laeuft={b.laeuft}
            gesperrt={b.gesperrt}
            darfSchreiben={darfSchreiben}
          />
        );
      },
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, em) => (
        <BemerkungZelle
          wert={em.bemerkung}
          kennung={em.bezeichnung}
          darfSchreiben={darfSchreiben}
          onSpeichern={(val) => bemerkungMutation.mutate({ emId: em.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, em: EinsatzMaterial) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(em.id)}>
                {/* Ohne Klein-Variante und ohne `danger`: Rot ist Gefahr, nicht Bedienung. */}
                <Button>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Material' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Material</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
          <Datenstand dataUpdatedAt={emQuery.dataUpdatedAt} />
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Stamm-Material wählen …"
              value={poolAuswahl}
              options={poolOptionen}
              notFoundContent={poolInhalt}
              disabled={disponiereMutation.isPending}
              onChange={(v) => setPoolAuswahl(v ?? null)}
            />
            <InputNumber min={1} value={poolMenge} disabled={disponiereMutation.isPending}
              onChange={(v) => setPoolMenge(v ?? 1)} />
            <Button
              type="primary"
              disabled={poolAuswahl == null}
              loading={disponiereMutation.isPending}
              onClick={() => { if (poolAuswahl != null) disponiereMutation.mutate({ materialId: poolAuswahl, menge: poolMenge }); }}
            >
              Disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      {/* DER STATUS STEHT SEIT LFH-339 · C4 IM `karte.status`-SLOT, nicht mehr als
          Sekundärfeld — hier stand vorher die gegenteilige Regel, und sie ist überholt.

          Was sich geändert hat, ist die ANORDNUNG, nicht die Farbfrage: der Slot trägt ein
          Etikett mit der Rolle `neutral` („ausserhalb des Farbvertrags", siehe
          `statusDarstellung` oben), und `statusBedienung` macht es zum Auslöser. Damit ist
          der Statuswechsel auf der 390-px-Karte überhaupt erst erreichbar — als
          Sekundärfeld war er reine Anzeige. Die frühere Begründung stimmte in ihrer
          Prämisse (Material liegt ausserhalb von A2) und zog daraus den zu weiten Schluss:
          die Zielform-Spec §4 trennt Farbe von Anordnung.

          `titel` ohne `ziel`: Material hat keine Detailroute. */}

      {/* KEIN Katalog-Banner auf dieser Seite, und das ist gemessen statt vergessen: der
          Materialstatus ist das lokale Enum `MaterialStatus` (`STATUS_META`, fünf Werte).
          Er kommt nicht über die Leitung und kann deshalb nicht ausfallen — anders als der
          Statuskatalog der Fahrzeug- und Personalseite. Eine Meldung „Statuskatalog konnte
          nicht geladen werden" wäre hier ein erfundener Fehlerfall.

          Der Listenfehler tauscht die Datensicht aus, statt durch sie hindurchgereicht zu
          werden (D3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps` kennt
          keinen Fehlerbegriff — ein Prop am Primitiv wirkte nur in einer der beiden Formen. */}
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
        gruppen={{
          schluessel: (m) => m.status,
          etikett: (w) => STATUS_META[w as MaterialStatus]?.label ?? w,
          reihenfolge: STATUS_REIHENFOLGE,
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'bezeichnung' },
          status: (em) => statusDarstellung(em),
          statusBedienung: (em) => (darfSchreiben ? statusBedienungVon(em) : null),
          // Nur noch zwei Sekundärfelder: `status` ist in den Slot darüber gewandert und
          // stünde sonst doppelt auf der Karte.
          sekundaer: ['kategorie', 'menge'],
          aktion: darfSchreiben
            ? {
                etikett: 'Entfernen',
                bestaetigung: 'Aus Einsatz entfernen?',
                onKlick: (em) => entfernenMutation.mutate(em.id),
              }
            : undefined,
        }}
      />
      </>
      )}

      {/**
        * Ad-hoc-Erfassung auf der Schnellerfassungs-Hülle (LFH-332 · B4).
        *
        * SERIENMODUS, weil Ad-hoc-Material stückweise nachkommt: eine Spende-Palette ist
        * selten eine Position. „Speichern und nächste" hält den Dialog offen, zählt und
        * setzt den Fokus zurück auf die Bezeichnung.
        *
        * WERTÜBERNAHME auf Kategorie und Trägerorganisation — die beiden Felder, die über
        * eine ganze Anlieferung hinweg gleich bleiben. Sie stehen deshalb HINTEN: was sich
        * je Position ändert (Bezeichnung, Menge), kommt zuerst; die stehenbleibenden Werte
        * überspringt der Tabulatorlauf danach ohnehin, weil sie schon gefüllt sind.
        *
        * FELDBUDGET: höchstens vier sichtbare Felder. Die Bestandsnummer ist das fünfte —
        * bei ad-hoc erfasstem Material (Spenden, Fremdmaterial) gibt es sie meistens gar
        * nicht. Sie liegt unter „Weitere Angaben" mit `forceRender`.
        *
        * WAS `forceRender` HIER TUT, gemessen per Mutationsprobe (Prop entfernt, Tests
        * gefahren): es registriert das Feld ab dem ersten Bild im Formular, statt erst beim
        * ersten Aufklappen. Was es NICHT tut: den eingetippten Wert retten. Der überlebt das
        * Zuklappen auch ohne die Prop — antd baut den Bereich nicht ab (`destroyOnHidden`
        * ist aus) und hielte den Wert selbst dann noch (`Form.Item` bewahrt per Vorgabe).
        * Ohne die Prop fiel genau ein Test: der, der das Feld VOR dem ersten Aufklappen im
        * Baum sucht. Die naheliegende Begründung „sonst ist der Wert weg" wäre also falsch
        * gewesen und steht deshalb nicht hier.
        */}
      <ErfassungsModal<MaterialAdhocEingabe & { menge: number }>
        offen={adhocOffen}
        titel="Ad-hoc-Material disponieren"
        form={form}
        erfassenText="Disponieren"
        serie
        uebernahme={['kategorie', 'traegerorganisation']}
        initialValues={{ menge: 1 }}
        laeuft={adhocMutation.isPending}
        // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage lässt die Hülle die
        // eingetippten Werte stehen. Den Fehlertext meldet weiterhin `onError`.
        onErfassen={async (w) => { await adhocMutation.mutateAsync(w); }}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. Spende-Decken" />
        </Form.Item>
        <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item label="Kategorie" name="kategorie"><Input /></Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input placeholder="z. B. THW" /></Form.Item>
        <Collapse
          ghost
          items={[{
            key: 'weitere',
            label: 'Weitere Angaben',
            forceRender: true,
            children: (
              <Form.Item label="Bestandsnummer" name="bestandsnummer" style={{ marginBottom: 0 }}>
                <Input />
              </Form.Item>
            ),
          }]}
        />
      </ErfassungsModal>
    </div>
  );
}
