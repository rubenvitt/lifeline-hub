import { Alert, Flex, theme, Typography } from 'antd';
import { ApiError } from '../api/client';
import { StatusChip } from './instrument/Status';

/**
 * Persistenter Speicher-Fehler und erklärender Rechte-Hinweis (LFH-345 · C10).
 *
 * ── Warum nicht der Toast ──────────────────────────────────────────────────────
 * Ein Toast ist nach rund drei Sekunden weg, das ausgefüllte Formular steht unverändert da und
 * wirkt gespeichert. Der Fehlerzustand gehört deshalb an die SEITE (`mutation.error`). Der
 * ERFOLG bleibt beim Toast: er quittiert eine abgeschlossene Handlung.
 *
 * Der Alert verschwindet beim nächsten Absenden von selbst (react-query räumt `error` beim
 * Übergang nach `pending`) — die zweite Hälfte der Zusicherung, mitgetestet.
 *
 * `fehlerText` ist rein und exportiert, damit die Fallunterscheidung ohne Render prüfbar ist.
 * „Ohne Fehler NICHTS" ist die Aussage, die ein Primitiv auffliegen lässt, das immer einen Text
 * liefert.
 */
export function fehlerText(fehler: unknown, fallback = 'Speichern fehlgeschlagen'): string | null {
  if (fehler == null) return null;
  return fehler instanceof ApiError ? fehler.message : fallback;
}

interface SpeicherFehlerProps {
  /** `mutation.error` — react-query hält ihn bis zum nächsten `mutate()`. */
  fehler: unknown;
  /** Überschrift; Vorgabe „Nicht gespeichert". */
  titel?: string;
  /**
   * Text für einen Fehler, der keine `ApiError` ist (Netz, Programmfehler); Vorgabe
   * „Speichern fehlgeschlagen" wie in {@link fehlerText}. Für Seiten, deren Vorgang kein
   * Speichern ist (etwa Import/Entfernen der Demo-Daten).
   */
  fallback?: string;
}

export function SpeicherFehler({ fehler, titel, fallback }: SpeicherFehlerProps) {
  const text = fehlerText(fehler, fallback);
  if (text === null) return null;
  return <Alert type="error" showIcon title={titel ?? 'Nicht gespeichert'} description={text} />;
}

interface RechteHinweisProps {
  /** Grund in wenigen Wörtern („Einsatz abgeschlossen“), aus `components/nurAnsicht.ts`. */
  text: string;
  /** Nur bei FEHLENDER Berechtigung sichtbar. */
  sichtbar: boolean;
}

/**
 * Nennt eine fehlende Berechtigung, statt sie stumm auszugrauen (M16). „Ausgegraut“ allein ist
 * eine Ein-Kanal-Aussage (WCAG 1.4.1) und nennt keinen Grund. Hier steht der Grund über einem
 * ganzen Block, nicht je Zeile.
 *
 * Eine Zeile „Nur Ansicht · Grund“, kein Kasten mit Satz (LFH-1078, Spec `bedien-erklaertexte`):
 * dass Werte nur zu lesen sind, zeigen die gesperrten Knöpfe; der Grund bleibt ohne Hover lesbar.
 */
export function RechteHinweis({ text, sichtbar }: RechteHinweisProps) {
  const { token } = theme.useToken();
  if (!sichtbar) return null;
  return (
    <Flex role="status" align="center" wrap gap={token.marginXS} data-lfh="rechte-hinweis">
      <StatusChip ton="neutral" wort="Nur Ansicht" />
      <Typography.Text type="secondary">{text}</Typography.Text>
    </Flex>
  );
}

interface SeitenHinweiseProps {
  /** `mutation.error`; mehrere Mutationen einer Seite werden mit `??` verkettet. */
  fehler?: unknown;
  /** Erklärung der fehlenden Berechtigung; ohne Text kein Hinweis. */
  rechteText?: string;
  /** Nur bei FEHLENDER Berechtigung. */
  rechteFehlt?: boolean;
  fehlerTitel?: string;
  /** Siehe {@link SpeicherFehlerProps.fallback}. */
  fehlerFallback?: string;
}

/**
 * Beide Hinweise für EINEN Slot (`AdminPage`/`EinsatzSeite` haben genau einen `hinweis`); der
 * Abstand zwischen den Alerts steht an einer Stelle.
 *
 * Das `null` im Leerfall spart den Slot **nicht** ein: `<SeitenHinweise/>` ist als JSX-Element
 * immer truthy, die Hüllen rendern ihr `<div>` ohnehin. Sichtbar bleibt nichts, weil ein leeres
 * `<div>` kollabiert. Wer hier einen festen Abstand hineinschreibt, fasst die Hülle mit an.
 */
export function SeitenHinweise({
  fehler,
  rechteText,
  rechteFehlt = false,
  fehlerTitel,
  fehlerFallback,
}: SeitenHinweiseProps) {
  const { token } = theme.useToken();
  const zeigtRecht = rechteFehlt && rechteText != null;
  const zeigtFehler = fehlerText(fehler) !== null;
  if (!zeigtRecht && !zeigtFehler) return null;
  return (
    <Flex vertical gap={token.marginSM}>
      {zeigtRecht && <RechteHinweis sichtbar text={rechteText} />}
      <SpeicherFehler fehler={fehler} titel={fehlerTitel} fallback={fehlerFallback} />
    </Flex>
  );
}
