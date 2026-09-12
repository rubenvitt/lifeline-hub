import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { uhsDetailPfad } from '../../routing/deeplinks';
import { listeUhs } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import UhsAnlegenDrawer from './UhsAnlegenDrawer';
import type { Uhs, UhsStatus } from '../../api/types';
import { uhsStatus } from '../../theme/statusFarben';
import EinstiegSwitcher from '../../components/EinstiegSwitcher';

/** Sortierrang — fachliche Reihenfolge dieser Liste, keine Darstellung (bleibt lokal, s. Bestand). */
const STATUS_RANG: Record<UhsStatus, number> = { aktiv: 0, geplant: 1, aufgeloest: 2 };

/** Header-Switcher im UHS-Detail — UHS-Belegung von `EinstiegSwitcher`. */
export default function UhsSwitcher({
  einsatzId,
  aktuelleUhs,
}: {
  einsatzId: number;
  aktuelleUhs: Uhs;
}) {
  const navigate = useNavigate();
  const [anlegen, setAnlegen] = useState(false);
  const { data: liste = [] } = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  return (
    <>
      <EinstiegSwitcher
        aktuell={aktuelleUhs}
        eintraege={liste.map((u) => ({
          id: u.id,
          bezeichnung: u.bezeichnung,
          darstellung: uhsStatus[u.status],
          rang: STATUS_RANG[u.status],
        }))}
        onWechsel={(uhsId) => navigate(uhsDetailPfad(einsatzId, uhsId))}
        neuLabel="+ Neue UHS"
        onNeu={() => setAnlegen(true)}
      />
      <UhsAnlegenDrawer
        einsatzId={einsatzId}
        open={anlegen}
        onClose={() => setAnlegen(false)}
        onAngelegt={(uhs) => navigate(uhsDetailPfad(einsatzId, uhs.id))}
      />
    </>
  );
}
