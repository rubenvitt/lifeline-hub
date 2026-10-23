import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { FormRule } from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Datenfeld,
  DatenfeldEingabe,
  Datenraster,
  Paneel,
  StatusChip,
  monoStil,
} from '../components/instrument';
import { SPEZIES_META, TIER_STATUS, TIER_VERBLEIB, halterVorbelegung } from './tiere/tierHelfer';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { Select } from '../components/Select';
import { SeitenFehler } from '../components/SeitenZustand';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import {
  aktualisiereTier,
  ladeTier,
  setzeTierStatus,
  storniereTier,
  tierRegistrierAnzeige,
  type TierPatch,
} from '../api/einsatzTier';
import { istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { parseRouteId, personDetailPfad, tierePfad } from '../routing/deeplinks';
import type { AbschlussGrund, Tier, TierStatus } from '../api/types';
import HalterPicker, { type HalterWert } from '../personen/HalterPicker';
import TierAnhaenge from './tiere/TierAnhaenge';
import TierVerortung from './tiere/TierVerortung';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../anzeige/Ortsfeld';
import { ortFelder, ortsfeldAusGespeichert } from '../anzeige/ortsfeldFormular';
import { useEditSitzung, type CasBasis } from '../components/useEditSitzung';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { ErfassungsModal } from '../components/Erfassung';
import { registrierNummer } from '../anzeige/registrierNummer';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';

/**
 * Formularwerte der Bearbeiten-Maske: der Patch plus die zusammengesetzte Halter-Auswahl, die erst
 * beim Absenden in das XOR-Feldpaar zerlegt wird.
 */
/**
 * Formularwerte: der Fundort ist ein Ortsfeld (LLH-1114) mit Text und Koordinate; beides geht über
 * `ortFelder` hinaus, die Koordinate nur neben einem Text (LLH-1123: als Paar).
 */
type TierFormWerte = Omit<TierPatch, 'antreff_ort' | 'antreff_lat' | 'antreff_lon'> & {
  halter?: HalterWert | null;
  antreff_ort?: OrtsfeldWert;
};

const STATUS_META = TIER_STATUS;

/** Obergrenze des geschätzten Alters in Jahren. */
const ALTER_MAX = 120;

/**
 * Als Regel, NICHT als `max` am `InputNumber`: das klemmte still auf die Grenze (LLH-1101, gleiche
 * Regelform wie `hoechstensRegel` in `betreuung/BetreuungDialoge.tsx`). Die Meldung steht am Feld.
 */
const alterRegel: FormRule = {
  type: 'number',
  max: ALTER_MAX,
  message: `Höchstens ${ALTER_MAX} Jahre`,
};

/** Nach unten ebenso als Regel statt still geklemmt (`min` am Feld), wie bei den Personendaten. */
const alterMindestensRegel: FormRule = {
  type: 'number',
  min: 0,
  message: 'Mindestens 0 Jahre',
};

/** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
function naechsteStatus(aktuell: TierStatus): TierStatus[] {
  switch (aktuell) {
    case 'aktiv':
      return ['vermisst', 'abgeschlossen'];
    case 'vermisst':
      return ['aktiv', 'abgeschlossen'];
    case 'abgeschlossen':
      return ['aktiv', 'vermisst'];
  }
}

/**
 * Eine Aktion des Seitenkopfs (LLH-1105). Deskriptor statt `ReactNode`, damit dieselbe Beschreibung
 * als Primärknopf oder als Menüeintrag erscheint und die Rangfolge an einer Stelle entschieden wird
 * (Muster `PersonenDetailPage`).
 */
type Kopfaktion =
  | { art: 'verbleib'; key: string; label: string }
  | { art: 'status'; key: string; label: string; status: TierStatus }
  | { art: 'stornieren'; key: string; label: string; gefahr: true };

/** Knopftext je Übergang: die Handlung, nie das Statuswort (LFH-959, `frontend/AGENTS.md`). */
function statusHandlung(von: TierStatus, nach: TierStatus): string {
  if (nach === 'vermisst') return 'Als vermisst melden';
  return von === 'vermisst' ? 'Aufgefunden' : 'Wieder aufnehmen';
}

/**
 * Was der Kopf je Zustand anbietet (LLH-1105): genau eine Primäraktion — der Weg aus dem Zustand
 * heraus (offen → Verbleib erfassen, vermisst → Aufgefunden, abgeschlossen → Wieder aufnehmen) —,
 * die übrigen Übergänge und Stornieren im Menü. Aus `naechsteStatus` abgeleitet, damit kein
 * Übergang verloren geht, den der Server erlaubt.
 */
function kopfplan(status: TierStatus): { primaer: Kopfaktion; weitere: Kopfaktion[] } {
  const uebergaenge = naechsteStatus(status).map((s): Kopfaktion =>
    s === 'abgeschlossen'
      ? { art: 'verbleib', key: 'verbleib', label: 'Verbleib erfassen' }
      : { art: 'status', key: `status:${s}`, label: statusHandlung(status, s), status: s },
  );
  const primaerKey = status === 'aktiv' ? 'verbleib' : 'status:aktiv';
  const primaer = uebergaenge.find((a) => a.key === primaerKey)!;
  const stornieren: Kopfaktion = {
    art: 'stornieren',
    key: 'stornieren',
    label: 'Stornieren',
    gefahr: true,
  };
  return { primaer, weitere: [...uebergaenge.filter((a) => a !== primaer), stornieren] };
}

/** Halter-Kurzanzeige. */
function halterAnzeige(t: Tier): ReactNode {
  if (t.halter_registrier_nr != null) {
    const label = registrierNummer('R', t.halter_registrier_nr);
    return t.halter_storniert_at ? (
      <Typography.Text type="secondary">Halter (storniert): {label}</Typography.Text>
    ) : (
      <Tag>{label}</Tag>
    );
  }
  if (t.halter_kontakt) return <Typography.Text>{t.halter_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">unbekannt</Typography.Text>;
}

export default function TiereDetailPage() {
  const { id, tierId: tierIdParam } = useParams();
  const einsatzId = Number(id);
  const tierId = Number(tierIdParam);
  const idGueltig = parseRouteId(tierIdParam) != null;
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { modal } = App.useApp();
  const [editForm] = Form.useForm<TierFormWerte>();
  const editSitzung = useEditSitzung<TierFormWerte>(editForm);
  // Als `const` herausgezogen, damit TypeScript im Formularzweig auf „Sitzung offen" verengt:
  // `basis` ist dort nicht optional. Mit `editSitzung.sitzung?.basis` wäre der unmögliche Fall
  // still ein Schreiben ohne Lock.
  const sitzung = editSitzung.sitzung;
  const bearbeiten = sitzung != null;
  const speicherLeiste = useSpeicherLeiste({ hasAbbrechen: true });
  // Verlassen-Schutz (LLH-1101, `frontend/AGENTS.md` „Formularseiten“): aktiv, solange die
  // Bearbeiten-Sitzung offen ist. Der `schluessel` hängt an der Sitzung, nicht nur an der ID: eine
  // abgebrochene Eingabe zählt beim nächsten „Bearbeiten“ nicht als offene Änderung.
  const schutz = useFormularVerlassenSchutz({
    aktiv: bearbeiten,
    schluessel: bearbeiten ? tierId : null,
  });
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  // Rückfrage als `<Modal>` außerhalb des Menüs, nicht als `Popconfirm` (`frontend/AGENTS.md`,
  // Aktionen): ein Etikett im Menü ist Text.
  const [stornoOffen, setStornoOffen] = useState(false);
  const [abschlussForm] = Form.useForm<{
    abschluss_grund: AbschlussGrund;
    abschluss_ziel?: string;
  }>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.tier(einsatzId, tierId) });
  }

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.tier(einsatzId, tierId),
    queryFn: () => ladeTier(einsatzId, tierId),
    enabled: idGueltig,
  });

  // Optimistisches Lock: `basis` trägt den beim Öffnen der Maske eingefrorenen geaendert_at-Stand
  // (aus den Live-Query-Daten gelesen hebelte ein Hintergrund-Refetch das Lock aus); ein 409 öffnet
  // den Konfliktdialog, statt still zu überschreiben.
  const editMutation = useMutation({
    // `basis` ist eine `CasBasis` und nur aus `useEditSitzung` zu bekommen: ein blanker
    // `t.geaendert_at` bricht hier den Typcheck.
    mutationFn: (v: { daten: TierPatch; basis?: CasBasis; overwrite?: boolean }) =>
      aktualisiereTier(einsatzId, tierId, v.daten, v.overwrite ? undefined : v.basis),
    onSuccess: () => {
      invalidateDetail();
      editSitzung.beende();
    },
    onError: (e, v) => {
      // Nur der erste 409 (Save mit Baseline) ist der Sperrkonflikt. Die Tier-Route kennt einen
      // zweiten 409, den Storno-Guard vor der CAS, den `overwrite` nicht umgeht. Ein 409 auf den
      // Overwrite zeigt deshalb die Servermeldung, sonst wäre „Überschreiben" ein toter Knopf.
      if (istKonflikt(e) && !v.overwrite) {
        modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content: 'Seit dem Öffnen von jemand anderem gespeichert.',
          okText: 'Überschreiben',
          okButtonProps: { danger: true },
          cancelText: 'Verwerfen und neu laden',
          onOk: () => editMutation.mutate({ daten: v.daten, overwrite: true }),
          onCancel: () => {
            detailQuery.refetch();
            editSitzung.beende();
          },
        });
      }
    },
  });
  const statusMutation = useMutation({
    mutationFn: (v: { status: TierStatus }) =>
      setzeTierStatus(einsatzId, tierId, { status: v.status }),
    onSuccess: invalidateDetail,
  });
  const stornoMutation = useMutation({
    mutationFn: (tid: number) => storniereTier(einsatzId, tid),
    onSuccess: () => {
      invalidate();
      navigate(tierePfad(einsatzId));
    },
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: AbschlussGrund; abschluss_ziel?: string }) =>
      setzeTierStatus(einsatzId, tierId, {
        status: 'abgeschlossen',
        abschluss_grund: v.abschluss_grund,
        abschluss_ziel: v.abschluss_ziel ?? null,
      }),
    // Schliessen und Leeren besorgt die Erfassungshülle (`onFertig`).
    onSuccess: invalidateDetail,
  });

  /*
   * Jede Ablehnung steht an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
   * Fehler“): Bearbeiten am Formular, Status im Seitenhinweis, Verbleib und Storno im Dialog.
   * Den Sperrkonflikt beantwortet weiter der Konfliktdialog, er steht nicht noch am Formular.
   */
  const sperrkonflikt = istKonflikt(editMutation.error) && !editMutation.variables?.overwrite;
  const editFehler = sperrkonflikt ? null : editMutation.error;
  const raeume = (m: { isPending: boolean; error: unknown; reset: () => void }) => {
    if (!m.isPending && m.error != null) m.reset();
  };

  // Die Route hat keinen `key`: der Wechsel zu einem anderen Tier behält die Seite, nicht die
  // Gründe und nicht die Bearbeiten-Sitzung (ihre Werte und ihr Lock-Stand gehören dem vorigen).
  const { reset: editReset } = editMutation;
  const { reset: statusReset } = statusMutation;
  const { reset: stornoReset } = stornoMutation;
  const { beende: beendeSitzung } = editSitzung;
  useEffect(() => {
    editReset();
    statusReset();
    stornoReset();
    beendeSitzung();
    // Dialoge gehören dem Tier, für das sie geöffnet wurden: offen gelassen, schriebe „Verbleib
    // speichern“ den Verbleib des vorigen (samt dessen Halter) an das neue.
    setStornoOffen(false);
    setAbschlussOffen(false);
    abschlussForm.resetFields();
  }, [tierId, editReset, statusReset, stornoReset, beendeSitzung, abschlussForm]);

  // Bad-ID-Guard nach allen Hooks (Rules-of-Hooks): ungültige Route-ID → zurück auf die Liste.
  if (!idGueltig) {
    return <Navigate to={tierePfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = tierePfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <SeitenFehler
        text="Tier konnte nicht geladen werden"
        ursache={detailQuery.error}
        onWiederholen={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Tier nicht gefunden" showIcon />;
  }
  const t = detailQuery.data;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const kennung = tierRegistrierAnzeige(t.registrier_nr);

  // Kein Kopf am stornierten Tier, ohne Schreibrecht und während der Bearbeiten-Sitzung (deren
  // Knöpfe stehen in der Speicherleiste im Formular).
  const plan = darfSchreiben && !t.storniert_at && !bearbeiten ? kopfplan(t.status) : null;
  const laeuftStatus = (aktion: Kopfaktion) =>
    statusMutation.isPending &&
    aktion.art === 'status' &&
    statusMutation.variables?.status === aktion.status;

  function fuehreAus(aktion: Kopfaktion) {
    if (aktion.art === 'verbleib') setAbschlussOffen(true);
    else if (aktion.art === 'stornieren') {
      raeume(stornoMutation);
      setStornoOffen(true);
    } else statusMutation.mutate({ status: aktion.status });
  }

  function starteBearbeiten() {
    raeume(editMutation);
    editSitzung.starte(t, {
      rufname: t.rufname,
      rasse_beschreibung: t.rasse_beschreibung,
      geschlecht: t.geschlecht,
      alter_geschaetzt: t.alter_geschaetzt,
      farbe_beschreibung: t.farbe_beschreibung,
      kennzeichnung: t.kennzeichnung,
      groesse_gewicht: t.groesse_gewicht,
      antreff_ort: ortsfeldAusGespeichert(t.antreff_ort, t.antreff_lat, t.antreff_lon),
      notiz: t.notiz,
      halter:
        t.halter_person_id != null
          ? {
              typ: 'person',
              refId: t.halter_person_id,
              label:
                t.halter_registrier_nr != null
                  ? registrierNummer('R', t.halter_registrier_nr)
                  : 'Halter',
            }
          : t.halter_kontakt
            ? { typ: 'extern', kontakt: t.halter_kontakt }
            : null,
    });
  }

  // Eine Detail-Zelle: im Edit-Modus eine `DatenfeldEingabe` (benanntes Feld, Prüffehler sichtbar
  // darunter, LLH-1101), sonst die Anzeige — dasselbe Datenraster bleibt stehen.
  const zelle = (
    name: keyof TierFormWerte,
    label: string,
    input: ReactElement<{ id?: string }>,
    anzeige: ReactNode,
    {
      mono = false,
      breit = false,
      rules,
    }: { mono?: boolean; breit?: boolean; rules?: FormRule[] } = {},
  ) =>
    bearbeiten ? (
      <DatenfeldEingabe label={label} name={name} rules={rules} breit={breit}>
        {input}
      </DatenfeldEingabe>
    ) : (
      <Datenfeld label={label} mono={mono} breit={breit}>
        {anzeige}
      </Datenfeld>
    );

  const detailAnsicht = (
    <Datenraster spalten={3} beschriftung="Tierdaten">
      {zelle('rufname', 'Rufname', <Input placeholder="Rufname" />, t.rufname ?? '—')}
      {zelle('rasse_beschreibung', 'Rasse / Beschreibung', <Input />, t.rasse_beschreibung ?? '—')}
      {zelle(
        'geschlecht',
        'Geschlecht',
        <Select
          allowClear
          style={{ minWidth: 160 }}
          placeholder="—"
          options={[
            { value: 'maennlich', label: 'männlich' },
            { value: 'weiblich', label: 'weiblich' },
            { value: 'unbekannt', label: 'unbekannt' },
          ]}
        />,
        t.geschlecht ?? '—',
      )}
      {zelle(
        'alter_geschaetzt',
        'Alter in Jahren (geschätzt)',
        <InputNumber />,
        t.alter_geschaetzt ?? '—',
        { mono: true, rules: [alterMindestensRegel, alterRegel] },
      )}
      {zelle('farbe_beschreibung', 'Farbe / Erscheinung', <Input />, t.farbe_beschreibung ?? '—')}
      {zelle(
        'kennzeichnung',
        'Kennzeichnung',
        <Input placeholder="Chip / Tätowierung / Halsband" />,
        t.kennzeichnung ?? '—',
        { mono: true },
      )}
      {zelle('groesse_gewicht', 'Größe / Gewicht', <Input />, t.groesse_gewicht ?? '—')}
      {zelle(
        'antreff_ort',
        'Fundort',
        <EinsatzOrtsfeld einsatzId={einsatzId} etikett="Fundort" />,
        t.antreff_ort ?? '—',
      )}
      {/* Verortung sichtbar machen wie am Schaden (LLH-1123): eine unverortete Lage, die niemand als
          unverortet sieht, ist so gut wie nicht erfasst. Verortet wird über die Karte; im
          Bearbeiten-Modus über das Ortsfeld „Fundort“ (LLH-1114). */}
      {!bearbeiten && (
        <TierVerortung
          einsatzId={einsatzId}
          tier={t}
          darfVerorten={darfSchreiben && !t.storniert_at && t.status !== 'abgeschlossen'}
        />
      )}
      {zelle(
        'halter',
        'Halter',
        <HalterPicker einsatzId={einsatzId} />,
        // Klick auf R-nnn führt zur (auditierten) Personen-Detailseite des Halters.
        t.halter_person_id != null ? (
          <Button
            type="link"
            style={{ padding: 0 }}
            onClick={() => navigate(personDetailPfad(einsatzId, t.halter_person_id!))}
          >
            {halterAnzeige(t)}
          </Button>
        ) : (
          halterAnzeige(t)
        ),
      )}
      {zelle('notiz', 'Notiz', <Input.TextArea rows={2} />, t.notiz ?? '—', { breit: true })}
    </Datenraster>
  );

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Tiere</Link> },
            { title: kennung },
          ]}
        />
      }
      titel={
        <Space wrap size={8}>
          <span>
            Tier <span style={monoStil(14, 500)}>{kennung}</span>
          </span>
          <StatusChip ton={STATUS_META[t.status].ton} wort={STATUS_META[t.status].label} />
          <Tag>{SPEZIES_META[t.spezies]}</Tag>
          {t.storniert_at && <StatusChip ton="neutral" wort="storniert" />}
        </Space>
      }
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      aktionen={
        /**
         * Genau eine Primäraktion je Zustand, „Bearbeiten“ sichtbar daneben (Vorbild der Bearbeitung
         * in der Ansicht, LLH-1101), alles Weitere im Menü (LLH-1105). Einen „Zurück zur
         * Liste“-Knopf gibt es nicht: die Brotkrume trägt denselben Weg.
         */
        plan && (
          <Space wrap size="middle">
            <Button
              type="primary"
              loading={laeuftStatus(plan.primaer)}
              onClick={() => fuehreAus(plan.primaer)}
            >
              {plan.primaer.label}
            </Button>
            <Button onClick={starteBearbeiten}>Bearbeiten</Button>
            <MenueAusloeser
              eintraege={plan.weitere}
              laeuft={plan.weitere.some(laeuftStatus)}
              zugaenglicherName={`Weitere Aktionen zu Tier ${kennung}`}
              onWahl={(key) => {
                const aktion = plan.weitere.find((a) => a.key === key);
                if (aktion) fuehreAus(aktion);
              }}
            />
          </Space>
        )
      }
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        statusMutation.error != null && (
          <SeitenHinweise
            fehler={statusMutation.error}
            fehlerTitel="Status nicht geändert"
            fehlerFallback="Statuswechsel fehlgeschlagen"
          />
        )
      }
    >
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        {sitzung ? (
          <Form
            form={editForm}
            onValuesChange={schutz.geaendert}
            // Nach gescheiterter Prüfung steht der Fokus im ersten Feld mit Meldung (LLH-1101).
            scrollToFirstError={{ focus: true }}
            onFinish={(daten) => {
              const h = daten.halter ?? null;
              const fundort = ortFelder(daten.antreff_ort);
              const patch: TierPatch = {
                rasse_beschreibung: daten.rasse_beschreibung,
                rufname: daten.rufname,
                geschlecht: daten.geschlecht,
                alter_geschaetzt: daten.alter_geschaetzt,
                farbe_beschreibung: daten.farbe_beschreibung,
                kennzeichnung: daten.kennzeichnung,
                groesse_gewicht: daten.groesse_gewicht,
                antreff_ort: fundort.text,
                // Paar: beide gesetzt oder beide leer (`null`), nie ein halbes.
                antreff_lat: fundort.lat,
                antreff_lon: fundort.lon,
                notiz: daten.notiz,
                // Halter XOR: immer beide Felder explizit senden (das nicht gewählte ist null).
                halter_person_id: h?.typ === 'person' ? h.refId : null,
                halter_kontakt: h?.typ === 'extern' ? h.kontakt : null,
              };
              const fassung = schutz.fassung();
              editMutation.mutate(
                { daten: patch, basis: sitzung.basis },
                { onSuccess: () => schutz.gespeichert(fassung) },
              );
            }}
          >
            {detailAnsicht}
            {editFehler != null && (
              <div style={{ marginTop: 16 }}>
                <SpeicherFehler fehler={editFehler} />
              </div>
            )}
            {/* Stehende Leiste im `<form>` (`frontend/AGENTS.md`, „Formularseiten“): bei zehn
                Feldern scrollten die Knöpfe sonst aus dem Bild. */}
            <div {...speicherLeiste} style={{ ...speicherLeiste.style, marginTop: 16 }}>
              <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
                Speichern
              </Button>
              {/* Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort. */}
              <Button disabled={editMutation.isPending} onClick={editSitzung.beende}>
                Abbrechen
              </Button>
            </div>
          </Form>
        ) : (
          detailAnsicht
        )}

        {t.status === 'abgeschlossen' && (
          <Paneel titel="Verbleib">
            <Datenraster spalten={2} beschriftung="Verbleib">
              <Datenfeld label="Verbleib">
                {t.abschluss_grund ? TIER_VERBLEIB[t.abschluss_grund] : '—'}
              </Datenfeld>
              <Datenfeld label="Übergeben an / Ort">{t.abschluss_ziel ?? '—'}</Datenfeld>
            </Datenraster>
          </Paneel>
        )}

        {/* Fotos und Dateien (LFH-758): außerhalb des Bearbeiten-<Form> — der Ablegen-Dialog
            trägt ein eigenes Formular, verschachtelt schickte es beim Absenden das äußere nativ
            ab. Im Bearbeiten-Modus bleibt es sichtbar. */}
        <TierAnhaenge einsatzId={einsatzId} tier={t} darfSchreiben={darfSchreiben} />
      </Space>

      {/* Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm). „Verbleib erfassen“ wie bei
          Personen (LLH-1092): das Tier verlässt die Obhut der Einsatzkräfte. Der Status heißt
          danach weiter „abgeschlossen“, die Drahtwerte bleiben. */}
      <ErfassungsModal<{ abschluss_grund: AbschlussGrund; abschluss_ziel?: string }>
        offen={abschlussOffen}
        titel={`Verbleib von ${kennung}`}
        form={abschlussForm}
        erfassenText="Verbleib speichern"
        laeuft={abschlussMutation.isPending}
        speicherung={abschlussMutation}
        speicherFehlerTitel="Verbleib nicht gespeichert"
        speicherFehlerFallback="Speichern fehlgeschlagen"
        onErfassen={(v) => abschlussMutation.mutateAsync(v)}
        onFertig={() => setAbschlussOffen(false)}
        onAbbrechen={() => setAbschlussOffen(false)}
      >
        <Form.Item
          label="Verbleib"
          name="abschluss_grund"
          rules={[{ required: true, message: 'Verbleib ist Pflicht' }]}
        >
          <Select
            options={(Object.keys(TIER_VERBLEIB) as AbschlussGrund[]).map((k) => ({
              value: k,
              label: TIER_VERBLEIB[k],
            }))}
            // Den bekannten Halter vorbelegen, nie ein schon eingetragenes Ziel überschreiben; beim
            // Wechsel auf einen anderen Verbleib die unveränderte Vorbelegung wieder herausnehmen.
            onChange={(grund: AbschlussGrund) => {
              const halter = halterVorbelegung(t);
              const ziel: unknown = abschlussForm.getFieldValue('abschluss_ziel');
              if (halter == null) return;
              if (grund === 'uebergabe_halter' && !ziel)
                abschlussForm.setFieldValue('abschluss_ziel', halter);
              else if (grund !== 'uebergabe_halter' && ziel === halter)
                abschlussForm.setFieldValue('abschluss_ziel', undefined);
            }}
          />
        </Form.Item>
        <Form.Item label="Übergeben an / Ort" name="abschluss_ziel">
          <Input placeholder="z. B. Tierarzt Dr. Müller, Tierheim Nord" />
        </Form.Item>
      </ErfassungsModal>

      <Modal
        open={stornoOffen}
        title={`Tier ${kennung} stornieren?`}
        okText="Tier stornieren"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        confirmLoading={stornoMutation.isPending}
        cancelButtonProps={{ disabled: stornoMutation.isPending }}
        closable={stornoMutation.isPending ? { disabled: true } : true}
        mask={{ closable: !stornoMutation.isPending }}
        keyboard={!stornoMutation.isPending}
        onOk={() => {
          raeume(statusMutation);
          stornoMutation.mutate(t.id);
        }}
        onCancel={() => {
          if (stornoMutation.isPending) return;
          raeume(stornoMutation);
          setStornoOffen(false);
        }}
      >
        Der Datensatz bleibt erhalten und verschwindet aus den Arbeitssichten.
        {stornoMutation.error != null && (
          <div style={{ marginTop: 16 }}>
            <SpeicherFehler
              fehler={stornoMutation.error}
              titel="Nicht storniert"
              fallback="Stornieren fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
    </EinsatzSeite>
  );
}
