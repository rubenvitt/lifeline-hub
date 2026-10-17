import { Button, Flex } from 'antd';
import type { Dayjs } from 'dayjs';
import { serverJetzt } from '../offline/serveruhr';
import type { ZeitArt } from './zeitParser';
import { SCHNELLWAHL, schnellwahlZeit, type SchnellwahlEintrag } from './zeitSchnellwahl';

/** Ohne Feldart bleibt „jetzt“ (wie der frühere Knopf im Panel-Fuß, LFH-692). */
const OHNE_ART: readonly SchnellwahlEintrag[] = [SCHNELLWAHL.ereignis[0]];

export function schnellwahlFuer(art: ZeitArt | undefined): readonly SchnellwahlEintrag[] {
  return art ? SCHNELLWAHL[art] : OHNE_ART;
}

/**
 * Knopfreihe der Schnellwahl (Spec `zeiteingabe`, „Schnellwahl nach Feldart“). Jeder Knopf löst
 * einmal aus und trägt die Steuerhöhe der Stufe (antd-`Button` in Normalgröße, Gate 3); deshalb
 * keine `Segmentleiste`, die ein Umschalter ist. Gerechnet wird ab jetzt nach Serveruhr
 * (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
 */
export function ZeitSchnellwahlKnoepfe({
  art,
  disabled,
  onWahl,
}: {
  art: ZeitArt | undefined;
  disabled?: boolean;
  onWahl: (zeitpunkt: Dayjs) => void;
}) {
  return (
    <Flex wrap gap="small" role="group" aria-label="Schnellwahl">
      {schnellwahlFuer(art).map((e) => (
        <Button
          key={e.label}
          disabled={disabled}
          onClick={() => onWahl(schnellwahlZeit(serverJetzt(), e.minuten))}
        >
          {e.label}
        </Button>
      ))}
    </Flex>
  );
}
