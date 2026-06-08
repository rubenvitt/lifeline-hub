import type { KeyboardEvent, ReactNode } from 'react';

/**
 * Tastatur-Aktivierung für nicht-native Klickziele (Enter + Space), konsistent
 * über alle Dashboard-Kacheln. An Elemente mit role="button" tabIndex={0} hängen.
 */
export function aufTaste(aktion: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      aktion();
    }
  };
}

/** Klickbare Zeile (Maus + Tastatur) für Listen-Inhalte innerhalb einer Kachel. */
export function KlickbareZeile({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
      onKeyDown={aufTaste(onClick)}
    >
      {children}
    </div>
  );
}
