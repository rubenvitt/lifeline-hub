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
   * Mandantengepflegte Zusatzfarbe — für Kataloge AUSSERHALB
   * des A2-Vertrags (`fahrzeug_status.status_farbe`, `personal_status.status_farbe`;
   * das Backend trimmt sie nur, es validiert sie nicht).
   *
   * LFH-446: nur ein dekorativer Farbpunkt. Freitext wie `transparent` darf weder den
   * Wortlaut noch den tragenden Rahmen ausblenden. Beides ist durch den Rollenvertrag
   * bestimmt; der zusätzliche Punkt trägt keine eigene Information und ist aria-hidden.
   *
   * Leerer String und `null` zählen als „nicht gepflegt": das Backend trimmt, ein
   * getrimmtes Nichts ist keine Farbe.
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
 * ── NEUENTWURF „INSTRUMENTENTAFEL" (21.09.2026): DIE FLÄCHE IST DIE VORGABE ─────────
 *
 * Entscheidung 2 des Auftraggebers hebt „Statusfarbe nie als Textfläche" für
 * ROLLENfarben auf: der Status steht als getönte Fläche mit getöntem Text da („Ampel als
 * Fläche, Zahl bleibt lesbar"). Die Werte und ihre Kontrastrechnung liegen an EINER
 * Stelle, `components/instrument/statusFlaeche.ts` — dieselbe Übersetzung tragen
 * `StatusChip` und `StatusZelle`. Die Böden aus Kriterium 5 (`e2e/*kontrast*.spec.ts`:
 * Tag ≥ 7, Nacht ≥ 5) halten in jeder Rolle; `achtung`/`alarm` beschriften dafür mit
 * ihren Textrollen `achtungText`/`alarmText` (Tag 8,02 / 7,31, LFH-618), die Füllfarbe
 * allein fiele am Tag darunter. Der 1-px-Rand bleibt in der Rollenfarbe stehen, weil
 * `kraefte-kontrast.spec.ts` ihn als tragende Kante misst (≥ 3 : 1 gegen den Grund).
 *
 * DIE RAND-FORM BLEIBT für zwei Fälle, und das ist Vertrag, nicht Übergang:
 *  · **Mandantenfarbe gesetzt** (`farbe`): die Zeile kommt aus einem Katalog mit
 *    ungeprüftem Freitext (`status_farbe`). Eine Fläche neben einem frei gewählten Punkt
 *    wäre die Kombination, deren Kontrast niemand zusichern kann.
 *  · **Rolle `marke`**: Signatur, kein Zustand — es gibt keine Markenfläche.
 * Wer die Rand-Form ausdrücklich will, setzt `darstellungsart="rand"`.
 *
 * ── DIE RAND-FORM (LFH-446), unverändert: ───────────────────────────────────────────
 *
 * Nimmt eine {@link StatusDarstellung} statt Farbe + Text getrennt — damit ist der
 * zweite Kanal (WCAG 1.4.1) nicht Disziplin, sondern Typ: einen Tag ohne Text kann
 * man hier gar nicht bauen.
 *
 * BEWUSST OHNE antds `color`-Prop: antd 6 berechnet für Nicht-Presets ein statisches
 * Farbpaar aus der Zeichenkette (bei `filled` mit HSL-Helligkeit 0.95 am Grund),
 * unabhängig vom aktiven Modus. Stattdessen die
 * Umrissform der A0-Formensprache: Rollenfarbe an Rahmen/Formzeichen, lesbarer Wortlaut
 * aus `colorText`. LFH-446 maß für farbigen Text im Hellmodus nur 4,88–6,94:1 statt 7:1.
 * Nebeneffekt, der Tests trägt: es entsteht keine mehrdeutige
 * `.ant-tag-*`-Farbklasse, an der ein Test sich festhalten könnte.
 *
 * Keine Klein-Variante am Steuerelement (A1 Gate 4) — die Höhe kommt aus der
 * Dichte-Staffel am `ConfigProvider`.
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
