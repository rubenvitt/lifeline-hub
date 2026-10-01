import { Alert, Breadcrumb, Button, Flex, Form, Input, Space, Tag, Typography, theme } from 'antd';
import { Augenbraue, Segmentleiste, StatusChip } from '../components/instrument';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
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
import { ErfassungsModal } from '../components/Erfassung';
import FormularEingehaengt from '../components/FormularEingehaengt';
import { useFormularEingehaengt } from '../components/useFormularEingehaengt';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { tiereDetailPfad } from '../routing/deeplinks';
import { SPEZIES_META, TIER_STATUS, filterTiere, type TiereSicht } from './tiere/tierHelfer';
import type { Spezies, Tier } from '../api/types';
import StatusTag from '../components/StatusTag';
import { einsatzStatus } from '../theme/statusFarben';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { useFrischAngelegt } from '../components/useFrischAngelegt';
import { registrierNummer } from '../anzeige/registrierNummer';
import { useCsvExport } from '../components/useCsvExport';
import { SpeicherFehler } from '../components/SpeicherHinweis';

const STATUS_META = TIER_STATUS;

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
  return t.halter_registrier_nr != null ? registrierNummer('R', t.halter_registrier_nr) : null;
}

/** Halter-Kurzanzeige für die Liste. */
function halterAnzeige(t: Tier): React.ReactNode {
  const label = halterNummer(t);
  if (label != null) {
    return t.halter_storniert_at ? (
      <Typography.Text type="secondary">Halter (storniert): {label}</Typography.Text>
    ) : (
      <Tag color="blue">{label}</Tag>
    );
  }
  if (t.halter_kontakt) return <Typography.Text>{t.halter_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">unbekannt</Typography.Text>;
}

/**
 * Das eine Spaltenregister der Tierliste. Modulkonstante, weil kein `render` Komponentenzustand
 * liest; durch `spaltenFuer<Tier>()` geführt, nie annotiert — eine Annotation weitete die
 * Schlüsselliterale auf `string`.
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
    render: (_, t) => (
      <StatusChip ton={STATUS_META[t.status].ton} wort={STATUS_META[t.status].label} />
    ),
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
    title: 'Antreffort',
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
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [sichtNachEinsatz, setSichtNachEinsatz] = useState<Record<number, Sicht>>({});
  const [speziesNachEinsatz, setSpeziesNachEinsatz] = useState<Record<number, Spezies | undefined>>(
    {},
  );
  const [highlight, setHighlight] = useState<{ einsatzId: number; tierId: number } | null>(null);
  const aktuellerEinsatzRef = useRef(einsatzId);
  aktuellerEinsatzRef.current = einsatzId;
  const sicht = sichtNachEinsatz[einsatzId] ?? 'aktiv';
  const speziesFilter = speziesNachEinsatz[einsatzId];

  const setSichtFuer = (zielEinsatzId: number, neueSicht: Sicht) => {
    setSichtNachEinsatz((alt) => ({ ...alt, [zielEinsatzId]: neueSicht }));
  };
  const setSpeziesFuer = (zielEinsatzId: number, spezies: Spezies | undefined) => {
    setSpeziesNachEinsatz((alt) => ({ ...alt, [zielEinsatzId]: spezies }));
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
    wert: 'schnell' | 'vermisst';
  } | null>(null);
  const aktuellerModus = modus?.einsatzId === einsatzId ? modus.wert : null;
  const [form] = Form.useForm<TierEingabe>();
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
    const ort = liesErfassungsSitzungswert(einsatzId, 'tier', 'antreff_ort');
    form.setFieldValue('antreff_ort', ort);
  }, [aktuellerModus, einsatzId, form, formular.da, formular.jeDa]);

  // Schnellaktion: ?neu=1 öffnet die Schnellerfassung (Sprungpalette, LFH-506). Warten bis der
  // Einsatz geladen ist; Param immer löschen, Maske nur bei Schreibrecht. Eine Kopie statt
  // In-place-Mutation, sonst sähe der zweite StrictMode-Durchlauf den Parameter nicht mehr.
  const [searchParams, setSearchParams] = useSearchParams();
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setModus({ einsatzId, wert: 'schnell' });
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh, einsatzId]);

  const fehler = useFehlerMeldung();
  const csvExport = useCsvExport(einsatzId, 'tiere', ladeTiereExport);
  const { token } = theme.useToken();

  useEffect(() => {
    if (highlight?.einsatzId !== einsatzId) return;
    scrolleZurZeile(highlight.tierId);
  }, [highlight, einsatzId, sicht]);

  /**
   * Anlegen. `onSuccess` invalidiert nur — Schließen macht `onFertig` der Erfassungshülle, Leeren
   * die Hülle auf allen Wegen; ein `resetFields` hier leerte im Serienlauf auch die übernommenen
   * Werte. `onError` bleibt: die Fehlermeldung kommt von der Mutation, die Hülle sieht nur die
   * Ablehnung und lässt den Wortlaut stehen.
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
      setSpeziesFuer(variablen.einsatzId, undefined);
      qc.invalidateQueries({ queryKey: einsatzKeys.tiere(variablen.einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(variablen.einsatzId) });
    },
    onError: (e, variablen) => {
      if (aktuellerEinsatzRef.current === variablen.einsatzId) fehler(e);
    },
  });

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const nurAnsicht = !darfSchreiben && einsatz.status !== 'aktiv';

  const alle = frischAngelegt.alle;
  const tiere = filterTiere(alle, { sicht, spezies: speziesFilter });

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
  const standVeraltet = tiereQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      dataUpdatedAt={tiereQuery.dataUpdatedAt}
      meta={tiereQuery.isSuccess ? `${tiereQuery.data.length} Tiere` : undefined}
      titel={
        <Space>
          Tiere
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Tiere' },
          ]}
        />
      }
      aktionen={
        <Space wrap style={{ minWidth: 0 }}>
          {darfSchreiben && (
            <>
              <Button type="primary" onClick={() => setModus({ einsatzId, wert: 'schnell' })}>
                Schnellerfassung
              </Button>
              <Button onClick={() => setModus({ einsatzId, wert: 'vermisst' })}>
                Vermisst melden
              </Button>
            </>
          )}
          {/* Öffnet eine Datei, sendet nichts ab — deshalb im Kopf (LFH-346). Ohne Schreib-Riegel:
              der Endpunkt verlangt nur den Lesezugriff, den schon die Liste braucht. */}
          <Button loading={csvExport.laeuft} onClick={csvExport.exportieren}>
            CSV exportieren
          </Button>
        </Space>
      }
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette) — mit demselben
      // Rechte-Riegel wie der Knopf.
      neueZeile={darfSchreiben ? () => setModus({ einsatzId, wert: 'schnell' }) : undefined}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (nurAnsicht || csvExport.fehler != null) && (
          <Flex vertical gap={token.marginSM}>
            {nurAnsicht && (
              <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
            )}
            <SpeicherFehler
              fehler={csvExport.fehler}
              titel="Export fehlgeschlagen"
              fallback="Keine Antwort vom Server — bitte erneut versuchen"
            />
          </Flex>
        )
      }
    >
      {/* Sicht und Spezies als eine Filterzeile. Eine Wahl, die die Liste darunter filtert —
          `radiogroup`, nicht `tablist`: es gibt kein eigenes Feld je Segment. */}
      <Space wrap size="middle" align="center" style={{ marginBottom: 12 }}>
        <Segmentleiste
          beschriftung="Tiere nach Status filtern"
          wert={sicht}
          onWechsel={(k) => setSichtFuer(einsatzId, k)}
          optionen={SICHTEN.map((s) => ({ wert: s.key, label: s.label }))}
        />
        <Augenbraue>Spezies</Augenbraue>
        {/* `aria-label`, weil die `Typography.Text` daneben kein `<label>` ist: ohne ihn hätte
            das Feld keinen zugänglichen Namen. */}
        <Select<Spezies | undefined>
          aria-label="Spezies"
          allowClear
          placeholder="alle"
          style={{ width: 180 }}
          value={speziesFilter}
          onChange={(v) => setSpeziesFuer(einsatzId, v)}
          options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))}
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
             * Der Remount trifft allen Zustand des Primitivs (`suchbegriff`, `eigeneSortierung`,
             * `eigeneSpaltenAus`, `schleuse`); getrennt abschaltbar ist nichts. Hier ist der Preis
             * klein: `tierSpalten` ist eine Modulkonstante, und keine Spalte trägt ein `filter`.
             *
             * Spezies bewusst nicht im Schlüssel: sie ist die innere, häufig getastete Achse
             * (`filterTiere` bildet die Schnittmenge aus Status und Spezies), Suche und Spezies
             * werden zusammen gestellt. Ein Remount daran löschte den eben getippten Begriff. Der
             * Reiter wechselt das Arbeitsfach, die Spezies engt darin ein.
             *
             * Der Guard (`components/datensicht.guard.test.ts`) prüft nur, ob der Schlüssel die
             * Schalterachse `sicht` nennt; die Spezies-Frage entscheidet er nicht.
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
            // oben. Die Sortierung liegt im Client, der Sortierpfeil dreht sie ohne Nachladen um.
            standardSortierung={{ spalte: 'reg', richtung: 'ab' }}
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
          Antreffort ist die Sammelstelle selbst, und die Spezies müsste sonst je Tier neu
          gewählt werden (das Zurücksetzen fiele auf `initialValues` = 'hund'). Die übrigen
          Felder beschreiben das einzelne Tier.

          Der sitzungsweite Antreffort ist ein eigener Vertrag: nach erfolgreicher Mutation
          einsatz- und maskenbezogen gemerkt und beim Öffnen einmal eingesetzt. Er gehört nicht
          zu `initialValues`, damit ein Serien-Reset bei ausgeschaltetem Schalter leer bleibt.

          `status` steht nicht im Formular: er kommt aus dem Modus, mit dem der Dialog geöffnet
          wurde; die Ableitung sitzt in `onErfassen`. */}
      <ErfassungsModal<TierEingabe>
        offen={aktuellerModus !== null}
        titel={aktuellerModus === 'vermisst' ? 'Vermisst melden' : 'Schnellerfassung'}
        form={form}
        laeuft={anlegenMutation.isPending && anlegenMutation.variables?.einsatzId === einsatzId}
        initialValues={{ spezies: 'hund' }}
        serie
        uebernahme={['spezies', 'antreff_ort']}
        onErfassen={async (daten) => {
          // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage hält die Felder stehen.
          await anlegenMutation.mutateAsync({
            einsatzId,
            daten: {
              ...daten,
              status: aktuellerModus === 'vermisst' ? 'vermisst' : 'aktiv',
            },
          });
        }}
        onErfasst={(daten) => {
          // Erst die zentrale Post-Acceptance-Stufe darf den Sitzungswert ändern: ein Abbruch
          // während des POST besteht die Generation davor nicht.
          if (typeof daten.antreff_ort === 'string') {
            schreibeErfassungsSitzungswert(einsatzId, 'tier', 'antreff_ort', daten.antreff_ort);
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
        <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung">
          <Input placeholder="z. B. Haflinger, Deutscher Schäferhund" />
        </Form.Item>
        <Form.Item label="Antreffort" name="antreff_ort">
          <Input placeholder="z. B. Weide, Sammelstelle" />
        </Form.Item>
        {aktuellerModus === 'vermisst' && (
          <>
            <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung">
              <Input />
            </Form.Item>
            <Form.Item label="Kennzeichnung (Chip/Tätowierung/Halsband)" name="kennzeichnung">
              <Input />
            </Form.Item>
            <Form.Item label="Halter-Kontakt (Name, Tel.)" name="halter_kontakt">
              <Input placeholder="meldender Halter" />
            </Form.Item>
          </>
        )}
        <Form.Item label="Notiz" name="notiz">
          <Input.TextArea rows={2} />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
