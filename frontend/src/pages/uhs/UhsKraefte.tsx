import { useId, useState } from 'react';
import { App, Button, Form, Input, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  erfasseAdhocKraft,
  listeKraefteOhneUhs,
  ordneEinheitZu,
  ordneKraftZu,
  zieheKraftAb,
  type AdhocKraftEingabe,
} from '../../api/einsatzUhs';
import { PERSONAL_ADHOC_TEXT_MAX } from '../../api/eingabegrenzen';
import { POSITION_LABELS, POSITION_OPTIONEN } from '../../api/personal';
import { einsatzKeys } from '../../api/queryKeys';
import type { StaerkePosition, UhsDetail, UhsKraft } from '../../api/types';
import { staerkeText } from '../../anzeige/staerke';
import { ErfassungsModal } from '../../components/Erfassung';
import KatalogTabelle from '../../components/KatalogTabelle';
import { Select } from '../../components/Select';
import { teilwortSuche } from '../../components/teilwortSuche';
import { Datenfeld, Datenraster } from '../../components/instrument';
import { ZeilenFehler } from '../../components/SpeicherHinweis';
import { useZeilenFehler } from '../../components/useZeilenFehler';
import { freieEinheiten, kraftAuswahlText, zaehleQualifikationen } from './uhsKraefteKern';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
  /** „Einheit zuordnen“: nur die Einsatzleitung, kein Gerät (Server 403). */
  einheitZuordnen: boolean;
}

interface KraftWerte {
  kraft_id: number;
}
interface EinheitWerte {
  einheit_id: number;
}
interface AdhocWerte {
  name: string;
  funktion?: string;
  staerke_position?: StaerkePosition;
}

/**
 * Kräfte einer UHS (LFH-1045, Spec `uhs-staerke`): die Stärke aus den zugeordneten Einsatzkräften,
 * ihre Qualifikationen als Zahl je Bezeichnung und die Zuordnung selbst. Geteilt von der
 * UHS-Detailseite (Einsatzleitung) und dem Bereich „UHS“ des UHS-Laptops; der Server begrenzt das
 * Gerät auf die eigene UHS (`src/geraet/stelle.rs`).
 */
export default function UhsKraefte({ einsatzId, uhs, schreibgeschuetzt, einheitZuordnen }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Ablehnungen am Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): die
  // Dialoge tragen ihre Mutation als `speicherung`, Abziehen meldet an der Zeile der Kraft.
  const abziehenZeilen = useZeilenFehler<number>();
  const bedienbar = !schreibgeschuetzt && uhs.status !== 'aufgeloest' && !uhs.storniert_at;
  const [offen, setOffen] = useState<'kraft' | 'einheit' | 'adhoc' | null>(null);
  const [kraftForm] = Form.useForm<KraftWerte>();
  const [einheitForm] = Form.useForm<EinheitWerte>();
  const [adhocForm] = Form.useForm<AdhocWerte>();
  const sperrgrundId = useId();

  const ohneUhsQuery = useQuery({
    queryKey: einsatzKeys.personalOhneUhs(einsatzId),
    queryFn: () => listeKraefteOhneUhs(einsatzId, uhs.id),
    enabled: bedienbar,
  });
  const ohneUhs = ohneUhsQuery.data ?? [];
  const einheiten = freieEinheiten(ohneUhs);
  const qualifikationen = zaehleQualifikationen(uhs.kraefte);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
  }

  const zuordnenMut = useMutation({
    mutationFn: (kraftId: number) => ordneKraftZu(einsatzId, uhs.id, kraftId),
    onSuccess: () => {
      message.success('Kraft zugeordnet');
      invalidate();
    },
  });
  const einheitMut = useMutation({
    mutationFn: (einheitId: number) => ordneEinheitZu(einsatzId, uhs.id, einheitId),
    onSuccess: () => {
      message.success('Einheit zugeordnet');
      invalidate();
    },
  });
  const adhocMut = useMutation({
    mutationFn: (daten: AdhocKraftEingabe) => erfasseAdhocKraft(einsatzId, uhs.id, daten),
    onSuccess: () => {
      message.success('Kraft erfasst');
      invalidate();
    },
  });
  const abziehenMut = useMutation({
    mutationFn: (kraftId: number) => zieheKraftAb(einsatzId, uhs.id, kraftId),
    onMutate: (kraftId) => abziehenZeilen.beginne(kraftId),
    onSuccess: () => {
      message.success('Kraft abgezogen');
      invalidate();
    },
    onError: (e, kraftId) => abziehenZeilen.melde(kraftId, e, 'Abziehen fehlgeschlagen'),
  });

  const keineFreie = ohneUhsQuery.isSuccess && ohneUhs.length === 0;

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Funktion',
      dataIndex: 'funktion',
      key: 'funktion',
      render: (v: string | undefined) => v ?? '—',
    },
    {
      title: 'Position',
      dataIndex: 'staerke_position',
      key: 'position',
      render: (p: StaerkePosition | undefined) => (p ? POSITION_LABELS[p] : '—'),
    },
    {
      title: 'Einheit',
      dataIndex: 'einheit',
      key: 'einheit',
      render: (v: string | undefined) => v ?? '—',
    },
    ...(bedienbar
      ? [
          {
            title: 'Aktion',
            key: 'aktion',
            // Keine Rückfrage: die Kraft bleibt im Einsatz und lässt sich wieder zuordnen
            // (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“).
            render: (_: unknown, k: UhsKraft) => {
              const grund = abziehenZeilen.grund(k.id);
              return (
                <Space orientation="vertical" size={4}>
                  <Button
                    danger
                    aria-label={`${k.name} abziehen`}
                    loading={abziehenMut.isPending && abziehenMut.variables === k.id}
                    onClick={() => abziehenMut.mutate(k.id)}
                  >
                    Abziehen
                  </Button>
                  {grund && <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />}
                </Space>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Datenraster beschriftung="Stärke der UHS" spalten={2}>
        <Datenfeld label="Stärke" mono>
          <span data-testid="uhs-staerke">{staerkeText(uhs.staerke)}</span>
        </Datenfeld>
        <Datenfeld label="Qualifikationen">
          {qualifikationen.length === 0 ? (
            '—'
          ) : (
            <Space wrap size={[4, 4]}>
              {qualifikationen.map((q) => (
                <Tag key={q.bezeichnung}>
                  {q.bezeichnung} {q.anzahl}
                </Tag>
              ))}
            </Space>
          )}
        </Datenfeld>
      </Datenraster>
      {bedienbar && (
        <Space wrap size="small" align="center">
          <Button
            onClick={() => setOffen('kraft')}
            disabled={keineFreie}
            aria-describedby={keineFreie ? sperrgrundId : undefined}
          >
            Kraft zuordnen
          </Button>
          {einheitZuordnen && (
            <Button
              onClick={() => setOffen('einheit')}
              disabled={keineFreie || einheiten.length === 0}
            >
              Einheit zuordnen
            </Button>
          )}
          <Button onClick={() => setOffen('adhoc')}>Kraft erfassen</Button>
          {keineFreie && (
            <Typography.Text type="secondary" id={sperrgrundId}>
              Keine Kraft ohne UHS
            </Typography.Text>
          )}
        </Space>
      )}
      <KatalogTabelle<UhsKraft>
        rowKey="id"
        dataSource={uhs.kraefte}
        columns={columns}
        pagination={false}
        locale={{ emptyText: 'Keine Kraft an dieser UHS' }}
      />
      <ErfassungsModal<KraftWerte>
        offen={offen === 'kraft'}
        titel="Kraft zuordnen"
        form={kraftForm}
        erfassenText="Zuordnen"
        laeuft={zuordnenMut.isPending}
        speicherung={zuordnenMut}
        speicherFehlerTitel="Nicht zugeordnet"
        speicherFehlerFallback="Zuordnen fehlgeschlagen"
        onErfassen={(w) => zuordnenMut.mutateAsync(w.kraft_id)}
        onFertig={() => setOffen(null)}
        onAbbrechen={() => setOffen(null)}
      >
        <Form.Item<KraftWerte>
          name="kraft_id"
          label="Kraft"
          rules={[{ required: true, message: 'Bitte eine Kraft auswählen' }]}
        >
          <Select
            showSearch={teilwortSuche}
            style={{ width: '100%' }}
            placeholder="Kraft auswählen…"
            options={ohneUhs.map((k) => ({ value: k.id, label: kraftAuswahlText(k) }))}
          />
        </Form.Item>
      </ErfassungsModal>
      {einheitZuordnen && (
        <ErfassungsModal<EinheitWerte>
          offen={offen === 'einheit'}
          titel="Einheit zuordnen"
          form={einheitForm}
          erfassenText="Zuordnen"
          laeuft={einheitMut.isPending}
          speicherung={einheitMut}
          speicherFehlerTitel="Nicht zugeordnet"
          speicherFehlerFallback="Zuordnen fehlgeschlagen"
          onErfassen={(w) => einheitMut.mutateAsync(w.einheit_id)}
          onFertig={() => setOffen(null)}
          onAbbrechen={() => setOffen(null)}
        >
          <Form.Item<EinheitWerte>
            name="einheit_id"
            label="Einheit"
            rules={[{ required: true, message: 'Bitte eine Einheit auswählen' }]}
          >
            <Select
              style={{ width: '100%' }}
              placeholder="Einheit auswählen…"
              options={einheiten.map((e) => ({
                value: e.id,
                label: `${e.name} (${e.anzahl} ${e.anzahl === 1 ? 'Kraft' : 'Kräfte'})`,
              }))}
            />
          </Form.Item>
        </ErfassungsModal>
      )}
      <ErfassungsModal<AdhocWerte>
        offen={offen === 'adhoc'}
        titel="Kraft erfassen"
        form={adhocForm}
        erfassenText="Erfassen"
        laeuft={adhocMut.isPending}
        speicherung={adhocMut}
        speicherFehlerTitel="Nicht erfasst"
        speicherFehlerFallback="Erfassen fehlgeschlagen"
        onErfassen={(w) =>
          adhocMut.mutateAsync({
            name: w.name,
            funktion: w.funktion?.trim() || undefined,
            staerke_position: w.staerke_position,
          })
        }
        onFertig={() => setOffen(null)}
        onAbbrechen={() => setOffen(null)}
      >
        <Form.Item<AdhocWerte>
          name="name"
          label="Name"
          rules={[{ required: true, whitespace: true, message: 'Bitte einen Namen angeben' }]}
        >
          <Input maxLength={PERSONAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        <Form.Item<AdhocWerte> name="funktion" label="Funktion">
          <Input maxLength={PERSONAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        <Form.Item<AdhocWerte> name="staerke_position" label="Position">
          <Select allowClear placeholder="ohne" options={POSITION_OPTIONEN} />
        </Form.Item>
      </ErfassungsModal>
    </Space>
  );
}
