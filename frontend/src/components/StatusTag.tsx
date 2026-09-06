import { Tag, theme } from 'antd';
import { rollenFarbe, type StatusDarstellung } from '../theme/statusFarben';

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
}

/**
 * Einheitliche Statusanzeige über dem Statusfarb-Vertrag (LFH-328 · A2).
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
export default function StatusTag({ darstellung, title, farbe: ueberschrieben }: StatusTagProps) {
  const { token } = theme.useToken();
  const farbe = rollenFarbe(darstellung.rolle, token);
  const mandantenfarbe = ueberschrieben?.trim();
  return (
    <Tag
      title={title}
      data-rolle={darstellung.rolle}
      style={{ color: token.colorText, borderColor: farbe, background: 'transparent' }}
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
            display: 'inline-block', width: '0.5em', height: '0.5em', borderRadius: '50%',
            backgroundColor: mandantenfarbe, marginInlineEnd: token.marginXXS,
          }}
        />
      )}
      {darstellung.label}
    </Tag>
  );
}
