import {
  Children,
  Fragment,
  isValidElement,
  type AriaAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import Stapel from './Stapel';
import Textstufe, { type Textton } from './Textstufe';

/**
 * MetaZeile — Angaben zu einem Datensatz in einer Zeile (Spec `schriftstufen`, „Metazeile in
 * einer Form", LLH-1810): Teile in `textKlein`/`schwach`, dazwischen „·", den der Vorleser nicht
 * hört. Ein leerer Teil fällt samt Trenner weg, damit kein „· ·" stehen bleibt. Zahl, Zeit,
 * Kennzeichen und Nummer stehen mit `mono` in der Stufe `monoFein` (Zahlenfamilie, gleich breite
 * Ziffern; LLH-2046, vorher `meta`). Reicht die Breite nicht, bricht die Zeile zwischen den Teilen um.
 *
 * Steht eine Zeit in einem Wortteil („bis 14:32“), trägt `MetaZeile.Zahl` sie in Mono.
 *
 * Ersetzt `Text type="secondary" style={{ fontSize: 12 }}` mit Trennern von Hand. Regel:
 * `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine.
 */

interface TeilProps {
  children?: ReactNode;
  /** Zahl, Zeit, Kennzeichen, Nummer: Stufe `monoFein` in der Zahlenfamilie. */
  mono?: boolean;
  /** Eigener Ton, etwa `alarm` für „nicht erreichbar“; Vorgabe `schwach`. */
  ton?: Textton;
}

function Teil({ children, mono = false, ton = 'schwach' }: TeilProps) {
  return (
    <Textstufe stufe={mono ? 'monoFein' : 'textKlein'} ton={ton}>
      {children}
    </Textstufe>
  );
}

/** Eine Zahl, Zeit oder Nummer inmitten eines Wortteils („bis 14:32“): Stufe `monoFein`. */
function Zahl({ children }: { children: ReactNode }) {
  return (
    <Textstufe stufe="monoFein" ton="schwach">
      {children}
    </Textstufe>
  );
}

/** Leer ist ein Inhalt, von dem nach `null`, `false` und leeren Texten nichts bleibt. */
function istLeer(inhalt: ReactNode): boolean {
  return Children.toArray(inhalt).every((kind) => kind === '');
}

interface MetaZeileProps extends Pick<AriaAttributes, 'aria-label'> {
  children: ReactNode;
  className?: string;
}

function MetaZeile({ children, className, ...aria }: MetaZeileProps) {
  // Text ohne `Teil` wird ein eigener Teil, statt still zu verschwinden.
  const teile = Children.toArray(children)
    .map((kind, i) =>
      isValidElement<TeilProps>(kind) ? kind : <Teil key={`text-${i}`}>{kind}</Teil>,
    )
    .filter((kind): kind is ReactElement<TeilProps> => !istLeer(kind.props.children));
  if (teile.length === 0) return null;
  return (
    <Stapel
      richtung="zeile"
      umbruch
      abstand="xs"
      ausrichten="baseline"
      className={className}
      {...aria}
    >
      {teile.map((teil, i) => (
        <Fragment key={teil.key ?? i}>
          {/* Weißraum außerhalb des versteckten Trenners: Vorleser und Kopieren trennen die
              Teile; im Flex-Container zählt reiner Weißraum nicht als Element. */}
          {i > 0 && ' '}
          {i > 0 && (
            <Textstufe stufe="textKlein" ton="schwach">
              <span aria-hidden="true">·</span>
            </Textstufe>
          )}
          {i > 0 && ' '}
          {teil}
        </Fragment>
      ))}
    </Stapel>
  );
}

MetaZeile.Teil = Teil;
MetaZeile.Zahl = Zahl;

export default MetaZeile;
