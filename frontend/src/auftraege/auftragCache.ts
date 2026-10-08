import type { InfiniteData } from '@tanstack/react-query';
import type { Auftrag } from '../api/types';

/*
 * Unter dem Prefix `auftraege` liegen seit LFH-1071 vier Formen: Listen (Vollliste, offene Liste),
 * die Seitenkette der Abgeschlossenen, der Einzelabruf und die Kennzahlen. Ein optimistisches
 * Update über den ganzen Prefix darf nur Aufträge anfassen und muss jede Form behalten
 * (design.md D5).
 */

function istSeitenkette(daten: unknown): daten is InfiniteData<Auftrag[]> {
  return (
    daten != null &&
    typeof daten === 'object' &&
    Array.isArray((daten as { pages?: unknown }).pages)
  );
}

function istAuftrag(daten: unknown): daten is Auftrag {
  return (
    daten != null &&
    typeof daten === 'object' &&
    typeof (daten as { id?: unknown }).id === 'number' &&
    Array.isArray((daten as { empfaenger?: unknown }).empfaenger)
  );
}

/** Wendet `fn` auf jeden Auftrag einer Cache-Form an; Kennzahlen und Unbekanntes bleiben. */
export function ersetzeAuftraege(daten: unknown, fn: (a: Auftrag) => Auftrag): unknown {
  if (Array.isArray(daten)) return (daten as Auftrag[]).map(fn);
  if (istSeitenkette(daten)) return { ...daten, pages: daten.pages.map((s) => s.map(fn)) };
  if (istAuftrag(daten)) return fn(daten);
  return daten;
}

/** Sucht einen Auftrag in einer Cache-Form. */
export function findeAuftrag(daten: unknown, id: number): Auftrag | undefined {
  if (Array.isArray(daten)) return (daten as Auftrag[]).find((a) => a.id === id);
  if (istSeitenkette(daten)) {
    for (const seite of daten.pages) {
      const treffer = seite.find((a) => a.id === id);
      if (treffer) return treffer;
    }
    return undefined;
  }
  if (istAuftrag(daten)) return daten.id === id ? daten : undefined;
  return undefined;
}
