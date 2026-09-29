import { Tag } from 'antd';
import { rollenFarbe, type StatusDarstellung } from '../theme/statusFarben';
import { useRollen } from './instrument/rollenwerte';
import { statusFlaeche, tonVonRolle } from './instrument/statusFlaeche';

/** Formzeichen als DRITTER Kanal (DV 102 / A0-Formensprache). Für Screenreader
 *  ausgeblendet — die Bedeutung trägt bereits `label`, sonst läse er sie doppelt. */
const FORM_ZEICHEN: Record<NonNullable<StatusDarstellung['form']>, string> = {
  dreieck: '▲',
  kreis: '●',
  balken: '▮',
};

interface StatusTagProps {
  darstellung: StatusDarstellung;
  /** Zusatzinformation als Tooltip-Attribut (z. B. Stand der Meldung). */
  title?: string;
  /**
   * Mandantengepflegte Zusatzfarbe — für Kataloge AUSSERHALB des A2-Vertrags
   * (`fahrzeug_status.status_farbe`, `personal_status.status_farbe`; das Backend trimmt sie nur,
   * es validiert sie nicht).
   *
   * Nur ein dekorativer Farbpunkt (LFH-446, aria-hidden): Freitext wie `transparent` darf weder
   * Wortlaut noch tragenden Rahmen ausblenden. Leerer String und `null` zählen als „nicht
   * gepflegt".
   */
  farbe?: string | null;
  /**
   * `flaeche` (getönte Fläche, getönter Text, Rand in Rollenfarbe) oder `rand` (Rolle am
   * Rand, Wortlaut in `colorText`, kein Grund). Ohne Angabe: `flaeche` für jede Rolle mit
   * Statusfläche, `rand` für `marke` und IMMER `rand`, sobald eine Mandantenfarbe gesetzt
   * ist — siehe Dateikopf.
   */
  darstellungsart?: 'flaeche' | 'rand';
}

/** Die wirksame Darstellungsart — rein, damit die Regel ohne Render prüfbar ist. */
export function wirksameDarstellungsart(
  darstellung: StatusDarstellung,
  mandantenfarbe: string | null | undefined,
  gewuenscht?: 'flaeche' | 'rand',
): 'flaeche' | 'rand' {
  if (mandantenfarbe?.trim()) return 'rand';
  if (tonVonRolle(darstellung.rolle) == null) return 'rand';
  return gewuenscht ?? 'flaeche';
}

/**
 * Einheitliche Statusanzeige über dem Statusfarb-Vertrag (LFH-328 · A2).
 *
 * ── DIE FLÄCHE IST DIE VORGABE ──────────────────────────────────────────────────────
 *
 * Für ROLLENfarben steht der Status als getönte Fläche mit getöntem Text. Werte und
 * Kontrastrechnung liegen an EINER Stelle, `components/instrument/statusFlaeche.ts`, die auch
 * `StatusChip` und `StatusZelle` tragen. Die Kontrastböden (Tag ≥ 7, Nacht ≥ 5) halten in jeder
 * Rolle; `achtung`/`alarm` beschriften dafür mit `achtungText`/`alarmText`. Der 1-px-Rand bleibt
 * in der Rollenfarbe, weil `kraefte-kontrast.spec.ts` ihn als tragende Kante misst (≥ 3 : 1).
 *
 * DIE RAND-FORM BLEIBT für zwei Fälle, und das ist Vertrag:
 *  · **Mandantenfarbe gesetzt** (`farbe`): ungeprüfter Freitext; den Kontrast einer Fläche neben
 *    einem frei gewählten Punkt kann niemand zusichern.
 *  · **Rolle `marke`**: Signatur, kein Zustand — es gibt keine Markenfläche.
 * Wer die Rand-Form ausdrücklich will, setzt `darstellungsart="rand"`.
 *
 * ── DIE RAND-FORM (LFH-446) ─────────────────────────────────────────────────────────
 *
 * Nimmt eine {@link StatusDarstellung} statt Farbe + Text getrennt — der zweite Kanal
 * (WCAG 1.4.1) ist Typ, nicht Disziplin.
 *
 * BEWUSST OHNE antds `color`-Prop: antd 6 berechnet für Nicht-Presets ein statisches Farbpaar
 * unabhängig vom Modus. Stattdessen Rollenfarbe an Rahmen/Formzeichen, Wortlaut aus `colorText`
 * (farbiger Text hielt im Hellmodus 7 : 1 nicht). Nebeneffekt: keine mehrdeutige
 * `.ant-tag-*`-Farbklasse, an der ein Test sich festhalten könnte.
 *
 * Keine Klein-Variante am Steuerelement — die Höhe kommt aus der Dichte-Staffel.
 */
export default function StatusTag({
  darstellung,
  title,
  farbe: ueberschrieben,
  darstellungsart,
}: StatusTagProps) {
  const { token, rollen } = useRollen();
  const mandantenfarbe = ueberschrieben?.trim();
  const art = wirksameDarstellungsart(darstellung, mandantenfarbe, darstellungsart);
  const ton = tonVonRolle(darstellung.rolle);
  const flaeche = art === 'flaeche' && ton != null ? statusFlaeche(rollen, ton) : null;
  const farbe = flaeche ? flaeche.kante : rollenFarbe(darstellung.rolle, token);
  return (
    <Tag
      title={title}
      data-rolle={darstellung.rolle}
      data-darstellung={art}
      style={
        flaeche
          ? { color: flaeche.text, borderColor: flaeche.kante, background: flaeche.grund }
          : { color: token.colorText, borderColor: farbe, background: 'transparent' }
      }
    >
      {darstellung.form && (
        <span aria-hidden="true" style={{ color: farbe, marginInlineEnd: token.marginXXS }}>
          {FORM_ZEICHEN[darstellung.form]}
        </span>
      )}
      {mandantenfarbe && (
        // Hintergrund statt Textfarbe: ungültiges CSS bleibt transparent, ohne eine
        // scheinbare Mandantenfarbe aus dem Wortlaut zu erben.
        <span
          aria-hidden="true"
          data-lfh="mandantenfarbe"
          style={{
            display: 'inline-block',
            width: '0.5em',
            height: '0.5em',
            borderRadius: 0,
            backgroundColor: mandantenfarbe,
            marginInlineEnd: token.marginXXS,
          }}
        />
      )}
      {darstellung.label}
    </Tag>
  );
}
