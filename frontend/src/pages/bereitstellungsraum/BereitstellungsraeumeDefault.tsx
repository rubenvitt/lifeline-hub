import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeBr } from '../../api/einsatzBereitstellungsraum';
import { einsatzKeys } from '../../api/queryKeys';
import { bereitstellungsraumDetailPfad } from '../../routing/deeplinks';
import Direkteinstieg from '../../components/Direkteinstieg';
import BrAnlegenDrawer from './BrAnlegenDrawer';
import { liesLetztenBr, waehleDefaultBr } from './brAuswahl';

/** Index-Route /einsaetze/:id/bereitstellungsraeume — BR-Belegung von `Direkteinstieg`. */
export default function BereitstellungsraeumeDefault() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
  });
  return (
    <Direkteinstieg
      query={brQuery}
      waehle={(liste) => waehleDefaultBr(liste, liesLetztenBr(einsatzId))}
      detailPfad={(brId) => bereitstellungsraumDetailPfad(einsatzId, brId)}
      fehlerText="Bereitstellungsräume konnten nicht geladen werden"
      leerTitel="Noch keine Bereitstellungsräume erfasst"
      leerAktionLabel="Ersten BR anlegen"
      anlegen={(slot) => <BrAnlegenDrawer einsatzId={einsatzId} {...slot} />}
    />
  );
}
