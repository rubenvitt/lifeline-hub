import { App as AntApp, Breadcrumb, Button, Card, Input, Space, Statistic, Table, Tag, Typography, theme } from 'antd';
import type { GlobalToken } from 'antd';
import { taktischeDtgVoll } from '../anzeige/format';
import { Select } from '../components/Select';
import type { ColumnsType } from 'antd/es/table';
import { Link, useNavigate, useParams } from 'react-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  staerkeText,
  type FilterWerte,
  type MeldebildZeile,
  type Rohdaten,
  type StatusVerteilung,
} from '../kraefte/kraeftebild';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { MaterialStatus } from '../api/types';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { rollenFarbe, statusKategorie, type Statusrolle } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import './kraefteuebersichtPrint.css';

/**
 * Materialstatus als Kopfzeilen-Kennzahl.
 *
 * Die Map bleibt LOKAL, und das ist eine Entscheidung, keine Auslassung: `MaterialStatus`
 * ist kein Vertrags-Enum (Spec §1.3 listet die acht, §5 zieht die Grenze), und die Labels
 * hier tragen das seitenspezifische Präfix „Mtl." — beides gehört nicht in
 * `theme/statusFarben.ts`. Was aus dem Vertrag kommt, ist die WÄHRUNG: eine `Statusrolle`
 * statt der drei rohen Hex, die hier standen. Die waren antd-v5-Defaults und damit für
 * Gate 5 unsichtbar — es kennt nur die A0-Palette; hier hilft nur ein Blick in die Datei.
 *
 * `verbraucht` hat weiterhin KEINE Rolle. Das ist der Bestand und bleibt es: verbrauchtes
 * Material meldet nichts, und ihm `neutral` zu geben würde die Zahl auf
 * `colorTextTertiary` dämpfen — eine visuelle Änderung im Gewand einer Aufräumarbeit.
 * Fehlende Rolle heißt hier „kein Signal", nicht „noch nicht zugeordnet".
 */
const MAT_STATUS_ANZEIGE: Array<{ key: MaterialStatus; label: string; rolle?: Statusrolle }> = [
  { key: 'einsatzbereit', label: 'Mtl. einsatzbereit', rolle: 'normal' },
  { key: 'im_einsatz', label: 'Mtl. im Einsatz', rolle: 'achtung' },
  { key: 'defekt', label: 'Mtl. defekt', rolle: 'alarm' },
  { key: 'verbraucht', label: 'Mtl. verbraucht' },
  { key: 'desinfektion_noetig', label: 'Mtl. Desinfektion', rolle: 'achtung' },
];

// Schlichter, umbruchsicherer Achsen-Trenner (Flex-Kind statt inline-block Divider).
// Funktion statt Konstante, seit die Linienfarbe aus dem Theme kommt statt als rohes Grau.
function achsenTrenner(token: GlobalToken) {
  return (
    <div
      style={{
        width: 1,
        height: 48,
        background: token.colorBorderSecondary,
        alignSelf: 'center',
        flex: 'none',
      }}
    />
  );
}

/** Kurzform der Statusverteilung. Die Texte bleiben ABGEKÜRZT („geb.", „n.v.") — die
 *  vollen Vertragslabels würden die Statusspalte sprengen; der zweite Kanal ist
 *  vorhanden, nur enger gesetzt. `o.A.` ist keine Vertragskategorie, sondern die
 *  ABWESENHEIT eines Status und deshalb `neutral`. */
function verteilungTags(v: StatusVerteilung | null) {
  if (!v) return null;
  return (
    <Space size={abstand.xs}>
      {v.verfuegbar > 0 && (
        <StatusTag darstellung={{ ...statusKategorie.verfuegbar, label: `${v.verfuegbar} frei` }} />
      )}
      {v.gebunden > 0 && (
        <StatusTag darstellung={{ ...statusKategorie.gebunden, label: `${v.gebunden} geb.` }} />
      )}
      {v.nicht_verfuegbar > 0 && (
        <StatusTag
          darstellung={{ ...statusKategorie.nicht_verfuegbar, label: `${v.nicht_verfuegbar} n.v.` }}
        />
      )}
      {v.ohne > 0 && <StatusTag darstellung={{ rolle: 'neutral', label: `${v.ohne} o.A.` }} />}
    </Space>
  );
}

const spalten: ColumnsType<MeldebildZeile> = [
  {
    title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bez',
    render: (_t, z) => <span style={{ fontWeight: z.art === 'abschnitt' ? 600 : 400 }}>{z.bezeichnung}</span>,
  },
  { title: 'Typ / Rolle', dataIndex: 'detail', key: 'detail', responsive: ['md'] },
  {
    title: 'Stärke', key: 'staerke', width: 130,
    render: (_t, z) => (z.art === 'mittel' && z.mittelArt !== 'person') ? null : staerkeText(z.staerke),
  },
  {
    title: 'Status', key: 'status', width: 220,
    render: (_t, z) => {
      if (z.art === 'mittel') {
        if (z.mittelArt === 'material') {
          const text = [z.statusLabel, z.menge != null ? `×${z.menge}` : null].filter(Boolean).join(' · ');
          return text ? <Tag>{text}</Tag> : null;
        }
        // Ohne Kategorie gibt es keine Rolle — dann bleibt es beim farblosen Tag.
        if (!z.statusKategorie) return <Tag>{z.statusLabel ?? '—'}</Tag>;
        // Der mandantengepflegte `statusLabel` schlägt das Vertragslabel; vorher stand
        // hier ersatzweise der ROHE Enum-String (`nicht_verfuegbar`).
        const meta = statusKategorie[z.statusKategorie];
        return <StatusTag darstellung={{ ...meta, label: z.statusLabel ?? meta.label }} />;
      }
      return (
        <Space size={8}>
          <span>👤</span>{verteilungTags(z.personalVerteilung)}
          <span>🚒</span>{verteilungTags(z.fahrzeugVerteilung)}
        </Space>
      );
    },
  },
];

function alleKeys(zeilen: MeldebildZeile[]): string[] {
  return zeilen.flatMap((z) => [z.key, ...(z.children ? alleKeys(z.children) : [])]);
}

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();

  const [filter, setFilter] = useState<FilterWerte>({ abschnittId: null, traeger: null, kategorie: null, suche: '' });
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [printPending, setPrintPending] = useState(false);

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys IDENTISCH zu den vom Live-Hook invalidierten Keys (Task 5 erweitert den Hook).
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: einsatzKeys.personal(einsatzId), queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: einsatzKeys.fahrzeuge(einsatzId), queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: einsatzKeys.material(einsatzId), queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });

  const traeger = useMemo(() => [...new Set([
    ...(personalQuery.data ?? []).map((x) => x.traegerorganisation),
    ...(fahrzeugeQuery.data ?? []).map((x) => x.traegerorganisation),
  ].filter((t): t is string => !!t))].sort(), [personalQuery.data, fahrzeugeQuery.data]);

  const bild = useMemo(() => {
    const roh: Rohdaten = {
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
    };
    const gefiltert = filtereKraefte(roh, filter);
    return baueKraeftebild(
      gefiltert.abschnitte, gefiltert.einheiten, gefiltert.personal,
      gefiltert.fahrzeuge, gefiltert.material,
    );
  }, [abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data, filter]);

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const stand = taktischeDtgVoll(new Date().toISOString());
      const md = rendereMeldebildMarkdown(bild, stand);
      const lb = await legeLageberichtAn(einsatzId, { vorlage: 'freitext', titel: `Kräftemeldebild ${stand}` });
      // Hinweis: Schlägt der PATCH fehl, bleibt ein leerer Entwurf zurück (vom EL löschbar).
      // Atomar wäre nur mit eigenem Backend-Endpoint — bewusst v1-Kompromiss.
      await aktualisiereLagebericht(einsatzId, lb.id, { abschnitte: [{ schluessel: 'text', text: md }] });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
    onError: () => message.error('Übernahme fehlgeschlagen'),
  });

  // Erst nach committetem Aufklappen drucken (sonst kollabierte Zeilen bei großen Bäumen).
  useEffect(() => {
    if (printPending) {
      window.print();
      setPrintPending(false);
    }
  }, [printPending]);

  // Tabelle bleibt nach dem Druck bewusst voll aufgeklappt (kein Restore in v1).
  const handleDrucken = () => {
    setExpandedKeys(alleKeys(bild.baum));
    setPrintPending(true);
  };

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const v = bild.verdichtung;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  return (
    <div className="kraefte-print-root">
      <Breadcrumb className="kraefte-no-print" style={{ marginBottom: abstand.md }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Kräfteübersicht' }]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: abstand.xs }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>Kräfteübersicht</Typography.Title>
        <Space className="kraefte-no-print">
          {darfSchreiben && (
            <Button loading={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>In Lagebericht übernehmen</Button>
          )}
          <Button onClick={handleDrucken}>Drucken / als PDF</Button>
        </Space>
      </Space>
      <Card style={{ marginBottom: abstand.lg }} styles={{ body: { overflowX: 'auto' } }}>
        {/* Monitoring-Kopf: nicht umbrechend, bei schmalem Viewport horizontal scrollbar. */}
        <Space size="large" align="start" style={{ flexWrap: 'nowrap' }}>
          {/* Achse 1: Personalstärke */}
          <Space size="large">
            <Statistic title="Gesamtstärke (F/UF/M//Ges)" value={staerkeText(v.staerke)} />
            <Statistic title="Personal" value={v.anzahlPersonal} />
          </Space>

          {achsenTrenner(token)}

          {/* Achse 2: Fahrzeug-Verfügbarkeit */}
          <Space size="large">
            <Statistic title="Fahrzeuge" value={v.anzahlFahrzeuge} />
            {/* Dieselben drei Rollen wie die Statusspalte — die Kopfzahl und der Tag
                darunter dürfen nicht in verschiedenen Rottönen sprechen. */}
            <Statistic
              title="Fzg frei"
              value={v.fahrzeugStatus.verfuegbar}
              styles={{ content: { color: rollenFarbe(statusKategorie.verfuegbar.rolle, token) } }}
            />
            <Statistic
              title="Fzg gebunden"
              value={v.fahrzeugStatus.gebunden}
              styles={{ content: { color: rollenFarbe(statusKategorie.gebunden.rolle, token) } }}
            />
            <Statistic
              title="Fzg n. einsatzbereit"
              value={v.fahrzeugStatus.nicht_verfuegbar}
              styles={{ content: { color: rollenFarbe(statusKategorie.nicht_verfuegbar.rolle, token) } }}
            />
          </Space>

          {achsenTrenner(token)}

          {/* Achse 3: Material */}
          <Space size="large">
            <Statistic title="Material (Pos.)" value={v.anzahlMaterialPositionen} />
            {MAT_STATUS_ANZEIGE.map(({ key, label, rolle }) =>
              v.materialStatus[key] > 0 ? (
                <Statistic
                  key={key}
                  title={label}
                  value={v.materialStatus[key]}
                  styles={{ content: rolle ? { color: rollenFarbe(rolle, token) } : undefined }}
                />
              ) : null,
            )}
          </Space>
        </Space>
      </Card>
      <Card className="kraefte-no-print" style={{ marginBottom: abstand.md }}>
        <Space wrap>
          <Select
            placeholder="Abschnitt"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.abschnittId ?? undefined}
            options={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v) => setFilter((f) => ({ ...f, abschnittId: v ?? null }))}
          />
          <Select
            placeholder="Trägerorganisation"
            allowClear
            style={{ minWidth: 180 }}
            value={filter.traeger ?? undefined}
            options={traeger.map((t) => ({ value: t, label: t }))}
            onChange={(v) => setFilter((f) => ({ ...f, traeger: v ?? null }))}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.kategorie ?? undefined}
            options={[
              { value: 'verfuegbar' as const, label: 'verfügbar' },
              { value: 'gebunden' as const, label: 'gebunden' },
              { value: 'nicht_verfuegbar' as const, label: 'nicht verfügbar' },
            ]}
            onChange={(v) => setFilter((f) => ({ ...f, kategorie: v ?? null }))}
          />
          <Input.Search
            placeholder="Suche..."
            allowClear
            style={{ width: 220 }}
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          />
        </Space>
      </Card>
      <Table<MeldebildZeile>
        columns={spalten} dataSource={bild.baum} pagination={false}
        rowKey="key"
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
          childrenColumnName: 'children',
        }}
        locale={{ emptyText: 'Keine Kräfte im Einsatz disponiert' }} />
    </div>
  );
}
