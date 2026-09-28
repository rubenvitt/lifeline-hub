import { useCallback, useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface Eintrag<T> {
  einsatzId: number;
  zeile: T;
  bestaetigenNach: number;
}

/**
 * Frisch angelegte Zeilen einer Einsatzliste als lokales Overlay über der Listen-Query.
 *
 * Eine Zeile lebt bis zu dem Refetch, der ihre ID erstmals bestätigt. So kann weder ein
 * alter GET noch Replikationsverzug die neue Zeile ausblenden; bei noch fehlendem Cache
 * wird zugleich keine scheinbar vollständige Serverliste erfunden.
 */
export function useFrischAngelegt<T extends { id: number }>(
  einsatzId: number,
  listenKey: (einsatzId: number) => QueryKey,
  server: { data: T[] | undefined; dataUpdatedAt: number },
) {
  const qc = useQueryClient();
  const [frisch, setFrisch] = useState<Eintrag<T>[]>([]);

  const merke = useCallback(
    (zielEinsatzId: number, zeilen: T[], stand?: number) => {
      const ids = new Set(zeilen.map((z) => z.id));
      setFrisch((alt) => {
        const bestaetigenNach =
          stand ?? qc.getQueryState(listenKey(zielEinsatzId))?.dataUpdatedAt ?? 0;
        return [
          ...zeilen.map((zeile) => ({ einsatzId: zielEinsatzId, zeile, bestaetigenNach })),
          ...alt.filter((e) => e.einsatzId !== zielEinsatzId || !ids.has(e.zeile.id)),
        ];
      });
    },
    [qc, listenKey],
  );

  const { data, dataUpdatedAt } = server;
  useEffect(() => {
    const serverIds = new Set((data ?? []).map((z) => z.id));
    if (serverIds.size === 0) return;
    setFrisch((alt) => {
      const offen = alt.filter(
        (e) =>
          e.einsatzId !== einsatzId ||
          dataUpdatedAt <= e.bestaetigenNach ||
          !serverIds.has(e.zeile.id),
      );
      return offen.length === alt.length ? alt : offen;
    });
  }, [einsatzId, data, dataUpdatedAt]);

  const aktuelle = frisch.filter((e) => e.einsatzId === einsatzId).map((e) => e.zeile);
  const frischeIds = new Set(aktuelle.map((z) => z.id));
  const alle = [...aktuelle, ...(data ?? []).filter((z) => !frischeIds.has(z.id))];
  return { alle, merke };
}
