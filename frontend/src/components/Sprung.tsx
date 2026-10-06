import { Button } from 'antd';
import { useHref, useLinkClickHandler, type To } from 'react-router';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';

/**
 * Gemeinsames Sprung-Muster (LFH-968) für einen Sprung, der als eigenes Bedienziel neben
 * Knöpfen steht (Seitenkopf, Paneel). Ein Sprung ist keine Handlung (LFH-616): er trägt „↗“ und
 * bleibt ein Link. Für Kennungs-Links in Zeilen gilt weiter `KennungsLink`.
 *
 * Als antd-`Button` mit `href` erbt er Steuerhöhe und Polsterung vom `ConfigProvider` (ein `<a>`
 * erbt keine Steuerhöhe, `frontend/AGENTS.md`, „Handgebautes Bedienziel“); nackt maß der
 * ETB-Sprung im Seitenkopf 15 px. `useLinkClickHandler` navigiert beim schlichten Klick in der
 * App, Strg/⌘-Klick öffnet einen Tab (Muster „Zu den Demo-Daten“ in `EinsaetzePage`).
 */
export function SprungKnopf({
  to,
  gesperrt = false,
  children,
}: {
  to: To;
  /** Zielmodul gesperrt (`useSprungSperre`): gesperrter Knopf mit Grund statt Link. */
  gesperrt?: boolean;
  /** Das Ziel als Wortlaut („Zum ETB-Eintrag“); „↗“ setzt der Baustein. */
  children: string;
}) {
  const href = useHref(to);
  const klick = useLinkClickHandler<HTMLElement>(to);
  if (gesperrt) return <GesperrterSprung>{children}</GesperrterSprung>;
  return (
    <Button href={href} onClick={klick}>
      {children} <span aria-hidden="true">↗</span>
    </Button>
  );
}

/** Wortlaut eines gesperrten Sprungs: Ziel plus Grund, wie im Aktionsmenü. */
export function sprungGesperrtText(ziel: string): string {
  return `${ziel} (${KEINE_BERECHTIGUNG})`;
}

/**
 * Ein gesperrter Sprung (LFH-888) steht da und nennt seinen Grund im SICHTBAREN Text. Ein
 * `title` erscheint auf Tablet und Handy nie; ein Tooltip ist nie die einzige Erklärung
 * (Klärungsrunde 06.10.2026, Frage 1). Der `title` bleibt als Zusatz für die Maus.
 */
export function GesperrterSprung({ children }: { children: string }) {
  return (
    <Button disabled title={KEINE_BERECHTIGUNG}>
      {sprungGesperrtText(children)}
    </Button>
  );
}
