/**
 * Werkzeugleiste der Fernmeldeskizze (LFH-893 D6, D10, D13): Palette, Zoom, Ebenenfilter,
 * Rückgängig/Wiederholen, Neu anordnen und Papierformat. Nur Bedienung: im Druck aus
 * (`lfh-skizze-bedienung`). Was ohne Recht oder mobil nicht geht, steht nicht da (der Grund
 * steht im Eigenschaftspaneel); Zoom und Filter gehen immer.
 */
import { Button, Flex } from 'antd';
import { Segmentleiste, useRollen } from '../../components/instrument';
import Tastenkuerzel from '../../components/Tastenkuerzel';
import {
  IconMinus,
  IconPlus,
  IconSeitenleisteAuf,
  IconSeitenleisteZu,
  IconVollbildEcken,
} from '../../icons';
import type { BefehlsStand } from '../skizzenBefehle';
import { DRUCKFORMAT_OPTIONEN, type Druckformat } from './druckformat';
import { EBENENFILTER, type Ebenenfilter } from './ebenen';

export interface WerkzeugleisteProps {
  /** `null` = keine Palette (ohne Recht, mobil). */
  palette: { offen: boolean; onUmschalten: () => void; steuert: string } | null;
  onZoom: (richtung: 1 | -1) => void;
  onEinpassen: () => void;
  eingepasst: boolean;
  filter: Ebenenfilter;
  onFilter: (f: Ebenenfilter) => void;
  /** `null` = keine Schreibwege (nur lesen, mobil). */
  befehle: { stand: BefehlsStand; onRueckgaengig: () => void; onWiederholen: () => void } | null;
  onNeuAnordnen: (() => void) | null;
  druck: { format: Druckformat; onFormat: (f: Druckformat) => void } | null;
}

export default function SkizzenWerkzeugleiste(p: WerkzeugleisteProps) {
  const { token } = useRollen();
  const kuerzel = { marginInlineStart: token.marginXXS };
  return (
    <Flex
      wrap
      gap={token.marginSM}
      align="center"
      className="lfh-skizze-bedienung"
      data-lfh="skizze-werkzeugleiste"
      role="toolbar"
      aria-label="Werkzeuge der Skizze"
      style={{ marginBlockEnd: token.marginSM }}
    >
      {p.palette ? (
        <Button
          icon={p.palette.offen ? <IconSeitenleisteZu /> : <IconSeitenleisteAuf />}
          aria-expanded={p.palette.offen}
          aria-controls={p.palette.steuert}
          onClick={p.palette.onUmschalten}
          data-lfh="skizze-palette-knopf"
        >
          Palette
        </Button>
      ) : null}
      <Flex gap={token.marginXXS} role="group" aria-label="Zoom">
        <Button
          icon={<IconMinus />}
          aria-label="Verkleinern"
          onClick={() => p.onZoom(-1)}
          data-lfh="skizze-zoom-aus"
        />
        <Button
          icon={<IconPlus />}
          aria-label="Vergrößern"
          onClick={() => p.onZoom(1)}
          data-lfh="skizze-zoom-ein"
        />
        <Button
          icon={<IconVollbildEcken />}
          onClick={p.onEinpassen}
          aria-pressed={p.eingepasst}
          data-lfh="skizze-einpassen"
        >
          Einpassen
        </Button>
      </Flex>
      <Segmentleiste<Ebenenfilter>
        beschriftung="Ebenen"
        optionen={EBENENFILTER}
        wert={p.filter}
        onWechsel={p.onFilter}
      />
      {p.befehle ? (
        <Flex gap={token.marginXXS} role="group" aria-label="Rückgängig und Wiederholen">
          <Button
            onClick={p.befehle.onRueckgaengig}
            disabled={p.befehle.stand.rueckgaengig === 0 || p.befehle.stand.laeuft}
            title={p.befehle.stand.oben ?? undefined}
            data-lfh="skizze-rueckgaengig"
          >
            Rückgängig <Tastenkuerzel style={kuerzel}>Strg+Z</Tastenkuerzel>
          </Button>
          <Button
            onClick={p.befehle.onWiederholen}
            disabled={p.befehle.stand.wiederholen === 0 || p.befehle.stand.laeuft}
            title={p.befehle.stand.naechster ?? undefined}
            data-lfh="skizze-wiederholen"
          >
            Wiederholen <Tastenkuerzel style={kuerzel}>Strg+Y</Tastenkuerzel>
          </Button>
        </Flex>
      ) : null}
      {p.onNeuAnordnen ? (
        <Button onClick={p.onNeuAnordnen} data-lfh="skizze-neu-anordnen">
          Neu anordnen
        </Button>
      ) : null}
      {p.druck ? (
        <Segmentleiste<Druckformat>
          beschriftung="Papierformat"
          optionen={DRUCKFORMAT_OPTIONEN}
          wert={p.druck.format}
          onWechsel={p.druck.onFormat}
        />
      ) : null}
    </Flex>
  );
}
