import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { StatusKategorie } from '../api/types';

interface Optionen<T extends { id: number }, V> {
  /** Listen-Query, deren Zeile optimistisch geändert wird. */
  queryKey: QueryKey;
  mutationFn: (v: V) => Promise<T>;
  zeilenId: (v: V) => number;
  /** Die Zeile mit dem erwarteten Stand, bevor der Server antwortet. */
  anwenden: (zeile: T, v: V) => T;
  /** Trägt die Zeile noch den optimistischen Stand? Nur dann wird zurückgenommen. */
  nochOptimistisch: (zeile: T, v: V) => boolean;
  zuruecknehmen: (zeile: T, vorher: T) => T;
  onErfolg?: () => void;
  onFehler: (e: unknown) => void;
  onSettled: () => void;
}

/**
 * Optimistische Änderung EINER Zeile einer Listen-Query: sofort anwenden, mit dem
 * Serverstand ersetzen, bei einem Fehler zurücknehmen — aber nur, wenn die Zeile noch den
 * eigenen optimistischen Stand trägt; eine inzwischen eingetroffene fremde Änderung bleibt.
 */
export function useOptimistischesZeilenUpdate<T extends { id: number }, V>({
  queryKey,
  mutationFn,
  zeilenId,
  anwenden,
  nochOptimistisch,
  zuruecknehmen,
  onErfolg,
  onFehler,
  onSettled,
}: Optionen<T, V>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey });
      const id = zeilenId(v);
      const vorher = qc.getQueryData<T[]>(queryKey)?.find((z) => z.id === id);
      qc.setQueryData<T[]>(queryKey, (alt) => alt?.map((z) => (z.id === id ? anwenden(z, v) : z)));
      return { vorher };
    },
    onSuccess: (serverStand: T) => {
      qc.setQueryData<T[]>(queryKey, (alt) =>
        alt?.map((z) => (z.id === serverStand.id ? serverStand : z)),
      );
      onErfolg?.();
    },
    onError: (e, v, kontext) => {
      const vorher = kontext?.vorher;
      if (vorher) {
        const id = zeilenId(v);
        qc.setQueryData<T[]>(queryKey, (aktuell) =>
          aktuell?.map((z) =>
            z.id === id && nochOptimistisch(z, v) ? zuruecknehmen(z, vorher) : z,
          ),
        );
      }
      onFehler(e);
    },
    onSettled,
  });
}

interface KatalogStatusZeile {
  status_id?: number | null;
  status_label?: string | null;
  status_kategorie?: StatusKategorie | null;
  status_farbe?: string | null;
}

interface KatalogStatus {
  id: number;
  label: string;
  kategorie: StatusKategorie;
  farbe?: string | null;
}

/** Anwenden und Zurücknehmen eines Katalogstatus (Fahrzeug- oder Personal-Status). */
export function katalogStatusWechsel<T extends KatalogStatusZeile>(
  katalog: KatalogStatus[] | undefined,
) {
  return {
    anwenden: (zeile: T, v: { statusId: number }): T => {
      const status = katalog?.find((s) => s.id === v.statusId);
      return {
        ...zeile,
        status_id: v.statusId,
        status_label: status?.label ?? zeile.status_label,
        status_kategorie: status?.kategorie ?? zeile.status_kategorie,
        status_farbe: status?.farbe ?? null,
      };
    },
    nochOptimistisch: (zeile: T, v: { statusId: number }) => zeile.status_id === v.statusId,
    zuruecknehmen: (zeile: T, vorher: T): T => ({
      ...zeile,
      status_id: vorher.status_id,
      status_label: vorher.status_label,
      status_kategorie: vorher.status_kategorie,
      status_farbe: vorher.status_farbe,
    }),
  };
}
