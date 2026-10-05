import type { CSSProperties, ReactNode } from 'react';
import type { Farbrollen } from '../../theme/tokens';
import { monoStil, useRollen } from './rollenwerte';
import '../../theme/sprache.css';

/**
 * Schnellerfassungszeile — NUR die Hülle (ETB unten, Betroffene).
 *
 * Rahmen `bedien` 1 px, Grund `flaeche2`, Höhe ≥ 40; links eine Präfix-Zelle Mono 14 in `bedien`
 * mit Trennlinie (`/anordnung`, `/person`), in der Mitte das Feld des Aufrufers, rechts ein
 * Mono-Hinweis 11 (`↵ eintragen`), darunter optional eine Hinweiszeile Mono 11.
 *
 * WAS SIE NICHT IST: kein Formular. Die Erfassungs-Norm (LFH-332/B4) bleibt beim Konsumenten,
 * der seine Felder in `ErfassungsFormular` oder `SchnellAnlegen` hält. Ein `<form>` HIER wäre
 * verschachtelt und lüde beim Absenden die Seite neu. Die Hülle rendert nur `<div>`.
 *
 * Das Feld im Kind verliert Rahmen und Grund über `.lfh-schnellerfassung__feld` in
 * `theme/sprache.css` — die Zeile trägt den Rahmen. Seine HÖHE bleibt `controlHeight`, die Hülle
 * wächst mit (30 / 48 / 72).
 */
export function schnellerfassungStil(
  rollen: Pick<Farbrollen, 'bedien' | 'flaeche2' | 'text'>,
  token: { controlHeight: number },
  gestapelt = false,
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'stretch',
    minHeight: Math.max(40, token.controlHeight + 2),
    background: rollen.flaeche2,
    border: `1px solid ${rollen.bedien}`,
    color: rollen.text,
    ...(gestapelt ? { flexWrap: 'wrap' } : {}),
  };
}

/**
 * Die drei Zellen der Zeile, rein und exportiert (Prüfbarkeit ohne Layout).
 *
 * `gestapelt` (LFH-373, opt-in): das FELD steht zuerst und auf voller Breite, Präfix und Hinweis
 * folgen in einer zweiten Zeile. „Zuerst" heißt im DOM, nicht per CSS-`order` — sonst wichen
 * Tab- und Lesefolge von der Sichtfolge ab. Auf dem Handschirm bleibt dem Feld so die volle
 * Breite, und die angepinnte Leiste wächst nicht über die halbe Fensterhöhe. Die Trennlinie
 * hinter dem Präfix entfällt dann, eine Linie über der zweiten Zeile trennt Feld und Bedienung.
 */
export function zellenStile(
  rollen: Pick<Farbrollen, 'bedien' | 'linie' | 'schwach'>,
  token: { paddingSM: number },
  gestapelt: boolean,
): { praefix: CSSProperties; feld: CSSProperties; hinweis: CSSProperties } {
  const zweiteZeile: CSSProperties = gestapelt
    ? { borderBlockStart: `1px solid ${rollen.linie}` }
    : {};
  return {
    praefix: {
      ...monoStil(14),
      display: 'flex',
      alignItems: 'center',
      flex: gestapelt ? '1 1 auto' : '0 0 auto',
      paddingInline: token.paddingSM,
      ...(gestapelt ? zweiteZeile : { borderInlineEnd: `1px solid ${rollen.linie}` }),
      color: rollen.bedien,
    },
    feld: gestapelt
      ? { flex: '1 1 100%', minWidth: 0, display: 'flex', alignItems: 'center' }
      : { flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center' },
    hinweis: {
      ...monoStil(11),
      display: 'flex',
      alignItems: 'center',
      flex: '0 0 auto',
      paddingInline: token.paddingSM,
      color: rollen.schwach,
      ...(gestapelt ? { ...zweiteZeile, marginInlineStart: 'auto' } : {}),
    },
  };
}

interface SchnellerfassungszeileProps {
  /** Befehlspräfix links (`/anordnung`). Ohne Präfix entfällt die Zelle. */
  praefix?: ReactNode;
  /** Das Eingabefeld (bzw. mehrere) des Konsumenten. */
  children: ReactNode;
  /** Mono-Hinweis rechts in der Zeile (`↵ eintragen`). */
  hinweis?: ReactNode;
  /** Hinweiszeile darunter (Befehle, Kürzel, „Zuletzt: …"). */
  hinweiszeile?: ReactNode;
  /**
   * Feld auf eigener Zeile, Präfix und Hinweis darunter (LFH-373). Opt-in: der Aufrufer
   * entscheidet anhand seiner Breite, die Hülle kennt keinen Breakpoint.
   */
  gestapelt?: boolean;
  /**
   * Das Kind der Feldzelle füllt die Zelle auch ungestapelt (LFH-955). Opt-in: eine Zelle mit
   * mehreren Feldern nebeneinander (Infotelefon) streckt ihre Kinder nicht; ein Kind ohne eigene
   * Breite (die Wurzel des `MarkdownEditor` im ETB) blieb sonst auf seiner Inhaltsbreite.
   */
  feldFuellt?: boolean;
  style?: CSSProperties;
}

export default function Schnellerfassungszeile({
  praefix,
  children,
  hinweis,
  hinweiszeile,
  gestapelt = false,
  feldFuellt = false,
  style,
}: SchnellerfassungszeileProps) {
  const { token, rollen } = useRollen();
  const zellen = zellenStile(rollen, token, gestapelt);
  const feldZelle = (
    <div
      className={[
        'lfh-schnellerfassung__feld',
        gestapelt && 'lfh-schnellerfassung__feld--gestapelt',
        feldFuellt && 'lfh-schnellerfassung__feld--fuellt',
      ]
        .filter(Boolean)
        .join(' ')}
      style={zellen.feld}
    >
      {children}
    </div>
  );
  return (
    <div
      data-lfh="schnellerfassung"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, ...style }}
    >
      <div className="lfh-schnellerfassung" style={schnellerfassungStil(rollen, token, gestapelt)}>
        {gestapelt && feldZelle}
        {praefix != null && (
          <span data-lfh="schnellerfassung-praefix" style={zellen.praefix}>
            {praefix}
          </span>
        )}
        {!gestapelt && feldZelle}
        {hinweis != null && <span style={zellen.hinweis}>{hinweis}</span>}
      </div>
      {hinweiszeile != null && (
        <div
          style={{
            ...monoStil(11),
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.padding,
            rowGap: token.marginXXS,
            color: rollen.schwach,
          }}
        >
          {hinweiszeile}
        </div>
      )}
    </div>
  );
}
