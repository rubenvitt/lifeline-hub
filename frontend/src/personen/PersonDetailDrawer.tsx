import { Alert, Button, Descriptions, Drawer, Space, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { personDetailPfad } from '../routing/deeplinks';
import { ladePerson, registrierAnzeige } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import type { PersonDetail, Sichtungskategorie, Verbleib } from '../api/types';
import { SK_META, STATUS_META } from './personMeta';

// Schlanker, NUR-LESEN Personen-Detail-Drawer für Kontexte außerhalb der vollen
// Personen-Verwaltung (z. B. Klick auf einen Patienten im UHS-Grundriss). Zeigt
// Identität, Status und den medizinischen Verlauf; das vollständige Bearbeiten
// (Sichtung/Verbleib/Storno) bleibt der Personen-Liste vorbehalten („vollständig öffnen").
//
// Nutzt denselben Query-Key wie die Personen-Liste (['einsatz-person', …]) → der
// Cache wird geteilt, Live-Invalidierungen greifen für beide.

const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];
function istPatient(p: PersonDetail): boolean {
  return p.aktuelle_sichtung != null && PATIENT_SK.includes(p.aktuelle_sichtung);
}

function kurzVerbleib(v: Verbleib): string {
  const ziel = v.ziel ? ` → ${v.ziel}` : '';
  const tm = v.transportmittel ? ` (${v.transportmittel})` : '';
  switch (v.art) {
    case 'transport': return `Transport${ziel}${tm}`;
    case 'entlassung': return 'entlassen';
    case 'vor_ort': return 'verbleibt vor Ort';
    case 'verstorben': return 'Verbleib des Leichnams';
  }
}

function verlaufInhalt(p: PersonDetail): React.ReactNode {
  // Chronologischer medizinischer Verlauf (neueste zuerst) — Sichtungen, Notizen, Verbleib.
  const eintraege = [
    ...(p.sichtungen ?? []).map((s) => ({
      key: `s-${s.id}`, at: s.gesichtet_at,
      node: <span><Tag color={SK_META[s.kategorie].color}>{SK_META[s.kategorie].label}</Tag>
        {s.notiz && <Typography.Text type="secondary"> — {s.notiz}</Typography.Text>}</span>,
    })),
    ...(p.notizen ?? []).map((n) => ({
      key: `n-${n.id}`, at: n.erfasst_at,
      node: <span><Tag>Notiz</Tag> {n.text}</span>,
    })),
    ...(p.verbleib ?? []).map((v) => ({
      key: `v-${v.id}`, at: v.zeitpunkt_at,
      node: <span><Tag color="purple">Verbleib</Tag> {kurzVerbleib(v)}</span>,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (eintraege.length === 0) return <Typography.Text type="secondary">noch kein Verlauf</Typography.Text>;
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
      {eintraege.map((e) => (
        <li key={e.key} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
          {e.node}
          <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{e.at}</Typography.Text></div>
        </li>
      ))}
    </ul>
  );
}

export default function PersonDetailDrawer({
  einsatzId, personId, onClose,
}: { einsatzId: number; personId: number | null; onClose: () => void }) {
  const navigate = useNavigate();
  const detailQuery = useQuery({
    queryKey: ['einsatz-person', einsatzId, personId],
    queryFn: () => ladePerson(einsatzId, personId!),
    enabled: personId != null,
  });
  const p = detailQuery.data;

  return (
    <Drawer
      open={personId != null}
      width={460}
      title={p ? `Person ${registrierAnzeige(p.registrier_nr)}` : 'Person'}
      onClose={onClose}
      extra={p && (
        <Button type="link" size="small" onClick={() => navigate(personDetailPfad(einsatzId, p.id))}>
          Vollständig öffnen
        </Button>
      )}
    >
      {detailQuery.isLoading && <Spin />}
      {detailQuery.isError && (
        <Alert
          type="error"
          showIcon
          message="Person konnte nicht geladen werden"
          description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
          action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
        />
      )}
      {p && (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Space wrap>
            <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
            {istPatient(p) && <Tag color="geekblue">Patient</Tag>}
            {p.aktuelle_sichtung
              ? <Tag color={SK_META[p.aktuelle_sichtung].color}>SK: {SK_META[p.aktuelle_sichtung].label}</Tag>
              : <Tag>ungesichtet</Tag>}
            {p.aktueller_verbleib && <Tag color="purple">{p.aktueller_verbleib}</Tag>}
            {p.storniert_at && <Tag color="default">storniert</Tag>}
          </Space>

          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Name">{p.name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Vorname">{p.vorname ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geschlecht">{p.geschlecht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geburtsdatum">{p.geburtsdatum ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Alter (geschätzt)">{p.alter_geschaetzt ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Herkunft / Adresse">{p.herkunft_adresse ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Antreffort">{p.antreff_ort ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Melder / Kontakt">{p.melder_kontakt ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Notiz">{p.notiz ?? '—'}</Descriptions.Item>
          </Descriptions>

          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
              Medizinischer Verlauf (neueste zuerst)
            </Typography.Text>
            <div style={{ marginTop: 4 }}>{verlaufInhalt(p)}</div>
          </div>
        </Space>
      )}
    </Drawer>
  );
}
