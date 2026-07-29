import { Alert, App, Breadcrumb, Button, Form, Input, Space, Tabs, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { legeTierAn, listeTiere, tierRegistrierAnzeige, type TierEingabe } from '../api/einsatzTier';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { tiereDetailPfad } from '../routing/deeplinks';
import { filterTiere, type TiereSicht } from './tiere/tierHelfer';
import type { Spezies, Tier, TierStatus } from '../api/types';

const STATUS_META: Record<TierStatus, { label: string; color: string }> = {
  aktiv: { label: 'aktiv', color: 'green' },
  vermisst: { label: 'vermisst', color: 'orange' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

const SPEZIES_META: Record<Spezies, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};
const SPEZIES_KEYS = Object.keys(SPEZIES_META) as Spezies[];

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = TiereSicht;
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'aktiv', label: 'Aktiv' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

/** Registriernummer des Halters in Anzeigeschreibweise, oder `null`. */
function halterNummer(t: Tier): string | null {
  return t.halter_registrier_nr != null
    ? `R-${String(t.halter_registrier_nr).padStart(3, '0')}`
    : null;
}

/** Halter-Kurzanzeige für die Liste. */
function halterAnzeige(t: Tier): React.ReactNode {
  const label = halterNummer(t);
  if (label != null) {
    return t.halter_storniert_at
      ? <Typography.Text type="secondary">Halter (storniert): {label}</Typography.Text>
      : <Tag color="blue">{label}</Tag>;
  }
  if (t.halter_kontakt) return <Typography.Text>{t.halter_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">unbekannt</Typography.Text>;
}

/**
 * Das EINE Spaltenregister der Tierliste (LFH-330 · B2). Modulkonstante, weil kein `render`
 * Komponentenzustand liest — und durch `spaltenFuer<Tier>()` geführt, nie annotiert: eine
 * Annotation weitete die Schlüsselliterale auf `string`, und der Kartenplan nähme danach
 * jeden Tippfehler unbemerkt an.
 */
const tierSpalten = spaltenFuer<Tier>()([
  {
    title: 'Reg.-Nr.',
    key: 'reg',
    width: 90,
    immerSichtbar: true,
    // Über die ZAHL sortiert — über den Text läge „T-10" vor „T-9".
    sortWert: (t) => t.registrier_nr,
    suchText: (t) => tierRegistrierAnzeige(t.registrier_nr),
    // KEIN Anker: den Titel-Link setzt der Kartenplan über `titel.ziel`, in beiden Zweigen.
    render: (_, t) => <Typography.Text strong>{tierRegistrierAnzeige(t.registrier_nr)}</Typography.Text>,
  },
  {
    title: 'Status',
    key: 'status',
    width: 130,
    render: (_, t) => <Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>,
  },
  { title: 'Spezies', key: 'spezies', width: 120, render: (_, t) => SPEZIES_META[t.spezies] },
  {
    title: 'Rufname',
    key: 'rufname',
    suchText: (t) => t.rufname,
    render: (_, t) => t.rufname ?? <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Rasse',
    dataIndex: 'rasse_beschreibung',
    key: 'rasse',
    abBreite: 'lg',
    suchText: (t) => t.rasse_beschreibung,
    render: (r) => r ?? '—',
  },
  {
    title: 'Halter',
    key: 'halter',
    // Beide Halter-Wege tragen zur Suche bei: die verknüpfte Person über ihre R-Nummer, der
    // frei erfasste Kontakt über seinen Text.
    suchText: (t) => halterNummer(t) ?? t.halter_kontakt,
    render: (_, t) => halterAnzeige(t),
  },
  {
    title: 'seit',
    key: 'seit',
    /**
     * ABWEICHUNG von der Personenliste, und sie ist keine Nachlässigkeit: `TierAnzeige`
     * trägt weder Sichtungskategorie noch Sichtungszeitpunkt (verifiziert am generierten
     * Typ; die Rust-Doku nennt das Modul „bewusst schlank — keine Sichtungskette wie bei
     * Personen"). Für Tiere gibt es deshalb KEINE Dringlichkeitssortierung, sondern nur
     * „seit" aus `erfasst_at`.
     *
     * `geaendert_at` wäre der naheliegende und falsche Griff: es läuft bei jeder Notiz
     * weiter und beantwortet „wann wurde der Satz zuletzt angefasst", nicht „seit wann ist
     * das Tier erfasst".
     *
     * Keine Breitenschwelle: die Zeitachse ist der Zweck dieser Änderung, und eine Spalte,
     * die schon unter 1200 px verschwindet, wäre in jeder jsdom-Prüfung abwesend.
     */
    sortWert: (t) => t.erfasst_at,
    render: (_, t) => <ZeitAnzeige wert={t.erfasst_at} />,
  },
  {
    title: 'Antreffort',
    dataIndex: 'antreff_ort',
    key: 'antreff_ort',
    abBreite: 'xl',
    render: (t) => t ?? '—',
  },
]);

type TierSpaltenKey = (typeof tierSpalten)[number]['key'];

/**
 * Kartenplan der Tierliste. KEIN `status`-Slot: `TierStatus` steht nicht im
 * A2-Statusfarbvertrag (`theme/statusFarben.ts` führt diese Seite ausdrücklich als bewusst
 * draußen), und ihn hineinzuziehen wäre der von A2 verbotene Bestands-Sweep. Der Status
 * steht deshalb als Sekundärfeld — mit Etikett, also mit zweitem Kanal.
 */
const tierKarte = (einsatzId: number): Kartenplan<Tier, TierSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (t) => tiereDetailPfad(einsatzId, t.id) },
  sekundaer: ['rufname', 'status', 'seit'],
});

export default function TierePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('aktiv');
  const [speziesFilter, setSpeziesFilter] = useState<Spezies | undefined>(undefined);

  // Tier-Liste wird über den konsolidierten Einsatz-Live-Stream (useEinsatzLiveStream
  // im EinsatzLayout, `tier`-Event → 'einsatz-tiere') live gehalten — LFH-75.
  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const tiereQuery = useQuery({ queryKey: einsatzKeys.tiere(einsatzId), queryFn: () => listeTiere(einsatzId) });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst'>(null);
  const [form] = Form.useForm<TierEingabe>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  /**
   * Anlegen. `onSuccess` invalidiert nur noch (LFH-332 · B4) — Schliessen macht `onFertig`
   * der Erfassungshülle, Leeren macht die Hülle auf BEIDEN Wegen (Erfassen und Abbrechen).
   * Ein hier verbliebenes `resetFields` wäre doppelt und leerte im Serienlauf auch die
   * übernommenen Werte. `onError` bleibt: die Fehlermeldung kommt weiterhin von der Mutation,
   * die Hülle sieht nur die Ablehnung und lässt den Wortlaut stehen.
   */
  const anlegenMutation = useMutation({
    mutationFn: (v: TierEingabe) => legeTierAn(einsatzId, v),
    onSuccess: () => { invalidate(); },
    onError: fehler,
  });

  /**
   * SEITENZUSTAND — nur `einsatzQuery` (LFH-331 · B3, D3): Breadcrumb, Titelzeile und
   * `darfImEinsatzSchreiben(...)` hängen an ihr, ohne sie gibt es keinen Rahmen. Deshalb
   * hier ein Frühausstieg — und NUR hier. Der Wortlaut ist byte-gleich zum Bestand.
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

  const alle = tiereQuery.data ?? [];
  const tiere = filterTiere(alle, { sicht, spezies: speziesFilter });

  /**
   * LISTENZUSTAND — an der Stelle der Liste entschieden, nie als Frühausstieg (D3).
   *
   * Gemessen wird an `alle`, NICHT an `tiere`: die gefilterte Menge ist bei gesetztem
   * Reiter oder Spezies-Filter regelmäßig leer, während Zeilen im Zwischenspeicher stehen —
   * an ihr gemessen kippte die Seite bei jedem engen Filter in den Fehlerzweig und nähme dem
   * Bediener die Schalter, mit denen er ihn wieder aufmachen könnte.
   *
   * Ohne Zeilen tritt der Fehler an die Stelle der Sicht, sonst behauptet „Keine Tiere in
   * dieser Sicht" eine leere Menge, wo bloß der Abruf scheiterte. Mit Zeilen bleiben sie
   * stehen und bekommen ein Banner: echt, nur womöglich alt. Der Ladezweig steht bewusst
   * nicht hier, sondern am Primitiv (`ladend`).
   */
  const listeGescheitert = tiereQuery.isError && alle.length === 0;
  const standVeraltet = tiereQuery.isError && alle.length > 0;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Tiere' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Tiere</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
          </Space>
        )}
      </Space>

      <Tabs activeKey={sicht} onChange={(k) => setSicht(k as Sicht)} items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))} />

      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">Spezies:</Typography.Text>
        {/* `aria-label`, weil die `Typography.Text` daneben kein `<label>` ist (kein `htmlFor`,
            keine Umschließung): ohne ihn hat das Feld keinen zugänglichen Namen und ist nur
            solange eindeutig auffindbar, wie es die einzige Combobox der Seite ist. */}
        <Select<Spezies | undefined> aria-label="Spezies" allowClear placeholder="alle" style={{ width: 180 }}
          value={speziesFilter} onChange={(v) => setSpeziesFilter(v)}
          options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

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
             * Vier Reiter, EINE Sichtstelle — der Schlüssel trägt deshalb die Statusachse.
             * Ohne ihn steht dieselbe Instanz über allen vier Mengen: React sieht denselben
             * Komponententyp an derselben Baumstelle und montiert nicht neu, sondern reicht
             * weiter. Der Suchbegriff lebt IM Primitiv (`suchbegriff` in `Datensicht.tsx`) und
             * filtert danach eine Menge, für die er nie gemeint war — im Reiter „Vermisst" nach
             * einem Rufnamen gesucht, auf „Alle" gewechselt, und dort steht eine fremde Menge auf
             * diesen Rufnamen zusammengestrichen. Kein Fehler, keine Warnung, nur fehlende
             * Zeilen. Dieselbe Falle wurde an `PersonenPage` gemessen und dort ebenso behoben.
             *
             * Der Preis, und er ist hier kleiner als dort: der Remount trifft ALLEN Zustand des
             * Primitivs — `suchbegriff` (den wollen wir), `eigeneSortierung`, `eigeneSpaltenAus`,
             * `schleuse`. Das ist die Folge des Schlüssels, keine Auswahl; getrennt abschaltbar
             * ist nichts davon. Die Sortierung ist dabei reines Beiwerk: `tierSpalten` ist EINE
             * Modulkonstante über allen vier Reitern, ein Zurückfallen auf `standardSortierung`
             * wäre also verzichtbar. Und `filterWerte` ist auf dieser Seite ohnehin tot — keine
             * Spalte von `tierSpalten` trägt ein `filter`. Der Spaltenauswahl-Grund aus
             * `PersonenPage` (je Reiter eine andere Spaltenliste) gilt hier NICHT und wird
             * deshalb auch nicht behauptet.
             *
             * SPEZIES BEWUSST NICHT im Schlüssel, obwohl sie die Zeilenmenge genauso
             * mitbestimmt. Sie ist die INNERE, häufig getastete Achse: `filterTiere`
             * (`tiere/tierHelfer.ts`) bildet die Schnittmenge aus Status und Spezies, und der
             * Suchplatzhalter unten nennt Rufname und Rasse — Suche und Spezies werden zusammen
             * gestellt. Ein Remount an dieser Achse löschte den Begriff, den der Bediener eine
             * Handlung vorher getippt hat, und wegen `allowClear` ein zweites Mal beim
             * Zurücknehmen der Einengung. Der Reiter wechselt das Arbeitsfach, die Spezies engt
             * darin ein; nur das Erste rechtfertigt das Wegwerfen.
             *
             * Der Guard (`components/datensicht.guard.test.ts`) entscheidet die Spezies-Frage
             * NICHT: er prüft allein, ob der Schlüssel die Schalterachse `sicht` nennt — beide
             * Varianten kämen durch. Die Entscheidung oben steht auf der Sache, nicht am Gate.
             */
            key={sicht}
            bezeichnung="Tiere im Einsatz"
            spalten={tierSpalten}
            daten={tiere}
            zeilenSchluessel="id"
            ladend={tiereQuery.isLoading}
            leerText="Keine Tiere in dieser Sicht"
            suche={{ platzhalter: 'T-Nr., Rufname, Rasse' }}
            // Spiegelt die Backend-Ordnung (`ORDER BY t.registrier_nr DESC`): das jüngste Tier
            // oben. Die Sortierung liegt jetzt trotzdem im Client — der Sortierpfeil der Spalte
            // dreht sie um, ohne einen Nachladevorgang.
            standardSortierung={{ spalte: 'reg', richtung: 'ab' }}
            onZeileKlick={(t) => navigate(tiereDetailPfad(einsatzId, t.id))}
            karte={tierKarte(einsatzId)}
          />
        </>
      )}

      {/**
        * SERIENMODUS (LFH-332 · B4). An einer Sammelstelle kommen die Tiere in Serie an —
        * ein Dialog, der nach jedem Satz zufällt, kostet dort je Tier einen Klick auf
        * „Schnellerfassung" und einen weiteren in das erste Feld.
        *
        * `uebernahme` trägt genau die zwei Felder, die sich an einer Sammelstelle NICHT
        * ändern: der Antreffort ist die Sammelstelle selbst, und wer eine Reihe Nutzgeflügel
        * aufnimmt, wählt die Spezies sonst zwanzigmal neu (das Zurücksetzen fiele auf
        * `initialValues` = 'hund' zurück). Die übrigen Felder — Rufname, Rasse, Farbe,
        * Kennzeichnung, Halter-Kontakt, Notiz — beschreiben das EINZELNE Tier; sie
        * mitzunehmen hiesse, den vorigen Satz zu wiederholen.
        *
        * `status` steht bewusst nicht im Formular: er kommt aus dem Modus, mit dem der
        * Dialog geöffnet wurde, und die Ableitung sitzt deshalb in `onErfassen`.
        */}
      <ErfassungsModal<TierEingabe>
        offen={modus !== null}
        titel={modus === 'vermisst' ? 'Vermisst melden' : 'Schnellerfassung'}
        form={form}
        laeuft={anlegenMutation.isPending}
        initialValues={{ spezies: 'hund' }}
        serie
        uebernahme={['spezies', 'antreff_ort']}
        onErfassen={async (daten) => {
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          await anlegenMutation.mutateAsync({
            ...daten,
            status: modus === 'vermisst' ? 'vermisst' : 'aktiv',
          });
        }}
        onFertig={() => setModus(null)}
        onAbbrechen={() => setModus(null)}
      >
        <Form.Item label="Spezies" name="spezies" rules={[{ required: true, message: 'Bitte Spezies wählen' }]}>
          <Select options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
        </Form.Item>
        <Form.Item label="Rufname" name="rufname"><Input /></Form.Item>
        <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung"><Input placeholder="z. B. Haflinger, Deutscher Schäferhund" /></Form.Item>
        <Form.Item label="Antreffort" name="antreff_ort"><Input placeholder="z. B. Weide, Sammelstelle" /></Form.Item>
        {modus === 'vermisst' && (
          <>
            <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung"><Input /></Form.Item>
            <Form.Item label="Kennzeichnung (Chip/Tätowierung/Halsband)" name="kennzeichnung"><Input /></Form.Item>
            <Form.Item label="Halter-Kontakt (Name, Tel.)" name="halter_kontakt"><Input placeholder="meldender Halter" /></Form.Item>
          </>
        )}
        <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
      </ErfassungsModal>
    </div>
  );
}
