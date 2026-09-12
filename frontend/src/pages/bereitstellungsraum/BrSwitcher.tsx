import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { bereitstellungsraumDetailPfad } from '../../routing/deeplinks';
import { listeBr } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import BrAnlegenDrawer from './BrAnlegenDrawer';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';
import { brStatus } from '../../theme/statusFarben';
import EinstiegSwitcher from '../../components/EinstiegSwitcher';

/** Sortierrang — fachliche Reihenfolge dieser Liste, keine Darstellung (bleibt lokal, s. Bestand). */
const STATUS_RANG: Record<BrStatus, number> = { aktiv: 0, geplant: 1, aufgeloest: 2 };

/** Header-Switcher im BR-Detail — BR-Belegung von `EinstiegSwitcher`. */
export default function BrSwitcher({
  einsatzId,
  aktuellerBr,
}: {
  einsatzId: number;
  aktuellerBr: Bereitstellungsraum;
}) {
  const navigate = useNavigate();
  const [anlegen, setAnlegen] = useState(false);
  const { data: liste = [] } = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
  });
  const sichtbar = liste.filter((b) => !b.storniert_at);
  return (
    <>
      <EinstiegSwitcher
        aktuell={aktuellerBr}
        eintraege={sichtbar.map((b) => ({
          id: b.id,
          bezeichnung: b.bezeichnung,
          darstellung: brStatus[b.status],
          rang: STATUS_RANG[b.status],
        }))}
        onWechsel={(brId) => navigate(bereitstellungsraumDetailPfad(einsatzId, brId))}
        neuLabel="+ Neuer BR"
        onNeu={() => setAnlegen(true)}
      />
      <BrAnlegenDrawer
        einsatzId={einsatzId}
        open={anlegen}
        onClose={() => setAnlegen(false)}
        onAngelegt={(br) => navigate(bereitstellungsraumDetailPfad(einsatzId, br.id))}
      />
    </>
  );
}
