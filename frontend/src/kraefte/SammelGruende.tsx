import { Button, Tag, Typography } from 'antd';
import type { SelectProps } from 'antd';
import type { ReactNode } from 'react';

/**
 * Gründe je Kraft einer abgelehnten Sammel-Disposition (LLH-1100, Change
 * `iw7x9980-sammel-disposition` D7): als Liste unter der Auswahl und am Tag der Kraft. Der
 * Grund steht im Dialog, nicht im Toast (`frontend/AGENTS.md`, „Rückwege und Fehler“); er gilt
 * bis zum nächsten Absenden, Öffnen und Abbrechen räumen ihn mit dem Fehler der Hülle.
 */

interface GruendeListeProps {
  /** Grund je abgelehnter Kraft, nur die noch gewählten. */
  gruende: ReadonlyMap<number, string>;
  /** Name einer Kraft, festgehalten beim Absenden (die Optionen können sich danach ändern). */
  name: (id: number) => ReactNode;
  /** Nimmt die Abgelehnten aus der Auswahl. */
  onAbwaehlen: () => void;
}

export function GruendeListe({ gruende, name, onAbwaehlen }: GruendeListeProps) {
  if (gruende.size === 0) return null;
  return (
    <div>
      <ul aria-label="Nicht disponiert" style={{ margin: 0, paddingInlineStart: 18 }}>
        {[...gruende].map(([id, grund]) => (
          <li key={id}>
            <Typography.Text type="danger">
              {name(id)} – {grund}
            </Typography.Text>
          </li>
        ))}
      </ul>
      <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={onAbwaehlen}>
        Abgelehnte abwählen
      </Button>
    </div>
  );
}

/**
 * Tag einer Mehrfachauswahl, der eine abgelehnte Kraft mit ihrem Grund zeigt — als Wort in
 * Alarmtext, kein `color` am Tag (`frontend/AGENTS.md`, Farbachsen). Ohne Option (die Kraft ist
 * inzwischen aus der Liste gefallen) trägt der festgehaltene Name.
 */
export function gruendeTagRender(
  gruende: ReadonlyMap<number, string>,
  name: (id: number) => ReactNode,
): NonNullable<SelectProps['tagRender']> {
  return function GruendeTag({ label, value, closable, onClose }) {
    const id = Number(value);
    const grund = gruende.get(id);
    const text = label === value || label == null ? name(id) : label;
    return (
      <Tag
        closable={closable}
        onClose={onClose}
        // Ein Mausdruck auf den Tag öffnet sonst die Liste (antd-Muster für `tagRender`).
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{ marginInlineEnd: 4 }}
      >
        {grund ? (
          <Typography.Text type="danger">
            {text} · {grund}
          </Typography.Text>
        ) : (
          text
        )}
      </Tag>
    );
  };
}
