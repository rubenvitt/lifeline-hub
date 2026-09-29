import { Alert, Button, theme } from 'antd';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { flaeche } from '../theme/tokens';
import type { PlatzhalterRueckweg } from './Platzhalter';
import Paneel from './instrument/Paneel';
import { schriftStil, useRollen } from './instrument/rollenwerte';
// Die Skelettform lebt als Klasse in der Gestaltungssprache (`.lfh-skelett`). Der Import gehört
// HIERHER: Konsumenten in `AdminPage` montieren kein `EinsatzSeite`, ihre Balken wären sonst
// 0 px hoch — und jsdom könnte das nicht zeigen.
import '../theme/sprache.css';

/**
 * Lade-, Leer- und Fehlerzustände einer Seite (LFH-328 · A2, LFH-331 · B3). Lade- und
 * Fehlerzweig stehen an den Aufrufstellen unmittelbar untereinander, deshalb eine Datei.
 */

const { useToken } = theme;

interface SeitenSkeletonProps {
  /** Anzahl der Balken unter der Kopfzeile. Default 3 — die Form der A0-Referenz. */
  zeilen?: number;
}

/**
 * Ladezustand als Skelettbalken in Kachelform — **kein drehender `Spin`**: die Balken zeigen
 * die Form des kommenden Inhalts. Die Ansage für Screenreader steckt im `aria-label`.
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
   * Zielpfad, gebaut vom Aufrufer über `routing/deeplinks.ts`. Das Primitiv kennt keine
   * Einsatz-Routen (wie `PlatzhalterRueckweg`).
   */
  pfad?: string;
  /**
   * Alternative für Stellen ohne Route, etwa einen Drawer über lokalen Zustand
   * (`pages/UnfallhilfsstellenDefault.tsx`).
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
 * Leerzustand einer Menge: „hier ist nichts" — und, wo möglich, der Weg dorthin, dass etwas da
 * ist.
 *
 * Die zentrierte Box aus `components/Liste.tsx`, **weder `Empty` noch `Result` noch `Alert`**:
 * antds Leer-Element trägt den Bezeichner, den AK3 repoweit auf null zählt; `Result` ist für eine
 * 360-px-Karte zu groß; ein `Alert` mit Aktion ist das *Fehler*-Idiom. Der Bezeichner steht hier
 * bewusst nicht ausgeschrieben: das Gate ist ein Grep.
 *
 * Die Box steuert **null** eigene Knöpfe bei; nur deshalb belegt eine Zusicherung auf genau
 * einen Knopf „genau eine Primäraktion".
 *
 * **Kein `role`.** Die `role="region"`-Knoten gehören `components/Datensicht.tsx`; ein zweiter
 * im Leerzustand machte jede Abfrage darauf mehrdeutig. Tests ankern auf sichtbarem Text.
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
            onClick={
              aktion.onClick ??
              (aktion.pfad != null ? () => void navigate(aktion.pfad!) : undefined)
            }
          >
            {aktion.label}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Die Detailzeile eines Fehlerzustands. Nur eine `ApiError` trägt eine fachlich formulierte
 * Meldung (aus dem `{error}`-Body); jeder andere Fehler ist technisch („Failed to fetch") und
 * ergibt `undefined`.
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
 * Fehlerzustand einer Seite. Ein antd-`Alert` statt der `.lfh-fehler`-Klasse: deren
 * Wiederholen-Knopf ist ein rohes `<button>` mit eigener Pixelhöhe und umginge die
 * Dichte-Staffel. `role="alert"` liefert `Alert` selbst.
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
 * Abgrenzung zu `SeitenFehler`: dort scheitert ein Ausschnitt, ein Banner genügt. Hier ist der
 * Rahmen selbst kaputt; deshalb die Großform mit Rückweg und genau **ein** Konsument
 * (`einsatz/EinsatzLayout.tsx`). Der Rückweg-Typ kommt aus `components/Platzhalter.tsx`: der
 * Aufrufer baut den Pfad, das Primitiv kennt keine Einsatz-Routen.
 */
export function SeitenSackgasse({
  titel,
  hinweis,
  ursache,
  onWiederholen,
  rueckweg,
}: SeitenSackgasseProps) {
  const navigate = useNavigate();
  const { token: t, rollen } = useRollen();
  const untertitel = hinweis ?? ursacheText(ursache);
  return (
    // Dieselbe Form wie `Platzhalter` (Paneel), damit zwei Sackgassen eine Formensprache sprechen.
    // Die Kante in `alarm` trägt „gescheitert" zusätzlich zum Wortlaut (WCAG 1.4.1); die Knöpfe
    // bleiben blau — Rot bedient nichts.
    <Paneel
      titel="Nicht verfügbar"
      koerperPolster
      style={{
        maxWidth: flaeche.seiteSchmal,
        marginInline: 'auto',
        marginBlockStart: t.marginLG,
        boxShadow: `inset 3px 0 0 0 ${rollen.alarm}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: t.marginSM }}>
        <div style={{ ...schriftStil('seitentitel'), color: rollen.text }}>{titel}</div>
        {untertitel != null && (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: rollen.text2 }}>
            {untertitel}
          </p>
        )}
        {(onWiederholen || rueckweg) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.marginSM }}>
            {onWiederholen && (
              <Button type="primary" onClick={onWiederholen}>
                Erneut abrufen
              </Button>
            )}
            {rueckweg && (
              <Button onClick={() => void navigate(rueckweg.pfad)}>{rueckweg.label}</Button>
            )}
          </div>
        )}
      </div>
    </Paneel>
  );
}

interface SeitenStandVeraltetProps {
  onWiederholen: () => void;
}

/**
 * Der gezeigte Stand stammt aus dem Zwischenspeicher, die Aktualisierung ist gescheitert.
 *
 * **Genau dieser Fall, nicht `isFetching` und nicht `isStale`**: `isStale` stünde nach
 * `staleTime` dauerhaft (und in Tests ohne `staleTime` immer); `isFetching` blendete bei jeder
 * SSE-Invalidierung ein und aus — der Sprung, gegen den Kriterium 12 existiert.
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
 * Text für `notFoundContent`/`placeholder` eines Auswahlfeldes, dessen Katalog-Query scheiterte
 * — statt eines stumm leeren Selects.
 *
 * `kein403` ist **optional und meist wegzulassen**: die Katalog-GETs der Kräfte-Module tragen
 * keine Admin-Schranke, nur `benutzer.rs` verlangt `AdminUser`. Wer die 403-Weiche einem
 * Fahrzeug-Pool anhängt, erfindet einen Fehlerfall.
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
