import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useRollen } from './instrument/rollenwerte';

/**
 * Inline bearbeitbare Bemerkung — mit sichtbarer Affordanz im LEEREN Zustand (LFH-369 · B5i).
 *
 * Antds `Typography.Text editable` ließ bei leerem Wert nur das Stift-Icon übrig. Namenlos war
 * es nicht (antd setzt `aria-label` aus der Locale, mit `deDE` „Bearbeiten"), aber:
 *
 * 1. **Sichtbar stand keine Aufforderung**, nur ein Icon mit kleiner Trefffläche.
 * 2. **Der Name sagt nicht, WAS**: n Zeilen lieferten n gleichnamige Knöpfe. Deshalb trägt
 *    {@link BemerkungZelleProps.kennung} die Zeilenkennung in den Namen.
 * 3. **Die Affordanz war falsch herum verteilt**: der Lesezweig hatte ein „—", der Schreibzweig
 *    nichts.
 *
 * ── NUR FÜR OPTIONALE NOTIZEN ──────────────────────────────────────────────────────────
 *
 * `pages/gefahren/GefahrenPage.tsx` und `pages/lagekarte/Sidebar.tsx` benennen **Pflichtnamen**
 * um; ein „hinzufügen"-Platzhalter hätte dort keinen Zustand. Die Mechanik ist verschieden:
 * `Sidebar` verwirft eine leere Eingabe selbst, `GefahrenPage` fängt sie erst in der Anzeige ab
 * (`api/gefahren.ts`, `gefahrengebietName`). Sie bleiben draußen.
 *
 * {@link BemerkungZelleProps.bezeichnung} tauscht nur das Wort (etwa „Zustand hinzufügen" in
 * `personen/personenSpalten.tsx`), die Mechanik bleibt eine.
 *
 * ── WARUM EIN ECHTER `Button` ──────────────────────────────────────────────────────────
 *
 * Ein `Button` erbt seine Höhe vom `ConfigProvider`; ein gestyltes `<span onClick>` schuldete
 * die zwei Angaben eines handgebauten Bedienziels (LFH-365). `type="link"` macht ihn zum
 * Bedienziel in Blau, die TEXTfarbe kommt aus `rollen.bedienText` (siehe am Knopf).
 *
 * ── DER GEFÜLLTE WERT IST SELBST DAS ZIEL (LFH-650) ────────────────────────────────────
 *
 * Der Wert ist ein `Button type="text"` mit Stift-Ikone: dieselbe Bauform wie der Platzhalter,
 * also dieselbe Höhe in beiden Zuständen (keine Zeile schrumpft nach dem Speichern) und die
 * ganze Zelle als Trefffläche. `text` statt `link`, weil der Wert Inhalt ist — blau läse er sich
 * als Verweis. Er darf umbrechen (`height: auto`) und schuldet damit die ZWEI Angaben eines
 * handgebauten Bedienziels: {@link wertKnopfStil}, rein und exportiert.
 *
 * Der zugängliche NAME bleibt die Aufforderung („Zustand zu R-042 bearbeiten"), der Wert wird
 * zur BESCHREIBUNG (`aria-describedby`) — ein `aria-label` verdeckte den Inhalt.
 */

/**
 * Stil des gefüllten Wertknopfs. Rein, damit die Zusicherung über zwei Dichtestufen ohne
 * Rendern prüfbar ist (Muster `bedienzielStil`): `minHeight` aus `controlHeight` trägt den
 * Boden, die Polsterung den Abstand des umbrechenden Textes zum Rand.
 */
export function wertKnopfStil(token: {
  controlHeight: number;
  paddingXS: number;
  paddingSM: number;
}): CSSProperties {
  return {
    height: 'auto',
    minHeight: token.controlHeight,
    // Beide Achsen gesetzt, sonst hinge die Inline-Polsterung an antds Knopfvorgabe statt an der
    // Stufe.
    paddingBlock: token.paddingXS,
    paddingInline: token.paddingSM,
    maxWidth: '100%',
    whiteSpace: 'normal',
    textAlign: 'start',
    // Der Text beginnt links wie jede andere Zelle; antd zentriert Knopfinhalt.
    justifyContent: 'flex-start',
    overflowWrap: 'anywhere',
  };
}

export interface BemerkungZelleProps {
  /**
   * Aktueller Wert. `null`/`undefined`/`''` = leer, dann erscheint der Platzhalter. `undefined`
   * kommt aus dem Wire (`bemerkung?: string | null`); für die Anzeige ist beides dasselbe Nichts.
   */
  wert: string | null | undefined;
  /** Ohne Schreibrecht bleibt die Zelle reine Anzeige. */
  darfSchreiben: boolean;
  /**
   * Übernahme des neuen Wertes. Absichtlich NUR der Wert: die Aufrufer schließen über ihre eigene
   * Kennung und Mutation.
   */
  onSpeichern: (wert: string) => void;
  /**
   * Menschenlesbare Zeilenkennung (Funkrufname, Name, Bezeichnung) für den zugänglichen Namen —
   * sonst liefern n Zeilen n gleichnamige Knöpfe. Optional für den Einzelgebrauch außerhalb einer
   * Liste.
   */
  kennung?: string;
  /**
   * Das Wort für das Feld in Platzhalter und zugänglichem Namen („Zustand hinzufügen",
   * „Zustand zu R-042 bearbeiten"). Vorgabe „Bemerkung".
   */
  bezeichnung?: string;
  /**
   * Ein Schreibvorgang läuft (LFH-650). Der Aufrufer reicht dann den NEUEN Wert als `wert`; die
   * Zelle zeigt ihn sofort mit Ladeanzeige statt des alten Stands.
   */
  laeuft?: boolean;
}

/** Wortlaut an EINER Stelle — Seiten und Tests greifen denselben Namen.
 *  Entspricht dem Platzhalter mit der Vorgabe-`bezeichnung` (Test pinnt die Gleichheit). */
export const BEMERKUNG_HINZUFUEGEN = 'Bemerkung hinzufügen';

export function BemerkungZelle({
  wert,
  darfSchreiben,
  onSpeichern,
  kennung,
  bezeichnung = 'Bemerkung',
  laeuft = false,
}: BemerkungZelleProps) {
  const [bearbeitet, setBearbeitet] = useState(false);
  const { token, rollen } = useRollen();
  const wertId = useId();
  // EIN Ref für beide Knöpfe: Platzhalter und Wertknopf stehen nie gleichzeitig im Baum.
  const knopfRef = useRef<HTMLButtonElement>(null);
  const fokusZurueck = useRef(false);
  const gefuellt = !!wert;

  /**
   * Fokusrückgabe nach dem Verlassen der Bearbeitung.
   *
   * antd gibt den Fokus nur an seinen EIGENEN Stift zurück, und nur solange `Typography.Text` am
   * Baum bleibt. Hier steht `Typography` nur WÄHREND der Bearbeitung im Baum:
   *
   * 1. **Abbrechen / leer geblieben:** `Typography` hängt in derselben Runde aus, in der der
   *    Platzhalter zurückkommt.
   * 2. **Gespeichert, Wert kommt NACH:** der neue Wert trifft per Invalidierung erst eine Runde
   *    später ein, und ein FRISCHER Wertknopf ersetzt den Platzhalter.
   *
   * In beiden Fällen fiele der Fokus auf `<body>`. Deshalb ein Merker, der den Zweigwechsel
   * ÜBERLEBT, statt einer Flanke auf `bearbeitet`.
   *
   * Ohne Deps-Array: der Effekt muss auch laufen, wenn sich nur `wert` ändert. Eingegriffen wird
   * NUR bei verwaistem Fokus (`activeElement === body`); sitzt er woanders, fällt der Merker.
   *
   * `useLayoutEffect` wie antd: vor dem Anstrich, damit der Fokus nicht sichtbar springt.
   */
  useLayoutEffect(() => {
    if (bearbeitet) {
      fokusZurueck.current = true;
      return;
    }
    if (!fokusZurueck.current) return;
    const ziel = knopfRef.current;
    if (!ziel) return;
    if (document.activeElement === document.body || document.activeElement === null) ziel.focus();
    else fokusZurueck.current = false;
  });

  /**
   * Lesezweig bei „—": ohne Schreibrecht gibt es keine Aktion, eine Aufforderung liefe ins Leere.
   * Konsistent ist die **Bedeutung** des Leerzustands, nicht der Wortlaut.
   *
   * Gleiche Zeilenhöhe ZWISCHEN Lese- und Schreibzweig ist NICHT zugesichert (blanker Text gegen
   * `Button`). INNERHALB des Schreibzweigs sind leer und gefüllt gleich hoch
   * (`e2e/gate3-trefflaeche.spec.ts`).
   */
  if (!darfSchreiben) return <>{wert || '—'}</>;

  if (!bearbeitet && !gefuellt) {
    return (
      <Button
        ref={knopfRef}
        type="link"
        loading={laeuft}
        // `bedienText` statt antds `colorLink`: in einer Zeile mit Lücken-Tönung hielt `colorLink` die
        // Kontrastböden nicht (`e2e/betroffene-kontrast.spec.ts`). `bedienText` ist die Rolle für
        // blauen TEXT.
        style={{ color: rollen.bedienText }}
        // Sichtbar bleibt der kurze Text, der Name trägt die Zeile — sonst wird die Spalte
        // so breit wie die längste Kennung.
        aria-label={kennung ? `${bezeichnung} zu ${kennung} hinzufügen` : undefined}
        onClick={() => setBearbeitet(true)}
      >
        {`${bezeichnung} hinzufügen`}
      </Button>
    );
  }

  if (!bearbeitet) {
    return (
      <Button
        ref={knopfRef}
        type="text"
        // `loading` sperrt den zweiten Klick, solange der erste schreibt, und ersetzt die Stift-Ikone
        // durch antds Ladeanzeige.
        loading={laeuft}
        aria-label={
          kennung ? `${bezeichnung} zu ${kennung} bearbeiten` : `${bezeichnung} bearbeiten`
        }
        aria-describedby={wertId}
        style={wertKnopfStil(token)}
        onClick={() => setBearbeitet(true)}
      >
        <span id={wertId}>{wert}</span>
        {/* Ikone ohne eigenes Vorleseziel: `@ant-design/icons` bringt `role="img"` mit
            englischem Namen („edit") mit (CLAUDE.md, „Ein Emoji ist keine Ikone"). */}
        {!laeuft && (
          <span aria-hidden="true" style={{ color: token.colorTextSecondary }}>
            <EditOutlined />
          </span>
        )}
      </Button>
    );
  }

  return (
    <Typography.Text
      editable={{
        // `editing` KONTROLLIERT und hier immer an: außerhalb der Bearbeitung trägt einer der
        // beiden Knöpfe oben, `Typography` steht nur für das Eingabefeld im Baum.
        editing: true,
        onChange: (val) => {
          setBearbeitet(false);
          // antd vergleicht NICHT — `onChange` feuert beim Verlassen unbedingt. Ohne diesen Riegel kostete
          // ein Fehlklick ein PATCH samt Invalidierung und Live-Ereignis.
          if (val !== (wert ?? '')) onSpeichern(val);
        },
        onCancel: () => setBearbeitet(false),
      }}
    >
      {wert ?? ''}
    </Typography.Text>
  );
}
