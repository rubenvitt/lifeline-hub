import { Alert, Drawer } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ladePersonenListenzugriffe } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { PersonZugriff } from '../api/types';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { zugriffArtText } from './zugriffArt';

/**
 * „Listenzugriffe“ (LFH-916, Spec `personen-zugriffsprotokoll`, design.md D2): wer die
 * Personenliste exportiert oder gedruckt hat, neueste zuerst. Schreibgeschützte Schnellansicht
 * für die Einsatzleitung — ein Drawer ist dafür zulässig (`frontend/AGENTS.md`, UI-Form-Leitlinie).
 *
 * Lädt erst offen und ohne Wiederholung, wie das Zugriffs-Audit je Person; der Key ist bewusst
 * nicht live (`NICHT_LIVE_KEYS`). Die Einsicht selbst wird nicht protokolliert.
 */
export default function ListenzugriffeDrawer({
  einsatzId,
  offen,
  onClose,
}: {
  einsatzId: number;
  offen: boolean;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: einsatzKeys.personenListenzugriffe(einsatzId),
    queryFn: () => ladePersonenListenzugriffe(einsatzId),
    enabled: offen,
    retry: false,
  });
  const spalten: KatalogSpalte<PersonZugriff>[] = [
    {
      title: 'Wann',
      dataIndex: 'zugriff_at',
      key: 'zugriff_at',
      render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" />,
    },
    { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
    {
      title: 'Art',
      dataIndex: 'art',
      key: 'art',
      render: (art: PersonZugriff['art']) => zugriffArtText(art),
    },
  ];

  return (
    <Drawer open={offen} size={460} title="Listenzugriffe" onClose={onClose}>
      {query.isError ? (
        <Alert type="error" showIcon title="Listenzugriffe konnten nicht geladen werden" />
      ) : (
        <KatalogTabelle<PersonZugriff>
          rowKey="id"
          pagination={false}
          loading={query.isLoading}
          dataSource={query.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Die Personenliste wurde noch nicht exportiert oder gedruckt' }}
        />
      )}
    </Drawer>
  );
}
