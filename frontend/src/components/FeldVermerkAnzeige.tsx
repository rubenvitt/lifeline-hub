import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { FeldVermerk } from '../api/types';
import Schrift from './instrument/Schrift';

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

/** Unter dem Wert einer Zeile: „Geändert von Anna, 14:05“. */
export function VermerkZeile({ vermerk }: { vermerk?: FeldVermerk }) {
  const satz = useVermerkSatz();
  if (!vermerk) return null;
  return (
    <Schrift rolle="meta" ton="gedaempft" als="div">
      <span data-lfh="feld-vermerk">{satz('Geändert', vermerk)}</span>
    </Schrift>
  );
}

/** Im Kopf eines Paneels, die jüngste Änderung: „Zuletzt geändert von Anna, 14:05“. */
export function PaneelVermerk({ vermerk }: { vermerk?: FeldVermerk }) {
  const satz = useVermerkSatz();
  if (!vermerk) return null;
  return (
    <Schrift rolle="meta" ton="gedaempft">
      <span data-lfh="paneel-vermerk">{satz('Zuletzt geändert', vermerk)}</span>
    </Schrift>
  );
}
