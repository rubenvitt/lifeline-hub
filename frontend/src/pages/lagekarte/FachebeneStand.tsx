import type { FachebeneQuelle } from '../../api/fachebenen';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { monoStil, useRollen } from '../../components/instrument';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { schriftskala } from '../../theme/tokens';
import { fachebeneAlter } from './fachebenen';

interface FachebeneStandProps {
  quelle: FachebeneQuelle;
  /** Abrufzeitpunkt des Servers (`FachebeneAntwort.abgerufen`). Ohne ihn steht nichts da. */
  abgerufen: string | undefined;
  /** `kurz` fürs Panel („1430“, am Vortag „291430“), `voll` für den Inspector („301430SEP2026“). */
  form?: 'kurz' | 'voll';
  /** Wort vor der Zeit. Im Inspector „Ebene abgerufen“, damit es nicht als Messzeit des Objekts gilt. */
  praefix?: string;
}

/**
 * Alter eines Fachebenen-Stands (LFH-591): „Stand 1430“, jenseits der Schwelle der Ebene
 * „⧖ veraltet · Stand 281800“ in der Achtung-Textfarbe. Das Wort ist der zweite Kanal neben der
 * Farbe (WCAG 1.4.1), das Zeichen ist stumm. Kein Tooltip: auf dem Tablet gibt es kein Hovern.
 *
 * Die Einstufung altert im Minutentakt mit — die Karte kann lange offen stehen, ohne dass ein
 * Abruf gelingt, und genau dann muss „veraltet“ erscheinen. Die Schwelle ist eine Marke am
 * bestehenden Status, kein eigener
 * (`openspec/changes/archive/2026-09-30-lfh-591-fachebenen-datenalter/design.md`, D3/D5).
 */
export default function FachebeneStand({
  quelle,
  abgerufen,
  form = 'kurz',
  praefix = 'Stand',
}: FachebeneStandProps) {
  const jetzt = useMinutenTakt();
  const { rollen } = useRollen();
  const { formatZeit, formatZeitKurz } = useAnzeigeKonventionen();
  const alter = fachebeneAlter(quelle, abgerufen, jetzt);
  if (!alter) return null;
  const zeit = form === 'voll' ? formatZeit(alter.abgerufen) : formatZeitKurz(alter.abgerufen);
  return (
    <span
      data-lfh="fachebene-stand"
      data-veraltet={alter.veraltet || undefined}
      style={{
        fontSize: schriftskala.meta.groesse,
        color: alter.veraltet ? rollen.achtungText : rollen.text2,
        whiteSpace: 'nowrap',
      }}
    >
      {alter.veraltet && (
        <>
          <span aria-hidden="true">⧖ </span>veraltet ·{' '}
        </>
      )}
      {praefix} <span style={monoStil(schriftskala.meta.groesse)}>{zeit}</span>
    </span>
  );
}
