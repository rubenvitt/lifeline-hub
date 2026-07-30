import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Typography } from 'antd';

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
 * `pages/lagekarte/Sidebar.tsx:532` — gemessen hat BEI BEIDEN der Leerfall keinen sichtbaren
 * Zustand, aber aus zwei VERSCHIEDENEN Gründen, die nicht zusammenzuziehen sind:
 * `Sidebar.tsx:536` verwirft eine leere Eingabe selbst (`if (t && t !== b.name)`);
 * `GefahrenPage.tsx:135` tut das **nicht** — dort fängt erst die Anzeige es ab
 * (`api/gefahren.ts` `gefahrengebietName`: leeres Label → „Gefahrengebiet #<id>"). Beide sind
 * ein **Pflichtname**, der umbenannt wird (`trim`-Vergleich gegen den Altwert), keine
 * optionale Notiz — ein „hinzufügen"-Platzhalter hätte dort keinen Zustand, in dem er
 * erscheinen könnte. Nebenbei: beide tragen den Wertgleichheits-Riegel, den dieses Primitiv
 * anfangs vermissen ließ (siehe `onChange` unten).
 *
 * Sie bleiben deshalb draußen; das Primitiv trägt die drei Stellen mit einer OPTIONALEN Notiz.
 *
 * ── WARUM EIN ECHTER `Button` UND KEIN GESTYLTES `<span onClick>` ───────────────────────
 *
 * Ein handgebautes Bedienziel bräuchte nach der Festlegung aus LFH-365 ZWEI Angaben
 * (`minHeight: token.controlHeight` PLUS Polsterung aus `token.paddingSM`/`token.padding`)
 * und eine Zusicherung über zwei Dichtestufen, weil kein Guard eine Pixelangabe sieht. Ein
 * antd-`Button` erbt seine Höhe stattdessen vom `ConfigProvider` und schuldet nichts davon.
 * `type="link"` liefert zugleich die Bedienfarbe aus dem Token (`colorLink`, blau) statt
 * eines Hex-Literals — „Rot bedient nichts" (LFH-352/LFH-315).
 */
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
}

/** Wortlaut an EINER Stelle — drei Seiten und ihre drei Tests greifen denselben Namen. */
export const BEMERKUNG_HINZUFUEGEN = 'Bemerkung hinzufügen';

export function BemerkungZelle({ wert, darfSchreiben, onSpeichern, kennung }: BemerkungZelleProps) {
  const [bearbeitet, setBearbeitet] = useState(false);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const warBearbeitet = useRef(false);
  const gefuellt = !!wert;

  /**
   * Fokusrückgabe auf den Platzhalter.
   *
   * antd stellt den Fokus beim Verlassen selbst her, aber nur auf seinen EIGENEN Stift
   * (`Base/index.js:90-95`). Solange der Wert gefüllt ist, greift das: `Typography.Text`
   * bleibt am Baum, der Effekt sieht `prevEditing` und fokussiert. Auf dem LEEREN Zweig
   * hängt es in derselben Runde aus, in der `bearbeitet` auf `false` fällt — der Effekt
   * läuft für diesen Wert nie und der Fokus fällt auf `<body>` (gemessen). Genau diese
   * Klasse führt die Erfassungs-Norm schon.
   *
   * `useLayoutEffect` wie antd: vor dem Anstrich, damit der Fokus nicht sichtbar springt.
   */
  useLayoutEffect(() => {
    if (warBearbeitet.current && !bearbeitet && !gefuellt) knopfRef.current?.focus();
    warBearbeitet.current = bearbeitet;
  }, [bearbeitet, gefuellt]);

  /**
   * Lesezweig unverändert bei „—" — keine Nachlässigkeit, sondern die Aussage: ohne
   * Schreibrecht gibt es keine Aktion, ein „Bemerkung hinzufügen" wäre eine Aufforderung ins
   * Leere. Das Ticket verlangt, den Lesezweig „konsistent zu halten"; eingelöst wird das als
   * **gleiche Bedeutung des Leerzustands** (beide Zweige sagen „hier steht nichts"), nicht als
   * gleicher Wortlaut.
   *
   * Was hier ausdrücklich NICHT behauptet wird, ist gleiche Zeilenhöhe: der Lesezweig gibt
   * blanken Text zurück, der Schreibzweig einen `Button` mit `controlHeight` und Polsterung —
   * die sind nicht gleich hoch, und dass beide durch dieselbe Datei laufen, ändert daran
   * nichts. jsdom rechnet ohnehin kein Layout; wer die Höhen angleichen will, braucht eine
   * e2e-Messung und eine eigene Entscheidung.
   */
  if (!darfSchreiben) return <>{wert || '—'}</>;

  if (!gefuellt && !bearbeitet) {
    return (
      <Button
        ref={knopfRef}
        type="link"
        // Sichtbar bleibt der kurze Text, der Name trägt die Zeile — sonst wird die Spalte
        // so breit wie die längste Kennung.
        aria-label={kennung ? `Bemerkung zu ${kennung} hinzufügen` : undefined}
        onClick={() => setBearbeitet(true)}
      >
        {BEMERKUNG_HINZUFUEGEN}
      </Button>
    );
  }

  return (
    <Typography.Text
      editable={{
        // `editing` KONTROLLIERT: nur so kann der Platzhalter-Knopf die Bearbeitung von
        // außen öffnen. Dann muss `onStart` mitgeführt werden, sonst öffnet der Stift am
        // gefüllten Wert nicht mehr — antd ruft im kontrollierten Fall nur noch diesen Weg.
        editing: bearbeitet,
        onStart: () => setBearbeitet(true),
        // `tooltip` ist zugleich der zugängliche Name des Stifts (`Base/index.js:271-283`:
        // `aria-label` kommt aus `tooltip` oder, ohne eins, aus antds Locale-Vorgabe
        // „Bearbeiten"). Ohne Kennung bleibt es bei der Vorgabe.
        tooltip: kennung ? `Bemerkung zu ${kennung} bearbeiten` : undefined,
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
