import { useQuery } from '@tanstack/react-query';
import { ladeBetreuung } from '../api/betreuung';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { ladeBr } from '../api/einsatzBereitstellungsraum';
import { ladeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import type { GeraetAnzeige } from '../api/types';

/**
 * Name der gebundenen Stelle, live (LLH-1155). `geraet.stelle` kommt aus `/api/auth/me` und
 * bleibt bis zum Neuladen der Sitzung stehen; benennt die Einsatzleitung die Stelle um, stünde
 * sonst der alte Name im Kopf. Gelesen wird deshalb aus derselben Abfrage, die die Seiten der
 * Ansicht ohnehin halten (gleicher Key, ein Abruf): das Ereignis der Stelle (`uhs`,
 * `bereitstellungsraum`, `abschnitt`, `betreuung`) frischt sie über den Einsatzstrom auf.
 * Solange sie nichts hat (Laden, ohne Netz, Fehler), gilt der Name der Sitzung. Ohne Stelle
 * (Lagemonitor, Verpflegung) `null`.
 */
export function useStellenName(geraet: GeraetAnzeige | null): string | null {
  const eid = geraet?.einsatz_id ?? 0;
  const id = geraet?.stelle_id ?? geraet?.uhs_id ?? null;
  const ansicht = geraet?.ansicht;
  const istUhs = ansicht === 'uhs-tablet' || ansicht === 'uhs-laptop';
  const uhs = useQuery({
    queryKey: einsatzKeys.uhsDetail(eid, id ?? 0),
    queryFn: () => ladeUhs(eid, id!),
    enabled: istUhs && id != null,
    select: (d) => d.bezeichnung,
  });
  const br = useQuery({
    queryKey: einsatzKeys.brDetail(eid, id ?? 0),
    queryFn: () => ladeBr(eid, id!),
    enabled: ansicht === 'bereitstellungsraum' && id != null,
    select: (d) => d.bezeichnung,
  });
  const abschnitt = useQuery({
    queryKey: einsatzKeys.abschnitte(eid),
    queryFn: () => listeAbschnitte(eid),
    enabled: ansicht === 'einsatzabschnitt' && id != null,
    select: (liste) => liste.find((a) => a.id === id)?.name,
  });
  const betreuung = useQuery({
    queryKey: einsatzKeys.betreuung(eid),
    queryFn: () => ladeBetreuung(eid),
    enabled: ansicht === 'betreuungsstelle' && id != null,
    select: (d) => d.stellen.find((s) => s.id === id)?.bezeichnung,
  });
  if (!geraet) return null;
  const live = istUhs
    ? uhs.data
    : ansicht === 'bereitstellungsraum'
      ? br.data
      : ansicht === 'einsatzabschnitt'
        ? abschnitt.data
        : ansicht === 'betreuungsstelle'
          ? betreuung.data
          : undefined;
  return live ?? geraet.stelle ?? null;
}
