import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { schadenDetailPfad } from '../routing/deeplinks';
import { Button, Input, Space, Tabs, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import type { TableColumnsType } from 'antd';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeSchaeden, schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import type { Ausmass, Schaden, SchadenStatus, SchadenTyp } from '../api/types';
import { AUSMASS_META, STATUS_META, TYP_LABEL, filterSchaeden, geschaedigtAnzeige } from './schaeden/schadenHelfer';
import SchadenErfassenModal from './schaeden/SchadenErfassenModal';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';

type Sicht = 'offen' | 'uebergeben' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'offen', label: 'Offen' },
  { key: 'uebergeben', label: 'Übergeben' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

export default function SchaedenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sicht, setSicht] = useState<Sicht>('offen');
  const [typFilter, setTypFilter] = useState<SchadenTyp | undefined>(undefined);
  const [ausmassFilter, setAusmassFilter] = useState<Ausmass | undefined>(undefined);
  const [suche, setSuche] = useState('');

  const [erfassenOffen, setErfassenOffen] = useState(false);

  // Schaden-Liste wird über den konsolidierten Einsatz-Live-Stream (useEinsatzLiveStream
  // im EinsatzLayout, `schaden`-Event → 'einsatz-schaeden') live gehalten — LFH-206.
  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });

  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Schnellaktion: ?neu=1 öffnet die Erfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreiben) setErfassenOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreiben]);

  const alle = schaedenQuery.data ?? [];
  const sichtbar = filterSchaeden(alle, { sicht, typ: typFilter, ausmass: ausmassFilter, suche });

  /**
   * LISTENZUSTAND — an der Stelle der Tabelle entschieden, nie als Frühausstieg
   * (LFH-331 · B3, D3).
   *
   * KEIN Seitenzustand-Frühausstieg an `einsatzQuery` auf dieser Seite: sie trägt keine
   * Breadcrumb und kommt ohne den Einsatz aus (`einsatz?.org_id`, `einsatz?.org_name` unten
   * haben eigene Rückfallwerte). Ein Frühausstieg wäre hier also keine Vereinheitlichung,
   * sondern eine neue Route-Verhaltensänderung — die gehört nicht in dieses Bündel.
   *
   * Gemessen wird an `alle`, NICHT an `sichtbar`: die gefilterte Menge ist bei gesetztem
   * Reiter, Typ, Ausmaß oder Suchbegriff regelmäßig leer, während Zeilen im Zwischenspeicher
   * stehen — an ihr gemessen kippte die Seite bei jedem engen Filter in den Fehlerzweig.
   *
   * Ohne Zeilen tritt der Fehler an die Stelle der Tabelle, sonst behauptet „Keine Schäden
   * in dieser Sicht" eine leere Menge, wo bloß der Abruf scheiterte. Mit Zeilen bleiben sie
   * stehen und bekommen ein Banner: echt, nur womöglich alt. Der Ladezweig steht bewusst
   * nicht hier, sondern am Primitiv (`loading`).
   */
  const listeGescheitert = schaedenQuery.isError && alle.length === 0;
  const standVeraltet = schaedenQuery.isError && alle.length > 0;

  const spalten: TableColumnsType<Schaden> = [
    {
      title: 'Nr.',
      dataIndex: 'registrier_nr',
      render: (nr: number) => <strong>{schadenRegistrierAnzeige(nr)}</strong>,
    },
    { title: 'Typ', dataIndex: 'typ', render: (t: SchadenTyp) => <Tag>{TYP_LABEL[t]}</Tag> },
    {
      title: 'Ausmaß',
      dataIndex: 'ausmass',
      render: (a: Ausmass) => <Tag color={AUSMASS_META[a].color}>{AUSMASS_META[a].label}</Tag>,
    },
    { title: 'Ort', dataIndex: 'ort', ellipsis: true },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (st: SchadenStatus, row) => (
        <Tag color={STATUS_META[st].color}>
          {STATUS_META[st].label}
          {st === 'uebergeben' && row.uebergeben_an ? ` (${row.uebergeben_an})` : ''}
        </Tag>
      ),
    },
    { title: 'Geschädigt', key: 'geschaedigt', render: (_, row) => geschaedigtAnzeige(row, einsatzId) },
  ];

  const orgId = einsatz?.org_id ?? 0;

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Schäden
        </Typography.Title>
        {darfSchreiben && (
          <Button type="primary" onClick={() => setErfassenOffen(true)}>
            Schnellerfassung
          </Button>
        )}
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Typ"
          style={{ width: 180 }}
          value={typFilter}
          onChange={setTypFilter}
          options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))}
        />
        <Select
          allowClear
          placeholder="Ausmaß"
          style={{ width: 160 }}
          value={ausmassFilter}
          onChange={setAusmassFilter}
          options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))}
        />
        <Input.Search
          placeholder="Ort/Beschreibung"
          allowClear
          style={{ width: 220 }}
          onChange={(e) => setSuche(e.target.value)}
        />
      </Space>

      {listeGescheitert ? (
        <SeitenFehler
          text="Schäden konnten nicht geladen werden"
          ursache={schaedenQuery.error}
          onWiederholen={() => void schaedenQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void schaedenQuery.refetch()} />}

          <KatalogTabelle<Schaden>
            rowKey="id"
            loading={schaedenQuery.isLoading}
            dataSource={sichtbar}
            columns={spalten}
            pagination={false}
            locale={{ emptyText: 'Keine Schäden in dieser Sicht' }}
            onRow={(row) => ({
              onClick: () => navigate(schadenDetailPfad(einsatzId, row.id)),
              style: { cursor: 'pointer' },
            })}
          />
        </>
      )}

      <SchadenErfassenModal
        open={erfassenOffen}
        onClose={() => setErfassenOffen(false)}
        einsatzId={einsatzId}
        orgId={orgId}
        orgName={einsatz?.org_name ?? 'Eigene Organisation'}
      />
    </div>
  );
}
