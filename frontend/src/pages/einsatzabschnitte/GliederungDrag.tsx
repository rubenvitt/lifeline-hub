import { useDndContext, useDraggable, useDroppable, type Announcements } from '@dnd-kit/core';
import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Einsatzabschnitt } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { IconMenue } from '../../icons';
import { OBERSTE_EBENE, canDropAbschnitt, canDropEinheit } from './gliederungDragKern';

/**
 * Umhängen in der Gliederung per Zeiger (LFH-1212): ein Abschnitt auf einen anderen Abschnitt
 * oder auf die Wurzelzone, eine Einheit aus „Zugeordnete Einheiten“ auf einen Abschnitt.
 *
 * Gezogen wird nur mit dnd-kit und `ZugPointerSensor` (`frontend/AGENTS.md`, „Aktionen“): antds
 * `Tree draggable` zieht mit HTML5-DnD, das auf dem Führungs-Tablet nicht geht. Gegriffen wird am
 * Griff, nicht am ganzen Knoten: nur dort steht `touch-action: none`, der Finger rollt die Seite
 * über dem Rest des Baums weiter. Der Griff ist kein Tastaturziel (`aria-hidden`, kein `tabIndex`):
 * den Weg ohne Ziehen tragen das Menü „Verschieben unter …“ und für Einheiten das Feld „Abschnitt“
 * an der Einheit (WCAG 2.5.7).
 */

export type DragDaten =
  | { art: 'abschnitt'; id: number; name: string }
  | { art: 'einheit'; id: number; name: string; abschnittId: number | null };

export interface DropDaten {
  /** `null` = oberste Ebene. */
  zielId: number | null;
  /** Für die Ansage an Hilfstechnik. */
  name: string;
}

/**
 * Deutsche Ansagen statt dnd-kits englischer Vorgabe. Die Griffe sind keine Tastaturziele; die
 * Ansage begleitet nur einen Zeigerzug, etwa mit eingeschaltetem Vorleser.
 */
const zugName = (daten: unknown) => (daten as DragDaten | undefined)?.name ?? 'Eintrag';
const zielName = (daten: unknown) => (daten as DropDaten | undefined)?.name;
export const DRAG_ANSAGEN: Announcements = {
  onDragStart: ({ active }) => `${zugName(active.data.current)} gefasst.`,
  onDragOver: ({ active, over }) => {
    const ziel = zielName(over?.data.current);
    return ziel
      ? `${zugName(active.data.current)} über ${ziel}.`
      : `${zugName(active.data.current)} über keinem Ziel.`;
  },
  onDragEnd: ({ active, over }) => {
    const ziel = zielName(over?.data.current);
    return ziel
      ? `${zugName(active.data.current)} auf ${ziel} losgelassen.`
      : `${zugName(active.data.current)} losgelassen, nichts geändert.`;
  },
  onDragCancel: ({ active }) => `Ziehen von ${zugName(active.data.current)} abgebrochen.`,
};

const dragKey = (d: DragDaten) => `drag-${d.art}-${d.id}`;
const dropKey = (id: number | null) => (id === null ? 'ziel-wurzel' : `ziel-${id}`);

/**
 * Die dnd-kit-ID gilt je Instanz, nicht je Abschnitt. antds Baum (rc-tree) zeichnet beim
 * Aufklappen die Kinder in einer Animationskopie, während der Knoten selbst eingehängt bleibt —
 * nach einem Umhang klappt der neue Über-Abschnitt auf, und der verschobene Knoten steht kurz
 * zweimal da. Unter derselben ID meldete sich die Kopie zuletzt an und nahm beim Aushängen die
 * Anmeldung des stehenden Knotens mit: sein Griff zog nicht mehr (der Druck markierte Text), sein
 * Ziel nahm nichts an. Wer gezogen wird und wohin, tragen `DragDaten` und `DropDaten`, nie die ID.
 */
function useInstanzId(basis: string): string {
  return `${basis}${useId()}`;
}

/** Der laufende Zug, wenn einer läuft. */
export function useActiveDrag(): DragDaten | null {
  const { active } = useDndContext();
  return (active?.data.current as DragDaten | undefined) ?? null;
}

/** Nimmt das Ziel den laufenden Zug an? Dieselbe Regel wie das Menü (`gliederungDragKern.ts`). */
function canDrop(
  drag: DragDaten | null,
  abschnitte: readonly Einsatzabschnitt[],
  zielId: number | null,
): boolean {
  if (!drag) return false;
  return drag.art === 'abschnitt'
    ? canDropAbschnitt(abschnitte, drag.id, zielId)
    : canDropEinheit({ abschnitt_id: drag.abschnittId }, zielId);
}

/** Rahmen eines Ziels während des Zugs: gestrichelt frei, gefüllt unter dem Zeiger, sonst keiner. */
function useDropStil(frei: boolean, darueber: boolean, laeuft: boolean): CSSProperties {
  const { rollen } = useRollen();
  if (!laeuft) return {};
  if (!frei) return { cursor: 'not-allowed' };
  return {
    outline: `1px ${darueber ? 'solid' : 'dashed'} ${rollen.bedien}`,
    outlineOffset: 1,
    background: darueber ? rollen.auswahlFlaeche : undefined,
  };
}

/** Der Griff eines Abschnitts oder einer Einheit. */
export function DragHandle({ daten }: { daten: DragDaten }) {
  const { token, rollen } = useRollen();
  const id = useInstanzId(dragKey(daten));
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id,
    data: daten,
  });
  return (
    <span
      ref={(el) => {
        setNodeRef(el);
        setActivatorNodeRef(el);
      }}
      {...listeners}
      aria-hidden="true"
      data-lfh="drag-handle"
      data-drag={dragKey(daten)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Ein Zeigerziel der Staffel (LFH-365), auch wenn es kein Tastaturziel ist.
        minWidth: token.controlHeight,
        minHeight: token.controlHeight,
        verticalAlign: 'middle',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        // Ein Druck auf den Griff beginnt nie eine Textauswahl, auch nicht in den 5 px bis zum
        // Zugbeginn oder als langer Druck auf dem Tablet.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        color: rollen.gedaempft,
      }}
    >
      <IconMenue />
    </span>
  );
}

/** Ein Abschnitt der Gliederung als Ziel; sein Inhalt ist der Knoten selbst. */
export function DropKnoten({
  abschnitt,
  abschnitte,
  children,
}: {
  abschnitt: Einsatzabschnitt;
  abschnitte: readonly Einsatzabschnitt[];
  children: ReactNode;
}) {
  const drag = useActiveDrag();
  const frei = canDrop(drag, abschnitte, abschnitt.id);
  const id = useInstanzId(dropKey(abschnitt.id));
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { zielId: abschnitt.id, name: abschnitt.name } satisfies DropDaten,
    disabled: !frei,
  });
  const stil = useDropStil(frei, isOver, drag !== null);
  const gezogen = drag?.art === 'abschnitt' && drag.id === abschnitt.id;
  return (
    <span
      ref={setNodeRef}
      data-lfh="gliederung-ziel"
      data-abschnitt={abschnitt.id}
      data-ziel={drag === null ? undefined : frei ? 'frei' : 'gesperrt'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        ...stil,
        // Der gezogene Abschnitt steht als Lücke an seinem Ort; der Zug zeigt ihn am Zeiger.
        opacity: gezogen ? 0.4 : undefined,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Die Wurzelzone „Oberste Ebene“, nur während eines Abschnittszugs und UNTER dem Baum: oben
 * eingeschoben verschöbe sie den Baum unter dem Zeiger. Steht der Abschnitt schon oben, ist sie
 * gesperrt, aber da — ihr Fehlen verwirrte.
 */
export function ObersteEbeneDropZone({ abschnitte }: { abschnitte: readonly Einsatzabschnitt[] }) {
  const { token, rollen } = useRollen();
  const drag = useActiveDrag();
  const frei = canDrop(drag, abschnitte, null);
  const { setNodeRef, isOver } = useDroppable({
    id: dropKey(null),
    data: { zielId: null, name: OBERSTE_EBENE } satisfies DropDaten,
    disabled: !frei,
  });
  const stil = useDropStil(frei, isOver, drag !== null);
  if (drag?.art !== 'abschnitt') return null;
  return (
    <div
      ref={setNodeRef}
      data-lfh="gliederung-wurzel"
      data-ziel={frei ? 'frei' : 'gesperrt'}
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: token.controlHeight,
        marginTop: token.marginXS,
        paddingInline: token.paddingSM,
        color: frei ? rollen.text : rollen.gedaempft,
        ...stil,
      }}
    >
      {OBERSTE_EBENE}
    </div>
  );
}

/** Was am Zeiger hängt: der Name, in der Form eines Chips. */
export function DragMarke({ drag }: { drag: DragDaten }) {
  const { token, rollen } = useRollen();
  return (
    <span
      data-lfh="drag-marke"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXXS,
        minHeight: token.controlHeight,
        paddingInline: token.paddingSM,
        background: rollen.paneel,
        border: `1px solid ${rollen.bedien}`,
        color: rollen.text,
        cursor: 'grabbing',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', color: rollen.gedaempft }}>
        <IconMenue />
      </span>
      {drag.name}
    </span>
  );
}
