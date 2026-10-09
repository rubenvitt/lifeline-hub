import { Alert, Flex, theme, Typography } from 'antd';
import { ApiError } from '../api/client';
import { StatusChip } from './instrument/Status';

/**
 * Persistenter Speicher-Fehler und Rechte-Hinweis „Nur Ansicht · Grund“ (LFH-345 · C10, LFH-1078).
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
 * Eine Zeile „Nur Ansicht · Grund“, kein Kasten mit Satz (LFH-1078): dass Werte nur zu lesen
 * sind, zeigen die gesperrten Knöpfe; der Grund bleibt ohne Hover lesbar. Das Leerzeichen
 * zwischen Marke und Grund rendert im Flex nicht, trennt aber für Screenreader und `textContent`.
 */
export function RechteHinweis({ text, sichtbar }: RechteHinweisProps) {
  const { token } = theme.useToken();
  if (!sichtbar) return null;
  return (
    <Flex role="status" align="center" wrap gap={token.marginXS} data-lfh="rechte-hinweis">
      <StatusChip ton="neutral" wort="Nur Ansicht" />{' '}
      <Typography.Text type="secondary">{text}</Typography.Text>
    </Flex>
  );
}

interface SeitenHinweiseProps {
  /** `mutation.error`; mehrere Mutationen einer Seite werden mit `??` verkettet. */
  fehler?: unknown;
  /** Grund der fehlenden Berechtigung (`components/nurAnsicht.ts`); ohne Text kein Hinweis. */
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

/**
 * Der Fehler einer Mutation, wenn er zu dieser Zeile gehört, sonst `null` (LFH-1077). Eine
 * Mutation dient allen Zeilen einer Liste; ihre `variables` sagen, welche zuletzt geschrieben
 * hat. react-query hält beides bis zum nächsten `mutate()`.
 */
export function zeilenFehler<V>(
  mutation: { error: unknown; variables: V | undefined },
  passt: (variablen: V) => boolean,
): unknown {
  const { error, variables } = mutation;
  return error != null && variables !== undefined && passt(variables) ? error : null;
}

/** Eine Mutation, die an einer Zeile schreiben kann; Eingabe für {@link letzterZeilenFehler}. */
export interface ZeilenAktion {
  error: unknown;
  submittedAt: number;
  /** Betraf der letzte Aufruf dieser Mutation die Zeile? */
  passt: boolean;
  /** Text für einen Fehler, der keine `ApiError` ist. */
  fallback?: string;
}

/** Bindet eine Mutation an eine Zeile; `passt` sieht die `variables` des letzten Aufrufs. */
export function zeilenAktion<V>(
  mutation: { error: unknown; variables: V | undefined; submittedAt: number },
  passt: (variablen: V) => boolean,
  fallback?: string,
): ZeilenAktion {
  const { error, variables, submittedAt } = mutation;
  return { error, submittedAt, passt: variables !== undefined && passt(variables), fallback };
}

/**
 * Der Grund der LETZTEN Aktion an einer Zeile, an der mehrere Mutationen schreiben (LFH-1077).
 * Jede Mutation hält ihren Fehler bis zu ihrem nächsten Aufruf; ohne den Vergleich über
 * `submittedAt` stünde nach einem gelungenen Aktualisieren noch der Grund eines früher
 * abgelehnten Löschens an der Zeile.
 */
export function letzterZeilenFehler(
  aktionen: readonly ZeilenAktion[],
): { fehler: unknown; fallback?: string } | null {
  const anDerZeile = aktionen.filter((a) => a.passt);
  if (anDerZeile.length === 0) return null;
  const letzte = anDerZeile.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
  return letzte.error != null ? { fehler: letzte.error, fallback: letzte.fallback } : null;
}

interface ZeilenFehlerProps {
  /** Aus {@link zeilenFehler}: nur der Fehler DIESER Zeile. */
  fehler: unknown;
  /** Siehe {@link SpeicherFehlerProps.fallback}. */
  fallback?: string;
}

/**
 * Grund einer abgelehnten Zeilenaktion an der Zeile selbst (LFH-1077, `frontend/AGENTS.md`,
 * „Rückwege und Fehler“): eine Zeile Text statt Alert, damit die Liste nicht springt. `data-fehler`
 * ist der Prüfgriff, wie an den Modul-Zeilen der Einstellungen.
 */
export function ZeilenFehler({ fehler, fallback }: ZeilenFehlerProps) {
  const text = fehlerText(fehler, fallback);
  if (text === null) return null;
  return (
    <Typography.Text type="danger" role="alert" data-fehler="true">
      {text}
    </Typography.Text>
  );
}
