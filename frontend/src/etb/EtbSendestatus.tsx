import { Button } from 'antd';
import { IconHaken } from '../icons';
import { monoStil, useRollen } from '../components/instrument';
import { statusFlaeche } from '../components/instrument/statusFlaeche';
import type { PufferZustand } from './zeitachseModell';

interface Props {
  puffer: PufferZustand;
  /** Rollt zu den vorgemerkten Zeilen der Zeitachse (kwc2yszv D7). */
  onSprung: () => void;
}

/**
 * Sendestatus des Tagebuchs im Seitenkopf (Spec `etb-zaehler`, „Sendestatus“, kwc2yszv D7): der
 * Puffer-Zustand der früheren Bilanz als EINE Marke. Alles übertragen ist eine stille Aussage mit
 * Haken; stehen Einträge aus oder sind abgelehnt, ist die Marke ein Weg zu ihren Zeilen. Wortlaut je
 * Eintrag, „Erneut senden“ und „verwerfen“ stehen in den Zeilen und den Hinweisen über der
 * Erfassung — hier nur der Stand, mit Wort und Zahl als zweitem Kanal neben der Farbe.
 */
export default function EtbSendestatus({ puffer, onSprung }: Props) {
  const { token, rollen } = useRollen();
  if (puffer.art === 'uebertragen') {
    return (
      <span
        data-lfh="sendestatus"
        data-zustand="uebertragen"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: token.marginXXS,
          fontSize: 12,
          color: rollen.normalText,
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <IconHaken />
        </span>
        alles übertragen
      </span>
    );
  }
  const teile = [
    puffer.art === 'abgelehnt' ? `${puffer.abgelehnt} abgelehnt` : null,
    puffer.ausstehend > 0 ? `${puffer.ausstehend} ausstehend` : null,
  ].filter((t): t is string => t != null);
  const text = teile.join(' · ');
  // Abgelehnt verlangt eine Handlung (Alarm), ausstehend nur Geduld (Achtung) — dieselbe
  // Rangfolge wie `pufferZustand`.
  const f = statusFlaeche(rollen, puffer.art === 'abgelehnt' ? 'alarm' : 'achtung');
  return (
    <Button
      type="text"
      data-lfh="sendestatus"
      data-zustand={puffer.art}
      title="Zu den vorgemerkten Einträgen"
      onClick={onSprung}
      style={{ background: f.grund, color: f.text, ...monoStil(12, 500) }}
    >
      {text}
    </Button>
  );
}
