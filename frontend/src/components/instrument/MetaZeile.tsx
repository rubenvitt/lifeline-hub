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
 * Kennzeichen und Nummer stehen mit `mono` in der Stufe `meta` (Zahlenfamilie, gleich breite
 * Ziffern). Reicht die Breite nicht, bricht die Zeile zwischen den Teilen um.
 *
 * Ersetzt `Text type="secondary" style={{ fontSize: 12 }}` mit Trennern von Hand. Regel:
 * `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine.
 */

interface TeilProps {
  children?: ReactNode;
  /** Zahl, Zeit, Kennzeichen, Nummer: Stufe `meta` in der Zahlenfamilie. */
  mono?: boolean;
  /** Eigener Ton, etwa `alarm` für „nicht erreichbar“; Vorgabe `schwach`. */
  ton?: Textton;
}

function Teil({ children, mono = false, ton = 'schwach' }: TeilProps) {
  return (
    <Textstufe stufe={mono ? 'meta' : 'textKlein'} ton={ton}>
      {children}
    </Textstufe>
  );
}

function istLeer(inhalt: ReactNode): boolean {
  return inhalt === null || inhalt === undefined || inhalt === false || inhalt === '';
}

interface MetaZeileProps extends Pick<AriaAttributes, 'aria-label'> {
  children: ReactNode;
  className?: string;
}

function MetaZeile({ children, className, ...aria }: MetaZeileProps) {
  const teile = Children.toArray(children).filter(
    (kind): kind is ReactElement<TeilProps> =>
      isValidElement<TeilProps>(kind) && !istLeer(kind.props.children),
  );
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
          {i > 0 && (
            <Textstufe stufe="textKlein" ton="schwach">
              <span aria-hidden="true">·</span>
            </Textstufe>
          )}
          {teil}
        </Fragment>
      ))}
    </Stapel>
  );
}

MetaZeile.Teil = Teil;

export default MetaZeile;
