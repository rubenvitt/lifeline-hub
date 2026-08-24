import { Alert, Flex, theme } from 'antd';
import { ApiError } from '../api/client';

/**
 * Persistenter Speicher-Fehler und erklärender Rechte-Hinweis (LFH-345 · C10, Befunde H14/M16).
 *
 * ── Warum nicht der Toast (H14) ────────────────────────────────────────────────
 * Sieben Speicherpfade dieser Gruppe meldeten Fehler ausschließlich über `message.error`.
 * Nach rund drei Sekunden war die Meldung weg, das ausgefüllte Formular stand unverändert
 * da und wirkte gespeichert — bei Aufbewahrungsfrist, Nummernkreisen und Fristen fällt das
 * erst Stunden später auf. Der Fehlerzustand gehört deshalb an die SEITE
 * (`mutation.error`) statt an eine Queue mit eigener Lebensdauer.
 *
 * Der ERFOLG bleibt beim Toast: er quittiert eine abgeschlossene Handlung und braucht
 * keinen Platz auf der Seite. Das ist dieselbe Trennung wie beim Autosave in LFH-342/C7 —
 * der Fehlerfall meldet sich sichtbar, der Erfolg leise.
 *
 * Der Alert verschwindet von selbst beim nächsten Absenden: react-query räumt `error` beim
 * Übergang nach `pending` weg. Das ist die zweite Hälfte der Zusicherung und gehört
 * mitgetestet — ein Alert, der stehen bleibt, wäre so falsch wie einer, der zu früh geht.
 *
 * ── Warum eine reine Funktion daneben ──────────────────────────────────────────
 * `fehlerText` ist rein und exportiert, damit die Fallunterscheidung ohne Render prüfbar
 * ist (Muster `bedienzielStil`/`zeilenzielStil`). Die Aussage „ohne Fehler NICHTS" ist die,
 * die ein Primitiv auffliegen lässt, das immer einen Text liefert.
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
}

export function SpeicherFehler({ fehler, titel }: SpeicherFehlerProps) {
  const text = fehlerText(fehler);
  if (text === null) return null;
  return <Alert type="error" showIcon title={titel ?? 'Nicht gespeichert'} description={text} />;
}

interface RechteHinweisProps {
  /** Was fehlt und warum — ein ganzer Satz, keine Abkürzung. */
  text: string;
  /** Nur bei FEHLENDER Berechtigung sichtbar. */
  sichtbar: boolean;
}

/**
 * Erklärt eine fehlende Berechtigung, statt sie stumm auszugrauen (M16).
 *
 * „Ausgegraut" allein ist eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1) und
 * nennt zudem keinen Grund — dieselbe Diagnose, die in LFH-370/B5j den sichtbaren
 * Sperrgrund an den Anmeldeverfahren-Zeilen ausgelöst hat. Der Unterschied hier ist der
 * Zuschnitt: dort steht der Grund je Zeile, hier über einem ganzen Block.
 */
export function RechteHinweis({ text, sichtbar }: RechteHinweisProps) {
  if (!sichtbar) return null;
  return <Alert type="info" showIcon title={text} />;
}

interface SeitenHinweiseProps {
  /** `mutation.error`; mehrere Mutationen einer Seite werden mit `??` verkettet. */
  fehler?: unknown;
  /** Erklärung der fehlenden Berechtigung; ohne Text kein Hinweis. */
  rechteText?: string;
  /** Nur bei FEHLENDER Berechtigung. */
  rechteFehlt?: boolean;
  fehlerTitel?: string;
}

/**
 * Beide Hinweise für EINEN Slot (`AdminPage`/`EinsatzSeite` haben genau einen `hinweis`).
 *
 * Der Grund für die Bündelung ist nicht Bequemlichkeit, sondern der **Leerfall**: die
 * Slot-Hülle rendert ihren eigenen Abstand, sobald ihr Inhalt truthy ist. Ein Fragment mit
 * zwei `null`-Kindern ist truthy — die Seite bekäme dann einen sichtbaren Leerraum, wo
 * nichts steht. Diese Komponente liefert in dem Fall selbst `null`.
 */
export function SeitenHinweise({
  fehler,
  rechteText,
  rechteFehlt = false,
  fehlerTitel,
}: SeitenHinweiseProps) {
  const { token } = theme.useToken();
  const zeigtRecht = rechteFehlt && rechteText != null;
  const zeigtFehler = fehlerText(fehler) !== null;
  if (!zeigtRecht && !zeigtFehler) return null;
  return (
    <Flex vertical gap={token.marginSM}>
      {zeigtRecht && <RechteHinweis sichtbar text={rechteText} />}
      <SpeicherFehler fehler={fehler} titel={fehlerTitel} />
    </Flex>
  );
}
