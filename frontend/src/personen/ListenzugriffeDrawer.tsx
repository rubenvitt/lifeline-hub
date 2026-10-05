import { Alert, Drawer } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ladePersonenListenzugriffe } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import type { PersonZugriff } from '../api/types';
import KatalogTabelle from '../components/KatalogTabelle';
import { ZUGRIFF_SPALTEN } from './zugriffSpalten';

/**
 * „Listenzugriffe“ (LFH-916, Spec `personen-zugriffsprotokoll`, design.md D2): wer die
 * Personenliste exportiert oder gedruckt hat, neueste zuerst. Schreibgeschützte Schnellansicht
 * für die Einsatzleitung — ein Drawer ist dafür zulässig (`frontend/AGENTS.md`, UI-Form-Leitlinie).
 *
 * Lädt erst offen und ohne Wiederholung, wie das Zugriffs-Audit je Person; der Key ist bewusst
 * nicht live (`NICHT_LIVE_KEYS`). Jedes Öffnen lädt frisch (`staleTime: 0`): der Drawer bleibt
 * eingehängt, und ein Export kurz vor dem erneuten Öffnen fehlte sonst. Die Einsicht selbst wird
 * nicht protokolliert.
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
    staleTime: 0,
  });

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
          columns={ZUGRIFF_SPALTEN}
          locale={{ emptyText: 'Die Personenliste wurde noch nicht exportiert oder gedruckt' }}
        />
      )}
    </Drawer>
  );
}
