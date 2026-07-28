import { Alert, App, Breadcrumb, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Select } from '../components/Select';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereFahrzeug, entferneDisposition,
  gibBesatzungFrei, listeEinsatzFahrzeuge, ordneBesatzungZu, type AdhocEingabe,
} from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug, EinsatzPersonal, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StatusTag from '../components/StatusTag';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { statusKategorie } from '../theme/statusFarben';
import { abstand, flaeche } from '../theme/tokens';

/**
 * Statusanzeige eines disponierten Fahrzeugs — und zugleich die GRENZE des
 * Statusfarb-Vertrags (LFH-328/A2, Spec §1.3).
 *
 * Die Anzeige hat zwei Achsen, und nur eine davon kann der Vertrag tragen:
 *
 * 1. **DB-Achse** — `status_farbe` ist mandantengepflegter Freitext aus den
 *    Stammdaten-Tabs. Das Backend (`src/routes/fahrzeug_status.rs`) trimmt ihn und
 *    prüft sonst NICHTS: kein Enum, kein Hex-Format. Ein getypter `Record` kann das
 *    nicht einfangen. Diese Achse bleibt deshalb unangetastet — wer sie „aufräumt",
 *    nimmt dem Mandanten seine gepflegte Farbe weg. (Dass sie gegen die A0-Rollen
 *    validiert werden sollte, ist ein eigener Befund, Spec §5 Nr. 1.)
 * 2. **Fallback-Achse** — früher `KATEGORIE_FALLBACK`, byte-identisch in dieser und
 *    der Nachbarseite dupliziert. Sie kommt jetzt aus `statusKategorie`.
 *
 * ABWEICHUNG VOM PLANWORTLAUT, bewusst: der Plan sagt „`status_farbe ?? …` bleibt
 * stehen", gemeint als „die DB-Achse bleibt". Aus dem `??` einen Zweig zu machen
 * erhält genau das — und vermeidet den Fehler, den `StatusTag` selbst dokumentiert:
 * antds `color`-Prop rendert einen NICHT-Preset-Wert als Vollfläche mit erzwungen
 * weißem Text. Die Rollenfarbe dort hineinzureichen (`rollenFarbe(...)` liefert Hex,
 * nie einen Preset-Namen) hätte aus jedem Fallback-Tag — dem Normalfall, solange kein
 * Mandant eine Farbe pflegt — eine gefüllte Fläche gemacht, im Dunkelmodus mit weißer
 * Schrift auf aufgehelltem Rot. Der Zweig hält die DB-Achse byte-gleich und stellt die
 * Fallback-Achse auf die Umrissform, die der Rest der Anwendung nach A2 trägt.
 */
function StatusBadge({ ef }: { ef: EinsatzFahrzeug }) {
  if (!ef.status_label || !ef.status_kategorie) return <Tag>kein Status</Tag>;
  if (ef.status_farbe) return <Tag color={ef.status_farbe}>{ef.status_label}</Tag>;
  const meta = statusKategorie[ef.status_kategorie];
  return <StatusTag darstellung={{ ...meta, label: ef.status_label }} />;
}

/**
 * Ist-Besatzungsstärke aus den Stärke-Positionen der zugeordneten Kräfte (clientseitig
 * gezählt; LFH-9 hält das bewusst orthogonal zur Einheiten-Stärke — kein Backend-Aggregat).
 *
 * Eine Kraft ohne explizite F/UF-Position (`staerke_position == null`) ist trotzdem physisch
 * auf dem Fahrzeug und zählt zur Stärke — in der BOS-Schreibweise als Mannschaft (Sammeltopf),
 * sodass Σ die tatsächliche Kopfzahl der Besatzung bleibt.
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
  return ist.fuehrer >= soll.fuehrer
    && ist.unterfuehrer >= soll.unterfuehrer
    && ist.mannschaft >= soll.mannschaft;
}

/**
 * Besatzungs-Ist als Ampel-Badge (LFH-9): blau ohne hinterlegtes Soll (kein „erfüllt"-Urteil
 * möglich), grün bei erfülltem Soll (nur Ist, ohne redundanten Soll-Text), sonst rot mit Soll
 * in Klammern. Die Klammer ist zugleich das nicht-farbliche Signal für Unterbesetzung (a11y),
 * `title` ergänzt grün/blau um ein nicht-farbliches Signal.
 */
function BesatzungsStaerkeBadge({ ist, soll }: { ist: Staerke; soll: Staerke | null }) {
  if (!soll) {
    return <Tag color="blue" title="kein Soll hinterlegt"><StaerkeAnzeige wert={ist} /></Tag>;
  }
  if (istSollErfuellt(ist, soll)) {
    return <Tag color="green" title="Soll erfüllt"><StaerkeAnzeige wert={ist} /></Tag>;
  }
  return (
    <Tag color="red" title="unterbesetzt">
      <StaerkeAnzeige wert={ist} /> (Soll <StaerkeAnzeige wert={soll} />)
    </Tag>
  );
}

/**
 * Besatzungs-Block je disponiertem Fahrzeug (LFH-9): Mitglieder (gefiltert über
 * `fahrzeug_id`), Ist/Soll als `Staerke`, Frei-Pool-Picker (nur `fahrzeug_id == null`).
 * Eine Kraft, die in einer anderen Einheit als das Fahrzeug ist, wird markiert
 * (Transparenz der bewusst orthogonalen Zuordnung).
 */
function BesatzungsBlock({
  ef, personal, darfSchreiben, onZuordnen, onFreigeben,
}: {
  ef: EinsatzFahrzeug;
  personal: EinsatzPersonal[];
  darfSchreiben: boolean;
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
        <div><Typography.Text type="secondary">Keine Besatzung zugeordnet</Typography.Text></div>
      ) : (
        crew.map((m) => (
          <Space key={m.id} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 420 }}>
            <Space size={abstand.sm}>
              <span>{m.name}{m.staerke_position ? ` (${m.staerke_position})` : ''}</span>
              {m.einheit_id != null && m.einheit_id !== ef.einheit_id && (
                <Tag color="orange" style={{ margin: 0 }}>andere Einheit</Tag>
              )}
            </Space>
            {darfSchreiben && (
              <Button danger onClick={() => onFreigeben(m.id)}>Freigeben</Button>
            )}
          </Space>
        ))
      )}
      {darfSchreiben && (
        <Select
          style={{ width: '100%', maxWidth: 420, marginTop: 8 }}
          placeholder="Kraft zur Besatzung …"
          value={null}
          notFoundContent="Keine freien Kräfte"
          options={frei.map((p) => ({ value: p.id, label: p.name }))}
          onSelect={(epId) => onZuordnen(Number(epId))}
        />
      )}
    </div>
  );
}

export default function FahrzeugePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const efQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: globalKeys.fahrzeugStatus(), queryFn: listeFahrzeugStatus });
  const poolQuery = useQuery({ queryKey: globalKeys.fahrzeugeListe('im-dienst'), queryFn: () => listeFahrzeuge(true) });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });

  // Cross-Modul-Deeplink (LFH-25): ?fahrzeug=<id> hebt die Zeile hervor (Scroll best-effort).
  useQueryParamSelektion('fahrzeug', efQuery.isSuccess, (fid) => {
    if ((efQuery.data ?? []).some((f) => f.id === fid)) setHighlightId(fid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    document.querySelector(`[data-row-key="${highlightId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (fahrzeugId: number) => disponiereFahrzeug(einsatzId, fahrzeugId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { efId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    onSuccess: invalidate,
    onError: fehler,
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
  const stati = statusQuery.data ?? [];
  const personal = personalQuery.data ?? [];
  const disponierteIds = new Set(efs.map((e) => e.fahrzeug_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((f) => !disponierteIds.has(f.id))
    .map((f) => ({ value: f.id, label: `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}` }));

  const spalten: TableColumnsType<EinsatzFahrzeug> = [
    {
      title: 'Funkrufname',
      key: 'funkrufname',
      render: (_, ef) => (
        <Space>
          {ef.funkrufname}
          {ef.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'typ', render: (t) => t ?? '—' },
    { title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'status',
      render: (_, ef) =>
        darfSchreiben ? (
          <Select
            style={{ minWidth: 150 }}
            value={ef.status_id ?? undefined}
            placeholder="Status wählen"
            options={stati.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(statusId) => statusMutation.mutate({ efId: ef.id, statusId })}
          />
        ) : (
          <StatusBadge ef={ef} />
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
      render: (_, ef) =>
        darfSchreiben ? (
          <Typography.Text
            editable={{ onChange: (val) => bemerkungMutation.mutate({ efId: ef.id, bemerkung: val }) }}
          >
            {ef.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          ef.bemerkung || '—' // leere/null-Bemerkung als „—" anzeigen
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, ef: EinsatzFahrzeug) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ef.id)}>
                <Button danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzFahrzeug>)
      : []),
  ];

  return (
    <EinsatzSeite
      breite={flaeche.seiteBreit}
      titel={
        <Space>
          Fahrzeuge
          {/* BEFUND (LFH-328/A2): der Einsatz-Status trägt hier weiterhin antd-Farbnamen und
              den ROHEN Enum-String statt einer Statusrolle. `statusFarben.ts` hat für
              `EinsatzStatus` keinen Eintrag — die Vertragstabelle der Spec (§1.3) listet acht
              Enums, dieses ist keins davon. Die Zuordnung ist zwar entschieden (Spec §6,
              Prüflistenzeile 7), steht aber als lokale Map in `EinsaetzePage`. Sie hierher zu
              kopieren wäre eine dritte Wahrheit, sie nach `statusFarben.ts` zu heben eine
              Vertragserweiterung — beides ist nicht A2s Auftrag (Spec §5 Befund 7). */}
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Fahrzeuge' }]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Stamm-Fahrzeug disponieren …"
              value={null}
              options={poolOptionen}
              notFoundContent="Keine freien Fahrzeuge"
              onSelect={(fahrzeugId) => { if (fahrzeugId != null) disponiereMutation.mutate(fahrzeugId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Fahrzeug</Button>
          </Space>
        )
      }
      hinweis={
        !darfSchreiben && einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      <Table
        rowKey="id"
        loading={efQuery.isLoading}
        dataSource={efs}
        columns={spalten}
        pagination={false}
        rowClassName={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : '')}
        locale={{ emptyText: 'Noch keine Fahrzeuge disponiert' }}
        expandable={{
          // Besatzung je Fahrzeug standardmäßig eingeklappt, per Icon aufklappbar;
          // die kompakte Ist/Soll-Stärke steht dauerhaft in der Besatzungs-Spalte.
          expandedRowRender: (ef) => (
            <BesatzungsBlock
              ef={ef}
              personal={personal}
              darfSchreiben={darfSchreiben}
              onZuordnen={(epId) => besatzungZuMutation.mutate({ efId: ef.id, epId })}
              onFreigeben={(epId) => besatzungFreiMutation.mutate({ efId: ef.id, epId })}
            />
          ),
        }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Fahrzeug disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnHidden
      >
        <Form<AdhocEingabe> form={form} layout="vertical" onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Funkrufname" name="funkrufname" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Florian Nachbarstadt 44/1" />
          </Form.Item>
          <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp"><Input /></Form.Item>
          <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
          <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation">
            <Input placeholder="z. B. Feuerwehr Nachbarstadt" />
          </Form.Item>
        </Form>
      </Modal>
    </EinsatzSeite>
  );
}
