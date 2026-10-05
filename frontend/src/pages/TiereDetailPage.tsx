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
import EinsatzSeite from '../components/EinsatzSeite';
import { Datenfeld, Datenraster, Paneel, StatusChip, monoStil } from '../components/instrument';
import { SPEZIES_META, TIER_ABSCHLUSS, TIER_STATUS } from './tiere/tierHelfer';
import { Select } from '../components/Select';
import { SeitenFehler } from '../components/SeitenZustand';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
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
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { ErfassungsModal } from '../components/Erfassung';
import { registrierNummer } from '../anzeige/registrierNummer';

/**
 * Formularwerte der Bearbeiten-Maske: der Patch plus die zusammengesetzte Halter-Auswahl, die erst
 * beim Absenden in das XOR-Feldpaar zerlegt wird.
 */
type TierFormWerte = TierPatch & { halter?: HalterWert | null };

const STATUS_META = TIER_STATUS;

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
function halterAnzeige(t: Tier): React.ReactNode {
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
  const { benutzer } = useAuth();
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
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [abschlussForm] = Form.useForm<{
    abschluss_grund: AbschlussGrund;
    abschluss_ziel?: string;
  }>();

  const fehler = useFehlerMeldung();

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
          content:
            'Dieses Tier wurde seit dem Öffnen von jemand anderem gespeichert. „Neu laden" verwirft deine Änderungen; „Überschreiben" speichert deine Werte über die des anderen.',
          okText: 'Überschreiben',
          okButtonProps: { danger: true },
          cancelText: 'Neu laden',
          onOk: () => editMutation.mutate({ daten: v.daten, overwrite: true }),
          onCancel: () => {
            detailQuery.refetch();
            editSitzung.beende();
          },
        });
      } else {
        fehler(e);
      }
    },
  });
  const statusMutation = useMutation({
    mutationFn: (v: { status: TierStatus }) =>
      setzeTierStatus(einsatzId, tierId, { status: v.status }),
    onSuccess: invalidateDetail,
    onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (tid: number) => storniereTier(einsatzId, tid),
    onSuccess: () => {
      invalidate();
      navigate(tierePfad(einsatzId));
    },
    onError: fehler,
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
    onError: fehler,
  });

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

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Eine Detail-Zelle: im Edit-Modus ein noStyle-Form.Item mit Input, sonst die Anzeige — dasselbe
  // Datenraster bleibt stehen.
  const zelle = (name: string, input: React.ReactNode, anzeige: React.ReactNode) =>
    bearbeiten ? (
      <Form.Item name={name} noStyle>
        {input}
      </Form.Item>
    ) : (
      anzeige
    );

  const detailAnsicht = (
    <Datenraster spalten={3} beschriftung="Tierdaten">
      <Datenfeld label="Rufname">
        {zelle('rufname', <Input placeholder="Rufname" />, t.rufname ?? '—')}
      </Datenfeld>
      <Datenfeld label="Rasse / Beschreibung">
        {zelle('rasse_beschreibung', <Input />, t.rasse_beschreibung ?? '—')}
      </Datenfeld>
      <Datenfeld label="Geschlecht">
        {zelle(
          'geschlecht',
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
      </Datenfeld>
      <Datenfeld label="Alter in Jahren (geschätzt)" mono>
        {zelle('alter_geschaetzt', <InputNumber min={0} max={120} />, t.alter_geschaetzt ?? '—')}
      </Datenfeld>
      <Datenfeld label="Farbe / Erscheinung">
        {zelle('farbe_beschreibung', <Input />, t.farbe_beschreibung ?? '—')}
      </Datenfeld>
      <Datenfeld label="Kennzeichnung" mono>
        {zelle(
          'kennzeichnung',
          <Input placeholder="Chip / Tätowierung / Halsband" />,
          t.kennzeichnung ?? '—',
        )}
      </Datenfeld>
      <Datenfeld label="Größe / Gewicht">
        {zelle('groesse_gewicht', <Input />, t.groesse_gewicht ?? '—')}
      </Datenfeld>
      <Datenfeld label="Antreffort">
        {zelle('antreff_ort', <Input />, t.antreff_ort ?? '—')}
      </Datenfeld>
      <Datenfeld label="Halter">
        {zelle(
          'halter',
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
      </Datenfeld>
      <Datenfeld label="Notiz" breit>
        {zelle('notiz', <Input.TextArea rows={2} />, t.notiz ?? '—')}
      </Datenfeld>
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
                  <Button key={s} onClick={() => statusMutation.mutate({ status: s })}>
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
                title="Tier stornieren (Soft-Delete)?"
                onConfirm={() => stornoMutation.mutate(t.id)}
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      }
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        {sitzung ? (
          <Form
            form={editForm}
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
              editMutation.mutate({ daten: patch, basis: sitzung.basis });
            }}
          >
            {detailAnsicht}
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
                Speichern
              </Button>
              <Button onClick={editSitzung.beende}>Abbrechen</Button>
            </Space>
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
        <Form.Item
          label="Ziel (Freitext, z. B. Tierarzt Müller, R-Nr. des Halters)"
          name="abschluss_ziel"
        >
          <Input />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
