import { Button } from 'antd';
import { useHref, useLinkClickHandler } from 'react-router';
import type { Evakuierungsbezirk } from '../api/types';
import { GesperrterSprung } from '../components/Sprung';
import { gebietZeichnenPfad, gebietZeichnenText } from './gebietZeichnen';

/**
 * „Gebiet zeichnen“ bzw. „Weitere Teilfläche zeichnen“ am Paneel „Gebiet“ der Detailseite
 * (LLH-1069). Ein Knopf mit `href` wie `SprungKnopf` (Steuerhöhe vom `ConfigProvider`, Strg/⌘-Klick
 * öffnet einen Tab), aber ohne „↗“: er beginnt eine Handlung auf der Karte, er ist kein Sprung zum
 * Lesen. Ist die Lagekarte gesperrt, steht er gesperrt und nennt den Grund im Wortlaut (LFH-888).
 */
export default function GebietZeichnenKnopf({
  einsatzId,
  bezirk,
  gesperrt,
}: {
  einsatzId: number;
  bezirk: Pick<Evakuierungsbezirk, 'id' | 'flaechen'>;
  /** Modul Lagekarte für diese Person gesperrt (`useSprungSperre`). */
  gesperrt: boolean;
}) {
  const ziel = gebietZeichnenPfad(einsatzId, bezirk.id);
  const href = useHref(ziel);
  const klick = useLinkClickHandler<HTMLElement>(ziel);
  const text = gebietZeichnenText(bezirk.flaechen);
  if (gesperrt) return <GesperrterSprung>{text}</GesperrterSprung>;
  return (
    <Button href={href} onClick={klick}>
      {text}
    </Button>
  );
}
