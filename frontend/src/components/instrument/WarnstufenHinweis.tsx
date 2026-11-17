import type { ReactNode } from 'react';
import { IconWarndreieck } from '../../icons';
import { useRollen } from './rollenwerte';

/**
 * WarnstufenHinweis — die Warnstufe im Seitenkopf einer Dashboard-Fläche (Regel
 * „Dashboard-Baukasten“, `frontend/AGENTS.md`; Vorbild Lagebild, LLH-1140). Die Warnstufe ist
 * keine Kennzahl: sie steht neben dem Datenstand, nur wenn sie etwas sagt (Ton achtung/alarm).
 *
 * Warndreieck als Zeichen (`aria-hidden`), das Wort trägt die Aussage (zweiter Kanal); Farbe in
 * `achtungText`/`alarmText` (Textboden, LFH-618). `data-ton` macht den Ton ohne Farbe prüfbar.
 */
export default function WarnstufenHinweis({
  ton,
  children,
}: {
  ton: 'achtung' | 'alarm';
  children: ReactNode;
}) {
  const { rollen } = useRollen();
  return (
    <span
      data-lfh="warnstufe-hinweis"
      data-ton={ton}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: ton === 'alarm' ? rollen.alarmText : rollen.achtungText,
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        <IconWarndreieck size={14} />
      </span>
      {children}
    </span>
  );
}
