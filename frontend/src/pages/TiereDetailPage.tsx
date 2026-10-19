import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
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
import { SPEZIES_META, TIER_ABSCHLUSS, TIER_STATUS } from './tiere/tierHelfer';
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
type TierFormWerte = TierPatch & { halter?: HalterWert | null };

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
   * Fehler“): Bearbeiten am Formular, Status und Storno im Seitenhinweis, Abschließen im Dialog.
   * Den Sperrkonflikt beantwortet weiter der Konfliktdialog, er steht nicht noch am Formular.
   */
  const sperrkonflikt = istKonflikt(editMutation.error) && !editMutation.variables?.overwrite;
  const editFehler = sperrkonflikt ? null : editMutation.error;
  // Status und Storno teilen sich den Seitenhinweis: der Start der einen räumt die andere.
  const kopfFehler = statusMutation.error ?? stornoMutation.error;
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
  }, [tierId, editReset, statusReset, stornoReset, beendeSitzung]);

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
        <InputNumber min={0} />,
        t.alter_geschaetzt ?? '—',
        { mono: true, rules: [alterRegel] },
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
      {zelle('antreff_ort', 'Fundort', <Input />, t.antreff_ort ?? '—')}
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
            { title: tierRegistrierAnzeige(t.registrier_nr) },
          ]}
        />
      }
      titel={
        <Space wrap size={8}>
          <span>
            Tier <span style={monoStil(14, 500)}>{tierRegistrierAnzeige(t.registrier_nr)}</span>
          </span>
          <StatusChip ton={STATUS_META[t.status].ton} wort={STATUS_META[t.status].label} />
          <Tag>{SPEZIES_META[t.spezies]}</Tag>
          {t.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
      }
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      aktionen={
        <Space>
          {darfSchreiben && !t.storniert_at && !bearbeiten && (
            <Space wrap size="middle">
              {naechsteStatus(t.status).map((s) =>
                s === 'abgeschlossen' ? (
                  <Button key={s} onClick={() => setAbschlussOffen(true)}>
                    Abschließen
                  </Button>
                ) : (
                  <Button
                    key={s}
                    onClick={() => {
                      raeume(stornoMutation);
                      statusMutation.mutate({ status: s });
                    }}
                  >
                    {s === 'vermisst'
                      ? 'Als vermisst markieren'
                      : s === 'aktiv' && t.status === 'vermisst'
                        ? 'Aufgefunden'
                        : `→ ${STATUS_META[s].label}`}
                  </Button>
                ),
              )}
              <Button
                onClick={() => {
                  raeume(editMutation);
                  editSitzung.starte(t, {
                    rufname: t.rufname,
                    rasse_beschreibung: t.rasse_beschreibung,
                    geschlecht: t.geschlecht,
                    alter_geschaetzt: t.alter_geschaetzt,
                    farbe_beschreibung: t.farbe_beschreibung,
                    kennzeichnung: t.kennzeichnung,
                    groesse_gewicht: t.groesse_gewicht,
                    antreff_ort: t.antreff_ort,
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
                }}
              >
                Bearbeiten
              </Button>
              <Popconfirm
                title="Tier stornieren?"
                onConfirm={() => {
                  raeume(statusMutation);
                  stornoMutation.mutate(t.id);
                }}
                okText="Tier stornieren"
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      }
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        kopfFehler != null && (
          <SeitenHinweise
            fehler={kopfFehler}
            fehlerTitel={statusMutation.error != null ? 'Status nicht geändert' : 'Nicht storniert'}
            fehlerFallback={
              statusMutation.error != null
                ? 'Statuswechsel fehlgeschlagen'
                : 'Stornieren fehlgeschlagen'
            }
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
              const patch: TierPatch = {
                rasse_beschreibung: daten.rasse_beschreibung,
                rufname: daten.rufname,
                geschlecht: daten.geschlecht,
                alter_geschaetzt: daten.alter_geschaetzt,
                farbe_beschreibung: daten.farbe_beschreibung,
                kennzeichnung: daten.kennzeichnung,
                groesse_gewicht: daten.groesse_gewicht,
                antreff_ort: daten.antreff_ort,
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
          <Paneel titel="Abschluss">
            <Datenraster spalten={2} beschriftung="Abschluss">
              <Datenfeld label="Grund">
                {t.abschluss_grund ? TIER_ABSCHLUSS[t.abschluss_grund] : '—'}
              </Datenfeld>
              <Datenfeld label="Ziel">{t.abschluss_ziel ?? '—'}</Datenfeld>
            </Datenraster>
          </Paneel>
        )}

        {/* Fotos und Dateien (LFH-758): außerhalb des Bearbeiten-<Form> — der Ablegen-Dialog
            trägt ein eigenes Formular, verschachtelt schickte es beim Absenden das äußere nativ
            ab. Im Bearbeiten-Modus bleibt es sichtbar. */}
        <TierAnhaenge einsatzId={einsatzId} tier={t} darfSchreiben={darfSchreiben} />
      </Space>

      {/* Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm). */}
      <ErfassungsModal<{ abschluss_grund: AbschlussGrund; abschluss_ziel?: string }>
        offen={abschlussOffen}
        titel="Tier abschließen"
        form={abschlussForm}
        erfassenText="Abschließen"
        laeuft={abschlussMutation.isPending}
        speicherung={abschlussMutation}
        speicherFehlerTitel="Nicht abgeschlossen"
        speicherFehlerFallback="Abschließen fehlgeschlagen"
        onErfassen={(v) => abschlussMutation.mutateAsync(v)}
        onFertig={() => setAbschlussOffen(false)}
        onAbbrechen={() => setAbschlussOffen(false)}
      >
        <Form.Item
          label="Abschlussgrund"
          name="abschluss_grund"
          rules={[{ required: true, message: 'Grund ist Pflicht' }]}
        >
          <Select
            options={(Object.keys(TIER_ABSCHLUSS) as AbschlussGrund[]).map((k) => ({
              value: k,
              label: TIER_ABSCHLUSS[k],
            }))}
          />
        </Form.Item>
        <Form.Item label="Ziel" name="abschluss_ziel">
          <Input placeholder="z. B. Tierarzt Müller, R-Nr. des Halters" />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
