import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeVersionsstand, markiereNeuigkeitenGelesen } from '../api/versionsstand';
import { globalKeys } from '../api/queryKeys';
import type { VersionsstandAnzeige } from '../api/types';
import { istVersionVor } from './version';

/** Der Versionsstand der Instanz. Ohne Netz bleibt er leer; dann gibt es keinen Hinweis. */
export function useVersionsstand() {
  return useQuery({
    queryKey: globalKeys.versionsstand(),
    queryFn: ladeVersionsstand,
  });
}

/**
 * Markiert die laufende Version als gelesen. Die Antwort wird sofort in den Cache geschrieben,
 * damit Hinweiskarte und Punkt verschwinden, ohne einen zweiten Abruf.
 */
export function useMarkiereGelesen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markiereNeuigkeitenGelesen,
    onSuccess: (stand: VersionsstandAnzeige) => {
      qc.setQueryData(globalKeys.versionsstand(), stand);
    },
  });
}

/**
 * Liegt der Lesestand vor der laufenden Version? Das Urteil für den Punkt im Benutzermenü und das
 * Laden der Hinweiskarte (Spec `neuigkeiten`). Nach einer Rückkehr auf eine ältere Version gibt es
 * nichts zu lesen.
 */
export function istUngelesen(
  stand: Pick<VersionsstandAnzeige, 'laufend' | 'gelesen_bis'> | undefined,
): boolean {
  return !!stand?.gelesen_bis && istVersionVor(stand.gelesen_bis, stand.laufend);
}
