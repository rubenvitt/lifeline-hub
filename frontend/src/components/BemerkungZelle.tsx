import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Typography, theme } from 'antd';
import { EditOutlined } from '@ant-design/icons';

/**
 * Inline bearbeitbare Bemerkung — mit sichtbarer Affordanz im LEEREN Zustand (LFH-369 · B5i).
 *
 * ── WARUM DIESES PRIMITIV ──────────────────────────────────────────────────────────────
 *
 * Befund M21: `FahrzeugePage`, `PersonalPage` und `MaterialPage` trugen drei zeichengleiche
 * Kopien von `Typography.Text editable` mit `{x.bemerkung ?? ''}` als Kind. Bei leerer
 * Bemerkung blieb davon genau das Stift-Icon übrig.
 *
 * ── PRÄZISIERUNG GEGEN TICKET UND ERSTEN ANLAUF (im Review gemessen) ───────────────────
 *
 * Der Stift ist NICHT namenlos, und das Akzeptanzkriterium des Tickets („nicht nur ein Icon
 * ohne zugänglichen Namen") beschreibt einen Zustand, den es so nie gab: antd setzt sein
 * `aria-label` unbedingt aus der Locale (`typography/Base/index.js:271-283`), und
 * `theme/ThemeModeProvider.tsx` fährt `deDE` — in Produktion heißt er **„Bearbeiten"**
 * (`locale/de_DE.js:78-79`). Der Befund bleibt gültig, nur anders benannt:
 *
 * 1. **Sichtbar stand gar nichts.** In der leeren Zelle gab es keine Aufforderung, nur ein
 *    Icon — dessen Trefffläche zudem kleiner ist als die eines Textziels.
 * 2. **Der Name sagt nicht, WAS.** „Bearbeiten" ist antds Vorgabe für jedes editierbare
 *    `Typography`; n Zeilen lieferten n gleichnamige Knöpfe — genau der Mangel, den die
 *    Bündelungs-Regel aus LFH-365 benennt. Deshalb trägt {@link BemerkungZelleProps.kennung}
 *    die Zeilenkennung in den Namen.
 * 3. **Die Affordanz war falsch herum verteilt.** Der LESEzweig hatte längst ein „—": wer
 *    nichts tun kann, sah einen Platzhalter; wer schreiben durfte, sah nichts.
 *
 * ── DREI AUFRUFER, NICHT FÜNF ──────────────────────────────────────────────────────────
 *
 * Das Ticket zählt fünf Aufrufer desselben Musters und leitet daraus das Primitiv ab. Die
 * zwei zusätzlichen sind `pages/gefahren/GefahrenPage.tsx:135` und
 * `pages/lagekarte/Sidebar.tsx:612` — gemessen hat BEI BEIDEN der Leerfall keinen sichtbaren
 * Zustand, aber aus zwei VERSCHIEDENEN Gründen, die nicht zusammenzuziehen sind:
 * `Sidebar.tsx:616` verwirft eine leere Eingabe selbst (`if (t && t !== b.name)`);
 * `GefahrenPage.tsx:135` tut das **nicht** — dort fängt erst die Anzeige es ab
 * (`api/gefahren.ts` `gefahrengebietName`: leeres Label → „Gefahrengebiet #<id>"). Beide sind
 * ein **Pflichtname**, der umbenannt wird (`trim`-Vergleich gegen den Altwert), keine
 * optionale Notiz — ein „hinzufügen"-Platzhalter hätte dort keinen Zustand, in dem er
 * erscheinen könnte. Nebenbei: beide tragen den Wertgleichheits-Riegel, den dieses Primitiv
 * anfangs vermissen ließ (siehe `onChange` unten).
 *
 * Sie bleiben deshalb draußen; das Primitiv trägt die drei Stellen mit einer OPTIONALEN Notiz.
 *
 * Seit LFH-613 ein vierter Aufrufer mit anderem WORT: der „Zustand" einer betroffenen Person
 * (`personen/personenSpalten.tsx`) ist dieselbe optionale Kurznotiz, also dieselbe Affordanz.
 * {@link BemerkungZelleProps.bezeichnung} tauscht nur das Wort („Zustand hinzufügen"), die
 * Mechanik bleibt eine.
 *
 * ── WARUM EIN ECHTER `Button` UND KEIN GESTYLTES `<span onClick>` ───────────────────────
 *
 * Ein handgebautes Bedienziel bräuchte nach der Festlegung aus LFH-365 ZWEI Angaben
 * (`minHeight: token.controlHeight` PLUS Polsterung aus `token.paddingSM`/`token.padding`)
 * und eine Zusicherung über zwei Dichtestufen, weil kein Guard eine Pixelangabe sieht. Ein
 * antd-`Button` erbt seine Höhe stattdessen vom `ConfigProvider` und schuldet nichts davon.
 * `type="link"` liefert zugleich die Bedienfarbe aus dem Token (`colorLink`, blau) statt
 * eines Hex-Literals — „Rot bedient nichts" (LFH-352/LFH-315).
 *
 * ── DER GEFÜLLTE WERT IST SELBST DAS ZIEL (LFH-650) ────────────────────────────────────
 *
 * Bis LFH-650 war das Bedienziel am gefüllten Wert antds Stift aus `Typography editable` —
 * ein Ikonknopf, dessen Fläche keine Dichtestufe kannte, und der Wert daneben blanker Text.
 * Zwei Befunde der LFH-613-Prüfliste hingen daran: der Stift blieb in jeder Stufe klein
 * (Gate 3, Nr. 1 · 2), und die Zeile SCHRUMPFTE nach dem ersten Speichern, weil der
 * Platzhalter-Knopf (`controlHeight`, in `handschuh` 72 px) blankem Text wich (Nr. 12).
 *
 * Jetzt ist der Wert ein `Button type="text"` mit Stift-Ikone: dieselbe Bauform wie der
 * Platzhalter, also dieselbe Höhe in beiden Zuständen und die ganze Zelle als Trefffläche.
 * `type="text"` statt `link`, weil der Wert Inhalt ist und in der Textfarbe steht — blau
 * gesetzt läse er sich als Verweis. Der Knopf darf umbrechen (lange Bemerkungen der
 * Kräfte-Listen), deshalb `height: auto` — und damit schuldet er die ZWEI Angaben eines
 * handgebauten Bedienziels (LFH-365): {@link wertKnopfStil}, rein und exportiert.
 *
 * Der zugängliche NAME bleibt die Aufforderung („Zustand zu R-042 bearbeiten") und der
 * Wert wird zur BESCHREIBUNG (`aria-describedby`): ein `aria-label` verdeckt den Inhalt,
 * ohne die Beschreibung hörte man in der Zelle nur noch „bearbeiten".
 */

/**
 * Stil des gefüllten Wertknopfs. Rein, damit die Zusicherung über zwei Dichtestufen ohne
 * Rendern prüfbar ist (Muster `bedienzielStil`): `minHeight` aus `controlHeight` trägt den
 * Boden, die Polsterung den Abstand des umbrechenden Textes zum Rand.
 */
export function wertKnopfStil(token: {
  controlHeight: number;
  paddingXS: number;
}): CSSProperties {
  return {
    height: 'auto',
    minHeight: token.controlHeight,
    paddingBlock: token.paddingXS,
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
   * Aktueller Wert. `null`/`undefined`/`''` = leer, dann erscheint der Platzhalter.
   *
   * `undefined` steht mit im Typ, weil es aus dem Wire wirklich vorkommt: die generierten
   * Response-Typen führen `bemerkung?: string | null`, seit die Norm aus LFH-265 leere
   * `Option`-Felder per `skip_serializing_if` weglässt. Der Client kann „fehlt" und „ist
   * null" also unterscheiden — für die Anzeige sind beide dasselbe Nichts.
   */
  wert: string | null | undefined;
  /** Ohne Schreibrecht bleibt die Zelle reine Anzeige. */
  darfSchreiben: boolean;
  /**
   * Übernahme des neuen Wertes.
   *
   * Absichtlich NUR der Wert: die drei Seiten schließen über ihre eigene Kennung
   * (`efId`/`epId`/`emId`) und ihre eigene Mutation. Eine gemeinsame Id-Gestalt zu erfinden
   * hätte drei Aufrufer verbogen, um einem Primitiv Arbeit abzunehmen, die es nicht hat.
   */
  onSpeichern: (wert: string) => void;
  /**
   * Menschenlesbare Zeilenkennung (Funkrufname, Name, Bezeichnung) für den zugänglichen
   * Namen. Ohne sie liefern n Zeilen n gleichnamige Knöpfe — dieselbe Begründung wie bei der
   * Aktionsbündelung aus LFH-365, und hier besonders spürbar: auf der Materialseite steht die
   * Bemerkungsspalte per Voreinstellung sichtbar.
   *
   * Optional, damit ein Einzelgebrauch außerhalb einer Liste nicht gezwungen ist, eine
   * Kennung zu erfinden.
   */
  kennung?: string;
  /**
   * Das Wort für das Feld in Platzhalter und zugänglichem Namen („Zustand hinzufügen",
   * „Zustand zu R-042 bearbeiten"). Vorgabe „Bemerkung".
   */
  bezeichnung?: string;
  /**
   * Ein Schreibvorgang läuft (LFH-650). Der Aufrufer reicht dann den NEUEN Wert als `wert`
   * — die Zelle zeigt ihn sofort mit Ladeanzeige, statt bis zur Serverantwort den alten
   * Stand oder den Platzhalter zu zeigen (vorher wirkte die Eingabe verworfen).
   */
  laeuft?: boolean;
}

/** Wortlaut an EINER Stelle — drei Seiten und ihre drei Tests greifen denselben Namen.
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
  const { token } = theme.useToken();
  const wertId = useId();
  // EIN Ref für beide Knöpfe: Platzhalter und Wertknopf stehen nie gleichzeitig im Baum.
  const knopfRef = useRef<HTMLButtonElement>(null);
  const fokusZurueck = useRef(false);
  const gefuellt = !!wert;

  /**
   * Fokusrückgabe nach dem Verlassen der Bearbeitung.
   *
   * antd stellt sie selbst her, aber nur auf seinen EIGENEN Stift (`Base/index.js:90-95`) und
   * nur, solange `Typography.Text` am Baum bleibt. Hier bleibt es das nie — seit LFH-650
   * steht `Typography` nur noch WÄHREND der Bearbeitung im Baum, außerhalb trägt ein
   * eigener Knopf. Beide Fälle sind gemessen, und der zweite ist der, den der Betrieb nimmt:
   *
   * 1. **Abbrechen / leer geblieben:** `Typography` hängt in derselben Runde aus, in der der
   *    Platzhalter zurückkommt. antds Effekt läuft für diesen Wert nie.
   * 2. **Gespeichert, Wert kommt NACH:** die Mutation läuft, der neue Wert trifft per
   *    Invalidierung erst eine Runde später ein. Dann hängt der Platzhalter aus und ein
   *    FRISCHES `Typography` ein — das kein `prevEditing` hat, also auch nicht fokussiert.
   *
   * In beiden Fällen landet der Fokus sonst auf `<body>`; genau diese Klasse führt die
   * Erfassungs-Norm schon. Deshalb ein Merker, der den Zweigwechsel ÜBERLEBT, statt einer
   * Flanke auf `bearbeitet` — die ist beim Nachlauf längst vorbei.
   *
   * Ohne Deps-Array: der Effekt muss auch in der Runde laufen, in der sich nur `wert` ändert.
   * Eingegriffen wird NUR bei verwaistem Fokus (`activeElement === body`) — sonst risse man
   * ihn einem Element weg, das die bedienende Person selbst angesteuert hat; sitzt er
   * woanders, ist die Rückgabe erledigt und der Merker fällt.
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
   * Lesezweig unverändert bei „—" — keine Nachlässigkeit, sondern die Aussage: ohne
   * Schreibrecht gibt es keine Aktion, ein „Bemerkung hinzufügen" wäre eine Aufforderung ins
   * Leere. Das Ticket verlangt, den Lesezweig „konsistent zu halten"; eingelöst wird das als
   * **gleiche Bedeutung des Leerzustands** (beide Zweige sagen „hier steht nichts"), nicht als
   * gleicher Wortlaut.
   *
   * Was hier ausdrücklich NICHT behauptet wird, ist gleiche Zeilenhöhe ZWISCHEN Lese- und
   * Schreibzweig: der Lesezweig gibt blanken Text zurück, der Schreibzweig einen `Button` mit
   * `controlHeight` — die sind nicht gleich hoch. INNERHALB des Schreibzweigs sind leer und
   * gefüllt seit LFH-650 gleich hoch (beide Knöpfe), gemessen in
   * `e2e/gate3-trefflaeche.spec.ts`.
   */
  if (!darfSchreiben) return <>{wert || '—'}</>;

  if (!bearbeitet && !gefuellt) {
    return (
      <Button
        ref={knopfRef}
        type="link"
        loading={laeuft}
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
        // `loading` sperrt zugleich den zweiten Klick, solange der erste noch schreibt, und
        // ersetzt die Stift-Ikone durch antds Ladeanzeige — der neue Wert steht schon da.
        loading={laeuft}
        aria-label={kennung ? `${bezeichnung} zu ${kennung} bearbeiten` : `${bezeichnung} bearbeiten`}
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
          // antd vergleicht NICHT — `onChange` feuert beim Verlassen unbedingt. Ohne diesen
          // Riegel kostete ein Klick auf den Platzhalter und ein Klick daneben ein PATCH mit
          // leerem Wert, samt Invalidierung und Live-Ereignis an alle Verbundenen.
          if (val !== (wert ?? '')) onSpeichern(val);
        },
        onCancel: () => setBearbeitet(false),
      }}
    >
      {wert ?? ''}
    </Typography.Text>
  );
}
