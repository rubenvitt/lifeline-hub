import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeVersionsstand, markiereNeuigkeitenGelesen } from '../api/versionsstand';
import { globalKeys } from '../api/queryKeys';
import type { VersionsstandAnzeige } from '../api/types';

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
 * Gibt es eine Version, die noch nicht als gelesen gilt? Dasselbe Urteil wie der Punkt im
 * Benutzermenü und die Hinweiskarte (Spec `neuigkeiten`).
 */
export function istUngelesen(stand: VersionsstandAnzeige | undefined): boolean {
  return !!stand && !!stand.gelesen_bis && stand.gelesen_bis !== stand.laufend;
}
