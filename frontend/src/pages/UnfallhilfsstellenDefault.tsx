import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import { uhsDetailPfad } from '../routing/deeplinks';
import Direkteinstieg from '../components/Direkteinstieg';
import UhsAnlegenDrawer from './uhs/UhsAnlegenDrawer';
import { liesLetzteUhs, waehleDefaultUhs } from './uhs/uhsAuswahl';

/** Index-Route /einsaetze/:id/unfallhilfsstellen — UHS-Belegung von `Direkteinstieg`. */
export default function UnfallhilfsstellenDefault() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  return (
    <Direkteinstieg
      query={uhsQuery}
      waehle={(liste) => waehleDefaultUhs(liste, liesLetzteUhs(einsatzId))}
      detailPfad={(uhsId) => uhsDetailPfad(einsatzId, uhsId)}
      fehlerText="Unfallhilfsstellen konnten nicht geladen werden"
      leerTitel="Noch keine Unfallhilfsstellen erfasst"
      leerAktionLabel="Erste UHS anlegen"
      anlegen={(slot) => <UhsAnlegenDrawer einsatzId={einsatzId} {...slot} />}
    />
  );
}
