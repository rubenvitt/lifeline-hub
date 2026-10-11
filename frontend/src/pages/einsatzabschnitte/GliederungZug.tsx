import {
  useDndContext,
  useDraggable,
  useDroppable,
  type Announcements,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { CSSProperties, ReactNode } from 'react';
import type { Einsatzabschnitt } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { IconMenue } from '../../icons';
import { OBERSTE_EBENE, abschnittZielGueltig, einheitZielGueltig } from './gliederungZugKern';

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

export type ZugDaten =
  | { art: 'abschnitt'; id: number; name: string }
  | { art: 'einheit'; id: number; name: string; abschnittId: number | null };

export interface ZielDaten {
  /** `null` = oberste Ebene. */
  zielId: number | null;
  /** Für die Ansage an Hilfstechnik. */
  name: string;
}

/**
 * Deutsche Ansagen statt dnd-kits englischer Vorgabe. Die Griffe sind keine Tastaturziele; die
 * Ansage begleitet nur einen Zeigerzug, etwa mit eingeschaltetem Vorleser.
 */
const zugName = (daten: unknown) => (daten as ZugDaten | undefined)?.name ?? 'Eintrag';
const zielName = (daten: unknown) => (daten as ZielDaten | undefined)?.name;
export const ZUG_ANSAGEN: Announcements = {
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
export const ZUG_ANLEITUNG: ScreenReaderInstructions = {
  draggable: 'Ohne Ziehen: „Verschieben unter …“ im Menü „Weitere Aktionen“.',
};

const zugSchluessel = (d: ZugDaten) => `zug-${d.art}-${d.id}`;
const zielSchluessel = (id: number | null) => (id === null ? 'ziel-wurzel' : `ziel-${id}`);

/** Der laufende Zug, wenn einer läuft. */
export function useLaufenderZug(): ZugDaten | null {
  const { active } = useDndContext();
  return (active?.data.current as ZugDaten | undefined) ?? null;
}

/** Nimmt das Ziel den laufenden Zug an? Dieselbe Regel wie das Menü (`gliederungZugKern.ts`). */
function nimmtAn(
  zug: ZugDaten | null,
  abschnitte: readonly Einsatzabschnitt[],
  zielId: number | null,
): boolean {
  if (!zug) return false;
  return zug.art === 'abschnitt'
    ? abschnittZielGueltig(abschnitte, zug.id, zielId)
    : einheitZielGueltig({ abschnitt_id: zug.abschnittId }, zielId);
}

/** Rahmen eines Ziels während des Zugs: gestrichelt frei, gefüllt unter dem Zeiger, sonst keiner. */
function useZielStil(frei: boolean, darueber: boolean, laeuft: boolean): CSSProperties {
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
export function ZugGriff({ daten }: { daten: ZugDaten }) {
  const { token, rollen } = useRollen();
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id: zugSchluessel(daten),
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
      data-lfh="zug-griff"
      data-zug={zugSchluessel(daten)}
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
        color: rollen.gedaempft,
      }}
    >
      <IconMenue />
    </span>
  );
}

/** Ein Abschnitt der Gliederung als Ziel; sein Inhalt ist der Knoten selbst. */
export function ZielKnoten({
  abschnitt,
  abschnitte,
  children,
}: {
  abschnitt: Einsatzabschnitt;
  abschnitte: readonly Einsatzabschnitt[];
  children: ReactNode;
}) {
  const zug = useLaufenderZug();
  const frei = nimmtAn(zug, abschnitte, abschnitt.id);
  const { setNodeRef, isOver } = useDroppable({
    id: zielSchluessel(abschnitt.id),
    data: { zielId: abschnitt.id, name: abschnitt.name } satisfies ZielDaten,
    disabled: !frei,
  });
  const stil = useZielStil(frei, isOver, zug !== null);
  const gezogen = zug?.art === 'abschnitt' && zug.id === abschnitt.id;
  return (
    <span
      ref={setNodeRef}
      data-lfh="gliederung-ziel"
      data-abschnitt={abschnitt.id}
      data-ziel={zug === null ? undefined : frei ? 'frei' : 'gesperrt'}
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
export function WurzelZone({ abschnitte }: { abschnitte: readonly Einsatzabschnitt[] }) {
  const { token, rollen } = useRollen();
  const zug = useLaufenderZug();
  const frei = nimmtAn(zug, abschnitte, null);
  const { setNodeRef, isOver } = useDroppable({
    id: zielSchluessel(null),
    data: { zielId: null, name: OBERSTE_EBENE } satisfies ZielDaten,
    disabled: !frei,
  });
  const stil = useZielStil(frei, isOver, zug !== null);
  if (zug?.art !== 'abschnitt') return null;
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
export function ZugMarke({ zug }: { zug: ZugDaten }) {
  const { token, rollen } = useRollen();
  return (
    <span
      data-lfh="zug-marke"
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
      {zug.name}
    </span>
  );
}
