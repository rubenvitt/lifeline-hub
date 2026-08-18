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
   * Mandantengepflegte Farbe, die die Rollenfarbe überschreibt — für Kataloge AUSSERHALB
   * des A2-Vertrags (`fahrzeug_status.status_farbe`, `personal_status.status_farbe`;
   * das Backend trimmt sie nur, es validiert sie nicht).
   *
   * Sie landet auf Rand und Text, NIE auf der Fläche (LFH-339 · C4, Zielform-Spec §4b):
   * Kontrast (WCAG 1.4.11) ist bei ungeprüftem Freitext nicht zugesichert, und auf einem
   * Rand trägt die Farbe keine Textlesbarkeit. Der Bestand rendert sie heute noch über
   * antds `color`-Prop als Vollfläche mit erzwungen weißem Text — genau die Form, die
   * dieser Baustein für die Rollenachse ausdrücklich verwirft.
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
 * BEWUSST OHNE antds `color`-Prop: ein nicht-Preset-Wert würde dort als VOLLFLÄCHE mit
 * erzwungen weißem Text gerendert, und im Dunkelmodus sind die Rollenfarben aufgehellt
 * (`alarm` ist dort ein helles Rot) — weiß darauf ist unlesbar. Stattdessen die
 * Umrissform der A0-Formensprache: Rollenfarbe als Text- und Rahmenfarbe auf der
 * Tag-Grundfläche. Nebeneffekt, der Tests trägt: es entsteht keine mehrdeutige
 * `.ant-tag-*`-Farbklasse, an der ein Test sich festhalten könnte.
 *
 * Keine Klein-Variante am Steuerelement (A1 Gate 4) — die Höhe kommt aus der
 * Dichte-Staffel am `ConfigProvider`.
 */
export default function StatusTag({ darstellung, title, farbe: ueberschrieben }: StatusTagProps) {
  const { token } = theme.useToken();
  const farbe = ueberschrieben?.trim() ? ueberschrieben.trim() : rollenFarbe(darstellung.rolle, token);
  return (
    <Tag
      title={title}
      data-rolle={darstellung.rolle}
      style={{ color: farbe, borderColor: farbe, background: 'transparent' }}
    >
      {darstellung.form && (
        <span aria-hidden="true" style={{ marginInlineEnd: token.marginXXS }}>
          {FORM_ZEICHEN[darstellung.form]}
        </span>
      )}
      {darstellung.label}
    </Tag>
  );
}
