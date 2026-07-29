import { Alert, Button, Result, theme } from 'antd';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { flaeche } from '../theme/tokens';
import type { PlatzhalterRueckweg } from './Platzhalter';
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

const { useToken } = theme;

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

/** Die eine Handlung, die aus einem Leerzustand herausführt. */
export interface SeitenLeerAktion {
  label: string;
  /**
   * Zielpfad — gebaut vom Aufrufer über `routing/deeplinks.ts`. Das Primitiv kennt
   * keine Einsatz-Routen; die Arbeitsteilung ist dieselbe wie bei `PlatzhalterRueckweg`.
   */
  pfad?: string;
  /**
   * Alternative für Stellen ohne Route. Nicht als Bequemlichkeit, sondern gemessen:
   * `pages/UnfallhilfsstellenDefault.tsx` — die einzige Stelle im Bestand, deren
   * Leerzustand heute zur Aktion führt — öffnet einen Drawer über lokalen Zustand.
   * Ein Pflicht-`pfad` zwänge dort eine Route zu erfinden, die es nicht gibt.
   */
  onClick?: () => void;
}

interface SeitenLeerProps {
  /** Was hier nicht ist. Pflicht — ein Leerzustand ohne Aussage ist der Zustand, den B3 abschafft. */
  titel: string;
  /** Warum, oder was als Nächstes zu tun ist. */
  hinweis?: string;
  /** Höchstens EINE — die Einzahl steckt im Slot, nicht in einer Prüfung zur Laufzeit. */
  aktion?: SeitenLeerAktion;
}

/**
 * Leerzustand einer Menge: „hier ist nichts" — und, wo möglich, der Weg dorthin, dass
 * etwas da ist.
 *
 * **Weder `Empty` noch `Result` noch `Alert`**, sondern die zentrierte Box, die
 * `components/Liste.tsx` schon immer baut. Drei Gründe, jeder gemessen:
 * antds `<Empty>` trägt das Token, das AK3 zählt (0 Knoten im Frontend) und machte das
 * Kriterium unerfüllbar; `Result` — die Form von `Platzhalter` — ist für eine 360-px-Karte
 * zu groß; und ein `Alert` mit Aktions-Slot ist im Bestand das *Fehler*-Idiom, eine leere
 * Liste aber keine Meldung.
 *
 * Der Nebeneffekt ist der eigentliche Gewinn: die Box steuert **null** eigene Knöpfe bei.
 * Nur deshalb belegt eine Zusicherung auf genau einen Knopf tatsächlich „genau eine
 * Primäraktion" statt nur „irgendwas ist anklickbar".
 *
 * **Kein `role`.** Die `role="region"`-Knoten im Frontend gehören `components/Datensicht.tsx`
 * und benennen die Sicht („Befehle", „Lageberichte"). Ein zweiter Regionsknoten im
 * Leerzustand machte jede Abfrage darauf mehrdeutig; Tests ankern hier auf sichtbarem Text.
 */
export function SeitenLeer({ titel, hinweis, aktion }: SeitenLeerProps) {
  const { token } = useToken();
  const navigate = useNavigate();
  return (
    <div style={{ padding: token.padding, textAlign: 'center' }}>
      <div style={{ color: token.colorTextSecondary, fontSize: token.fontSize }}>{titel}</div>
      {hinweis != null && (
        <div
          style={{
            color: token.colorTextDescription,
            fontSize: token.fontSizeSM,
            marginBlockStart: token.marginXXS,
          }}
        >
          {hinweis}
        </div>
      )}
      {aktion != null && (
        <div style={{ marginBlockStart: token.margin }}>
          <Button
            type="primary"
            onClick={aktion.onClick ?? (aktion.pfad != null ? () => void navigate(aktion.pfad!) : undefined)}
          >
            {aktion.label}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Die Detailzeile eines Fehlerzustands.
 *
 * Nur eine `ApiError` trägt eine Meldung, die vor einer Einsatzkraft bestehen kann — sie
 * kommt aus dem `{error}`-Body des Backends und ist fachlich formuliert. Jeder andere
 * Fehler trägt eine technische Meldung („Failed to fetch", ein Stacktrace-Fragment) und
 * ergibt bewusst `undefined`.
 *
 * Das ist byte-genau das Verhalten der fünf handgerollten Kopien, die diese Funktion
 * ablöst (LFH-331 · B3) — keine Verbesserung nebenbei, damit der Umzug nachweisbar
 * verhaltensgleich ist.
 */
export function ursacheText(ursache: unknown): string | undefined {
  return ursache instanceof ApiError ? ursache.message : undefined;
}

interface SeitenFehlerProps {
  /** Was schiefging, aus Sicht der Einsatzkraft — kein Stacktrace, kein Statuscode. */
  text: string;
  /** Rohfehler der Query. Nur eine `ApiError` liefert eine Detailzeile — siehe `ursacheText`. */
  ursache?: unknown;
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
export function SeitenFehler({ text, ursache, onWiederholen }: SeitenFehlerProps) {
  return (
    <Alert
      type="error"
      showIcon
      title={text}
      description={ursacheText(ursache)}
      action={onWiederholen && <Button onClick={onWiederholen}>Erneut abrufen</Button>}
    />
  );
}

interface SeitenSackgasseProps {
  titel: string;
  /** Gesetzt, verdrängt er die Meldung aus `ursache`. */
  hinweis?: string;
  ursache?: unknown;
  onWiederholen?: () => void;
  rueckweg?: PlatzhalterRueckweg;
}

/**
 * Fehlerzustand, der die **ganze Seite** ersetzt, weil hinter ihm nichts mehr steht.
 *
 * Abgrenzung zu `SeitenFehler`: dort scheitert ein Ausschnitt und der Rest der Seite
 * bleibt bedienbar — ein Banner genügt. Hier ist der Rahmen selbst kaputt, und die
 * Navigation führt in eine Sackgasse mit dreißig Türen. Deshalb die Großform mit
 * Rückweg, und deshalb genau **ein** Konsument (`einsatz/EinsatzLayout.tsx`).
 *
 * Der Rückweg-Typ kommt aus `components/Platzhalter.tsx` statt einer zweiten Form
 * derselben Gestalt: dort ist bereits festgelegt, dass der Aufrufer den Pfad baut
 * (über `routing/deeplinks.ts`) und das Primitiv keine Einsatz-Routen kennt.
 */
export function SeitenSackgasse({ titel, hinweis, ursache, onWiederholen, rueckweg }: SeitenSackgasseProps) {
  const navigate = useNavigate();
  const knoepfe = [
    onWiederholen && (
      <Button key="wiederholen" type="primary" onClick={onWiederholen}>
        Erneut abrufen
      </Button>
    ),
    rueckweg && (
      <Button key="rueckweg" onClick={() => void navigate(rueckweg.pfad)}>
        {rueckweg.label}
      </Button>
    ),
  ].filter(Boolean);
  return (
    <Result status="error" title={titel} subTitle={hinweis ?? ursacheText(ursache)} extra={knoepfe} />
  );
}

interface SeitenStandVeraltetProps {
  onWiederholen: () => void;
}

/**
 * Der gezeigte Stand stammt aus dem Zwischenspeicher, die Aktualisierung ist gescheitert.
 *
 * **Genau dieser Fall, nicht `isFetching` und nicht `isStale`** — beide sind als
 * Anzeige-Gate gemessen untauglich: `main.tsx` setzt `staleTime: 10_000`, ein Banner an
 * `isStale` stünde also zehn Sekunden nach jedem Abruf dauerhaft; und `test/utils.tsx`
 * setzt gar kein `staleTime`, womit es in *jedem* Test sofort sichtbar und jede
 * Zusicherung darauf wertlos wäre. Ein Banner an `isFetching` wiederum blendete bei jeder
 * SSE-Invalidierung ein und aus — genau der Sprung, gegen den Prüflisten-Kriterium 12
 * (CLS ≤ 0,1) existiert.
 *
 * `warning`, nicht `error`: die Zeilen darunter sind echt, nur alt. Rot ist Gefahr.
 */
export function SeitenStandVeraltet({ onWiederholen }: SeitenStandVeraltetProps) {
  return (
    <Alert
      type="warning"
      showIcon
      banner
      title="Angezeigter Stand konnte nicht aktualisiert werden — die Zeilen unten sind womöglich veraltet."
      action={<Button onClick={onWiederholen}>Erneut abrufen</Button>}
    />
  );
}

/** Die Teilmenge eines Query-Ergebnisses, aus der sich ein Nicht-Gefunden-Text ableiten lässt. */
interface FehlerLage {
  isError: boolean;
  error: unknown;
}

/**
 * Text für `notFoundContent`/`placeholder` eines Auswahlfeldes, dessen Katalog-Query
 * scheiterte — statt eines stumm leeren Selects.
 *
 * `kein403` ist **optional und meist wegzulassen.** Gemessen am Backend tragen die
 * Katalog-GETs der Kräfte-Module (`fahrzeug.rs`, `personal.rs`, `material.rs`,
 * `fahrzeug_status.rs`, `personal_status.rs`, `einheit_typ.rs`) allesamt keine
 * Admin-Schranke; nur `benutzer.rs` verlangt `_admin: AdminUser`. Deshalb steht die
 * 403-Weiche im Bestand an genau einer Stelle. Wer sie einem Fahrzeug-Pool anhängt,
 * erfindet einen Fehlerfall, den das Backend nicht kennt.
 */
export function nichtGefundenInhalt(
  query: FehlerLage,
  texte: { kein403?: string; allgemein: string },
): string | undefined {
  if (!query.isError) return undefined;
  if (texte.kein403 != null && query.error instanceof ApiError && query.error.status === 403) {
    return texte.kein403;
  }
  return texte.allgemein;
}
