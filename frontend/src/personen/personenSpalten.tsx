import { Select, Tag, Typography, type TableColumnsType } from 'antd';
import { registrierAnzeige } from '../api/einsatzPerson';
import type { Person } from '../api/types';
import { SK_META, STATUS_META } from './personMeta';

/** Alter-Anzeige: Geburtsdatum > geschätztes Alter > „—". */
function alterAnzeige(p: Person): string {
  if (p.geburtsdatum) return p.geburtsdatum;
  if (p.alter_geschaetzt != null) return `~${p.alter_geschaetzt} J.`;
  return '—';
}

/** Basis-Spalten der Personen-Tabelle (Reg.-Nr., Status, SK, Name, …) — reine Anzeige,
 *  ohne Aktionen. Wird sowohl in der Listen- als auch in der Patienten-Sicht genutzt. */
export const personenSpalten: TableColumnsType<Person> = [
  {
    title: 'Reg.-Nr.', key: 'reg', width: 100,
    render: (_, p) => <Typography.Text strong>{registrierAnzeige(p.registrier_nr)}</Typography.Text>,
  },
  {
    title: 'Status', key: 'status', width: 130,
    render: (_, p) => <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>,
  },
  {
    title: 'SK', key: 'sk', width: 90,
    render: (_, p) =>
      p.aktuelle_sichtung
        ? <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>
        : <Typography.Text type="secondary">—</Typography.Text>,
  },
  {
    title: 'Name', key: 'name',
    render: (_, p) =>
      p.name || p.vorname
        ? `${p.name ?? ''}${p.vorname ? `, ${p.vorname}` : ''}`
        : <Typography.Text type="secondary">unbekannt</Typography.Text>,
  },
  { title: 'Geschlecht', dataIndex: 'geschlecht', key: 'geschlecht', render: (g) => g ?? '—' },
  { title: 'Alter', key: 'alter', render: (_, p) => alterAnzeige(p) },
  { title: 'Antreffort', dataIndex: 'antreff_ort', key: 'antreff_ort', render: (t) => t ?? '—' },
];

/** Zusatzspalte „Abgleich vorschlagen" (nur Vermisst-Sicht mit Schreibrecht): je Vermisst-Zeile
 *  ein Select über die gefundenen Personen. `onAbgleich` löst den Verdachts-Abgleich aus. */
export function abgleichSpalte(
  gefundene: Person[],
  onAbgleich: (vermisstId: number, gefundenId: number) => void,
): TableColumnsType<Person> {
  return [{
    title: 'Abgleich vorschlagen', key: 'abgleich', width: 220,
    render: (_: unknown, v: Person) => (
      <Select<number> placeholder="gefundene Person …" size="small" style={{ width: 200 }}
        onClick={(e) => e.stopPropagation()}
        onChange={(gid) => onAbgleich(v.id, gid)}
        options={gefundene.map((g) => ({ value: g.id, label: `${registrierAnzeige(g.registrier_nr)} ${g.name ?? 'unbekannt'}` }))}
        disabled={gefundene.length === 0}
      />
    ),
  }];
}
