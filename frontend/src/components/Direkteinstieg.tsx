import { Navigate, useNavigate } from 'react-router';
import { useRef, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from './SeitenZustand';

interface AnlegenSlot<T> {
  open: boolean;
  onClose: () => void;
  onAngelegt: (eintrag: T) => void;
}

export interface DirekteinstiegProps<T extends { id: number }> {
  query: UseQueryResult<T[]>;
  /** Trifft die Wahl aus der ersten geladenen Liste — meist `waehleDefaultEintrag` mit gemerkter id. */
  waehle: (liste: T[]) => number | null;
  /** Aus `routing/deeplinks.ts`; das Primitiv kennt keine Einsatz-Routen. */
  detailPfad: (id: number) => string;
  fehlerText: string;
  leerTitel: string;
  leerAktionLabel: string;
  /** Der Anlegen-Drawer des Moduls; er läuft über lokalen Zustand, nicht über eine Route. */
  anlegen: (slot: AnlegenSlot<T>) => ReactNode;
}

/**
 * Index-Route eines Orts-Moduls: springt in den passenden Datensatz oder zeigt bei leerer
 * Menge einen Leerzustand mit Anlegen-Aktion (LFH-347 · M56, aus `UnfallhilfsstellenDefault`).
 *
 * **Bewusst kein Live-Resync der Auswahl:** die Entscheidung fällt einmal aus dem ersten
 * geladenen Stand (`entscheidung`-Ref). Eine live angelegte UHS/ein BR reißt die Ansicht so
 * nicht weg — wer gerade im Leerzustand steht und anlegt, wird über `onAngelegt` geführt.
 */
export default function Direkteinstieg<T extends { id: number }>({
  query, waehle, detailPfad, fehlerText, leerTitel, leerAktionLabel, anlegen,
}: DirekteinstiegProps<T>) {
  const navigate = useNavigate();
  const entscheidung = useRef<{ id: number | null } | null>(null);
  if (!entscheidung.current && query.data) entscheidung.current = { id: waehle(query.data) };
  const [offen, setOffen] = useState(false);

  if (!entscheidung.current) {
    if (query.error) {
      return <SeitenFehler text={fehlerText} ursache={query.error} onWiederholen={() => void query.refetch()} />;
    }
    return <SeitenSkeleton />;
  }
  const { id } = entscheidung.current;
  if (id != null) return <Navigate to={detailPfad(id)} replace />;

  return (
    <div style={{ padding: 16 }}>
      <SeitenLeer titel={leerTitel} aktion={{ label: leerAktionLabel, onClick: () => setOffen(true) }} />
      {anlegen({ open: offen, onClose: () => setOffen(false), onAngelegt: (e) => navigate(detailPfad(e.id)) })}
    </div>
  );
}
