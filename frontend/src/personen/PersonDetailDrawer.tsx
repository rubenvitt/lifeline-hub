import { Button, Drawer } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useEinsatzPfade } from '../routing/EinsatzPfade';
import { registrierAnzeige } from '../api/einsatzPerson';
import PersonVorschau from './PersonVorschau';
import { personDetailQueryOptions } from './personDetailQuery';

// Schlanker NUR-LESEN-Drawer für Kontexte außerhalb der Personen-Verwaltung (z. B. Klick auf
// einen Patienten im UHS-Grundriss). Der Inhalt ist `PersonVorschau`; hier liegt nur der
// Rahmen: Titel und „Vollständig öffnen". Der Titel liest denselben Query-Key wie die Vorschau.

export default function PersonDetailDrawer({
  einsatzId,
  personId,
  onClose,
}: {
  einsatzId: number;
  personId: number | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const pfade = useEinsatzPfade();
  const detailQuery = useQuery(personDetailQueryOptions(einsatzId, personId));
  const p = detailQuery.data;

  return (
    <Drawer
      open={personId != null}
      size={460}
      title={p ? `Person ${registrierAnzeige(p.registrier_nr)}` : 'Person'}
      onClose={onClose}
      extra={
        p && (
          <Button type="link" onClick={() => navigate(pfade.personDetail(einsatzId, p.id))}>
            Vollständig öffnen
          </Button>
        )
      }
    >
      {personId != null && <PersonVorschau einsatzId={einsatzId} personId={personId} />}
    </Drawer>
  );
}
