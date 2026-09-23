import { Button, Drawer } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { personDetailPfad } from '../routing/deeplinks';
import { ladePerson, registrierAnzeige } from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import PersonVorschau from './PersonVorschau';

// Schlanker, NUR-LESEN Personen-Detail-Drawer für Kontexte außerhalb der vollen
// Personen-Verwaltung (z. B. Klick auf einen Patienten im UHS-Grundriss). Der Inhalt ist
// `PersonVorschau` — derselbe, den die Sprungpalette als Vorschau zeigt (LFH-645); hier
// liegt nur der Rahmen: Titel und „Vollständig öffnen".
//
// Der Titel liest denselben Query-Key wie die Vorschau (['einsatz-person', …]) → EIN
// Cache-Fach, kein zweiter Request, Live-Invalidierungen greifen für beide.

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
  const detailQuery = useQuery({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId!),
    enabled: personId != null,
  });
  const p = detailQuery.data;

  return (
    <Drawer
      open={personId != null}
      size={460}
      title={p ? `Person ${registrierAnzeige(p.registrier_nr)}` : 'Person'}
      onClose={onClose}
      extra={
        p && (
          <Button type="link" onClick={() => navigate(personDetailPfad(einsatzId, p.id))}>
            Vollständig öffnen
          </Button>
        )
      }
    >
      {personId != null && <PersonVorschau einsatzId={einsatzId} personId={personId} />}
    </Drawer>
  );
}
