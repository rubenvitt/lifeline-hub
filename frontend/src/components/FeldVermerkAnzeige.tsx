import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { FeldVermerk } from '../api/types';
import { praesenzSatz, usePraesenzAnderer, type PraesenzSchluessel } from '../live/praesenz';
import { schriftStil, useRollen } from './instrument/rollenwerte';

/**
 * Der Änderungsvermerk in der Ansicht (LLH-1834, Change `nvhnqynd-konflikt-und-aenderungsvermerk`,
 * design.md D7, Spec `aenderungsvermerk`, „Vermerk an der Zeile und im Paneelkopf“): leise, in der
 * Rolle `meta` und gedämpft, ohne Warnfarbe oder Symbol. Ohne Vermerk nichts.
 */
function useVermerkSatz() {
  const { zeitKurz } = useAnzeigeKonventionen();
  return (anfang: string, v: FeldVermerk) =>
    v.von ? `${anfang} von ${v.von}, ${zeitKurz(v.at)}` : `${anfang} ${zeitKurz(v.at)}`;
}

/**
 * Unter dem Wert einer Zeile: „Geändert von Anna, 14:05“. Mit `praesenz` weicht die Zeile, solange
 * jemand anderes die Angabe bearbeitet (LLH-1946, Entwurf D6): an ihrer Stelle steht dann der
 * Hinweis der `InlineAngabe` darüber.
 */
export function VermerkZeile({
  vermerk,
  praesenz,
  feld,
}: {
  vermerk?: FeldVermerk;
  praesenz?: PraesenzSchluessel;
  feld?: string;
}) {
  const satz = useVermerkSatz();
  const { rollen } = useRollen();
  const { andere, eigenesKonto } = usePraesenzAnderer(praesenz, feld);
  if (!vermerk || praesenzSatz(andere, eigenesKonto) !== null) return null;
  return (
    <div style={{ ...schriftStil('meta'), color: rollen.gedaempft }}>
      <span data-lfh="feld-vermerk">{satz('Geändert', vermerk)}</span>
    </div>
  );
}

/** Im Kopf eines Paneels, die jüngste Änderung: „Zuletzt geändert von Anna, 14:05“. */
export function PaneelVermerk({ vermerk }: { vermerk?: FeldVermerk }) {
  const satz = useVermerkSatz();
  const { rollen } = useRollen();
  if (!vermerk) return null;
  return (
    <span style={{ ...schriftStil('meta'), color: rollen.gedaempft }}>
      <span data-lfh="paneel-vermerk">{satz('Zuletzt geändert', vermerk)}</span>
    </span>
  );
}

/**
 * „Wird gerade bearbeitet von Anna“ (LLH-1946, Entwurf D6): Rolle `meta` in der Textfarbe, ohne
 * Warnfarbe, Symbol oder Live-Region. Ohne fremde Bearbeitung nichts, und kein reservierter Platz.
 */
export function PraesenzZeile({
  id,
  praesenz,
  feld,
}: {
  id?: string;
  praesenz?: PraesenzSchluessel;
  feld?: string;
}) {
  const { rollen } = useRollen();
  const { andere, eigenesKonto } = usePraesenzAnderer(praesenz, feld);
  const satz = praesenzSatz(andere, eigenesKonto);
  if (satz === null) return null;
  return (
    <div id={id} data-lfh="feld-praesenz" style={{ ...schriftStil('meta'), color: rollen.text }}>
      {satz}
    </div>
  );
}
