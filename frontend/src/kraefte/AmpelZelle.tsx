// Präzedenz `components/SeitenZustand.tsx`: die Sprachbausteine werden dort eingebunden,
// wo sie gebraucht werden, nicht global. Alle Regeln hängen an `.lfh-*` — die Datei färbt
// nichts ein, was sie nicht selbst anfasst.
import '../theme/sprache.css';
import { CarOutlined, UserOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { verteilungFelder } from './statusAchse';
import type { StatusVerteilung } from './kraeftebild';

/**
 * Die Zierde je Achse — ein Piktogramm, KEIN Emoji.
 *
 * Bis hierher kam das Symbol als `symbol: string` von aussen und war ein Emoji.
 * Ein Emoji ist keine Ikone: seine Zeichnung, seine Farbe und seine Breite kommen aus der
 * Schriftart des Betriebssystems, nicht aus dem Entwurf — es steht in der eigenen Farbe
 * neben einer Zeile, deren Farbgebung Bedeutung trägt (Kriterium 6), und im Ausdruck
 * verhält es sich anders als der übrige Satz.
 *
 * Die Zuordnung liegt deshalb HIER und nicht am Aufrufer: eine Prop, die eine Zeichenkette
 * nimmt, nimmt auch wieder ein Emoji. `bezeichnung` ist ein String-Union, die Abbildung
 * damit vollständig — es gibt keinen Weg, ein Bild von aussen hereinzureichen.
 *
 * `CarOutlined` hat Präzedenz für ein Fahrzeug (`pages/uhs/Grundriss.tsx`). `UserOutlined`
 * statt `TeamOutlined`: die Spalte zählt einzelne Kräfte, keine Gruppen.
 */
const IKONE: Record<'Personal' | 'Fahrzeuge', ReactNode> = {
  Personal: <UserOutlined />,
  Fahrzeuge: <CarOutlined />,
};

/**
 * Zählzeile einer Statusverteilung als ZWEI eigene Spalten des Meldebilds (LFH-330 · B2).
 *
 * Vorher standen Personal und Fahrzeuge zusammen in EINER 220-px-Statusspalte: bis zu acht
 * `Tag` in einem `Space` ohne `wrap`, zwei Zierzeichen als einzige Unterscheidung der
 * Achsen, und Werte gleich 0 wurden weggelassen — zwei Zeilen einer Vergleichstabelle
 * fluchteten damit nicht mehr übereinander (Prüflisten-Kriterium 14).
 *
 * ── DER ZWEITE KANAL, und warum die naheliegende Lösung nicht reicht ────────────
 *
 * `.lfh-feld--alarm .lfh-zahl` färbt nur die ZAHL. Farbe allein trägt keine Bedeutung
 * (WCAG 1.4.1, Kriterium 6), also ist jedes Feld ein VERBUND aus `.lfh-etikett` (Kurztext,
 * immer sichtbar) und `.lfh-zahl`. Der Text trägt die Bedeutung, die Farbe die Dringlichkeit —
 * und `normal`/`neutral` haben gar keine Farbregel, was genau richtig ist.
 *
 * ── DIE IKONE IST ZIERDE ────────────────────────────────────────────────────────
 *
 * Sie trägt `aria-hidden`, die Zählgruppe trägt das Etikett. Beides gleichzeitig ist kein
 * Widerspruch: es sind zwei Knoten, und der bedeutungstragende ist die Gruppe. Wäre es
 * umgekehrt, hinge die Unterscheidung Personal/Fahrzeuge an einem Bild.
 *
 * Das `aria-hidden` ist hier NICHT bloss Hygiene: ein `@ant-design/icons`-Element bringt
 * selbst `role="img"` mit einem eigenen englischen `aria-label` mit („user"/„car"). Der
 * NAME der Gruppe leidet darunter nicht — `aria-label` schlägt den Inhalt, das ist
 * gemessen —, aber ohne die Hülle stünde in JEDER Zeile der Vergleichstabelle ein
 * zusätzlicher, fremdsprachiger Knoten im Baum, den ein Vorleser ansteuert und vorliest.
 * Verwandt mit LFH-366, wo dasselbe `aria-label` in einen Menü-Namen einfloss.
 * Der Test misst die Wirkung, nicht die Absicht: innerhalb der Gruppe überlebt keine
 * `img`-Rolle (ohne `aria-hidden` färbt sich das rot, per Mutationsprobe belegt).
 *
 * ── NICHT `.lfh-felder` ─────────────────────────────────────────────────────────
 *
 * Der Werteblock des Lage-Dashboards ist ein vierspaltiges Raster mit Rahmen. In einer
 * Tabellenzelle ist das falsch, deshalb `.lfh-ampel` — dieselben Felder, ohne Raster, ohne
 * Rahmen, mit engerer Polsterung. Die Klasse ist ADDITIV zu `sprache.css`; die bestehenden
 * Regeln sind nicht angetastet.
 */
export default function AmpelZelle({
  bezeichnung,
  verteilung,
}: {
  /**
   * Zugängliche Bezeichnung der Zählgruppe — dieselbe Zeichenkette wie der Spaltenkopf,
   * und zugleich der Schlüssel der Zierde (siehe `IKONE`).
   */
  bezeichnung: 'Personal' | 'Fahrzeuge';
  verteilung: StatusVerteilung | null;
}) {
  const felder = verteilungFelder(verteilung);
  // `mittel`-Zeilen tragen keine Verteilung: dann steht hier nichts, nicht „0 0 0 0".
  if (felder.length === 0) return null;
  return (
    <span className="lfh-ampel" role="group" aria-label={bezeichnung}>
      <span aria-hidden="true">{IKONE[bezeichnung]}</span>
      {felder.map((f) => (
        <span
          key={f.etikett}
          className={f.stufe ? `lfh-feld lfh-feld--${f.stufe}` : 'lfh-feld'}
          title={f.titel}
        >
          <span className="lfh-etikett">{f.etikett}</span>
          <b className="lfh-zahl lfh-zahl--mittel">{f.wert}</b>
        </span>
      ))}
    </span>
  );
}
