import { Alert, App, Breadcrumb, Button, Form, Input, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd';
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

  const anlegenMutation = useMutation({
    mutationFn: (v: TierEingabe) => legeTierAn(einsatzId, v),
    onSuccess: () => { invalidate(); setModus(null); form.resetFields(); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const alle = tiereQuery.data ?? [];
  const tiere = filterTiere(alle, { sicht, spezies: speziesFilter });

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

      <Datensicht
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

      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical"
          initialValues={{ spezies: 'hund' }}
          onFinish={(daten) => anlegenMutation.mutate({ ...daten, status: modus === 'vermisst' ? 'vermisst' : 'aktiv' })}>
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
        </Form>
      </Modal>
    </div>
  );
}
