import { Alert, Button } from 'antd';
import { flaeche } from '../theme/tokens';
// Die Skelettform lebt als Klasse in der Gestaltungssprache (`.lfh-skelett`,
// A0-Referenzseite Lage-Dashboard). Der Import gehört HIERHER und nicht an den
// Aufrufer: zwei der vier Konsumenten stecken in `AdminPage`, nicht in
// `EinsatzSeite` — ohne den Import wären ihre Balken 0 px hoch, und jsdom rechnet
// kein Layout, könnte den Ausfall also in keinem Test zeigen.
import '../theme/sprache.css';

/**
 * Lade- und Fehlerzustand einer Seite (LFH-328 · A2).
 *
 * **Warum beide Exporte in einer Datei:** an allen vier umgezogenen Stellen stehen
 * Lade- und Fehlerzweig unmittelbar untereinander und sind byte-gleich kopiert. Nur
 * das Ladebild zu extrahieren ließe die Hälfte der Duplikation stehen.
 *
 * **BASELINE — das ist kein halber Umbau, sondern die Grenze des Tickets.** Gemessen
 * am 27.07.2026 gibt es im Frontend **32** Ladezustände mit `paddingTop: 80`
 * (22 Einzeiler + 10 mehrzeilig) plus **8** Ausreißer mit anderen Zahlen;
 * `admin/AdminLayout.tsx:31` baut sogar eine vierte Layout-Form
 * (`flex`/`justifyContent` statt `textAlign`). A2 zieht bewusst nur **vier** Stellen um
 * — `EinsatzdatenPage`, `EinsatzEinstellungenPage`, `einstellungen/EinsatzDefaults`,
 * `einstellungen/AnzeigeEinstellungen` —, weil A2 genau diese Dateien ohnehin anfasst
 * (Spec §7.1, „Norm auf ohnehin Angefasstes"). Der Rest ist **Zielticket B3
 * (Datenzustands-Primitive)**, kein Versehen und keine vergessene Datei.
 */

interface SeitenSkeletonProps {
  /** Anzahl der Balken unter der Kopfzeile. Default 3 — die Form der A0-Referenz. */
  zeilen?: number;
}

/**
 * Ladezustand als Skelettbalken in Kachelform — **kein drehender `Spin`**.
 *
 * Die Balken zeigen die Form des kommenden Inhalts, statt den Blick auf einen
 * Kreisel zu ziehen; das ist die A0-Entscheidung der Referenzseite. Die Ansage für
 * Screenreader steckt im `aria-label`, nicht als sichtbarer Zweittext daneben.
 */
export function SeitenSkeleton({ zeilen = 3 }: SeitenSkeletonProps) {
  return (
    <div style={{ paddingTop: flaeche.zustandOben }}>
      <div className="lfh-skelett" aria-busy="true" aria-label="Inhalt wird geladen">
        {Array.from({ length: zeilen }, (_, i) => (
          <span
            key={i}
            className={
              i === 0
                ? 'lfh-skelett__balken lfh-skelett__balken--gross'
                : i === zeilen - 1
                  ? 'lfh-skelett__balken lfh-skelett__balken--kurz'
                  : 'lfh-skelett__balken'
            }
          />
        ))}
      </div>
    </div>
  );
}

interface SeitenFehlerProps {
  /** Was schiefging, aus Sicht der Einsatzkraft — kein Stacktrace, kein Statuscode. */
  text: string;
  /** Gesetzt = die Seite bietet einen erneuten Abruf an. */
  onWiederholen?: () => void;
}

/**
 * Fehlerzustand einer Seite.
 *
 * Trägt bewusst ein antd-`Alert` und nicht die `.lfh-fehler`-Klasse der
 * A0-Referenzseite: deren Wiederholen-Knopf ist ein rohes `<button>` mit eigener
 * Pixelhöhe und umginge damit die Dichte-Staffel am `ConfigProvider` (A1 Gate 4).
 * `role="alert"` liefert `Alert` selbst, der Rahmen kommt aus den Rollenfarben des
 * Themes — kein Farbwert von Hand.
 */
export function SeitenFehler({ text, onWiederholen }: SeitenFehlerProps) {
  return (
    <Alert
      type="error"
      showIcon
      title={text}
      action={onWiederholen && <Button onClick={onWiederholen}>Erneut abrufen</Button>}
    />
  );
}
