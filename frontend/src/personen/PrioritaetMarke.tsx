import { Tag } from 'antd';
import type { TransportPrioritaet } from '../api/types';

/**
 * Transportpriorität als neutrale Marke mit Wort (LLH-1325, design.md D10): ein `Tag` ohne Farbe,
 * denn die Sichtung bleibt die einzige Farbachse an der Person. Der Titel nennt, wofür das Wort
 * steht; ohne Priorität gibt es keine Marke.
 */
export default function PrioritaetMarke({
  prioritaet,
}: {
  prioritaet: TransportPrioritaet | null | undefined;
}) {
  if (prioritaet == null) return null;
  return (
    <span data-lfh="transport-prioritaet" title={`Transportpriorität ${prioritaet}`}>
      <Tag style={{ marginInlineEnd: 0 }}>{prioritaet}</Tag>
    </span>
  );
}
