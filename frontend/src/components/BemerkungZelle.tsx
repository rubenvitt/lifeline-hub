import { useState } from 'react';
import { Button, Typography } from 'antd';

/**
 * Inline bearbeitbare Bemerkung — mit sichtbarer Affordanz im LEEREN Zustand (LFH-369 · B5i).
 *
 * ── WARUM DIESES PRIMITIV ──────────────────────────────────────────────────────────────
 *
 * Befund M21: `FahrzeugePage`, `PersonalPage` und `MaterialPage` trugen drei zeichengleiche
 * Kopien von `Typography.Text editable` mit `{x.bemerkung ?? ''}` als Kind. Bei leerer
 * Bemerkung blieb davon genau das Stift-Icon übrig — als `<button>` ohne Textinhalt, also
 * ohne zugänglichen Namen (gemessen an `82c2885`: `getByRole('button', { name: … })` fand
 * nichts, nur ein nacktes `<svg>`). Der LESEzweig hatte dagegen längst ein „—": die
 * Affordanz war genau falsch herum verteilt — wer nichts tun kann, sah einen Platzhalter;
 * wer schreiben durfte, sah nichts.
 *
 * ── DREI AUFRUFER, NICHT FÜNF ──────────────────────────────────────────────────────────
 *
 * Das Ticket zählt fünf Aufrufer desselben Musters und leitet daraus das Primitiv ab. Die
 * zwei zusätzlichen sind `gefahren/GefahrenPage.tsx:135` und `lagekarte/Sidebar.tsx:532` —
 * gemessen haben BEIDE keinen Leerfall: dort wird ein **Pflichtname umbenannt**
 * (`gefahrengebietName(label, id)` liefert immer einen Fallback, `b.name` ist gesetzt), mit
 * `trim`-Vergleich gegen den Altwert und Verwerfen bei leerer Eingabe. Ein „hinzufügen"-
 * Platzhalter hätte dort keinen Zustand, in dem er erscheinen könnte. Sie bleiben deshalb
 * draußen; das Primitiv trägt die drei Stellen mit einer OPTIONALEN Notiz.
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
}

/** Wortlaut an EINER Stelle — drei Seiten und ihre drei Tests greifen denselben Namen. */
export const BEMERKUNG_HINZUFUEGEN = 'Bemerkung hinzufügen';

export function BemerkungZelle({ wert, darfSchreiben, onSpeichern }: BemerkungZelleProps) {
  const [bearbeitet, setBearbeitet] = useState(false);
  const gefuellt = !!wert;

  /**
   * Lesezweig unverändert bei „—" — und das ist keine Nachlässigkeit, sondern die Aussage:
   * ohne Schreibrecht gibt es keine Aktion, ein „Bemerkung hinzufügen" wäre eine falsche
   * Affordanz. „Konsistent" heißt hier gleiche Zeilenhöhe und Typografie, nicht gleicher
   * Wortlaut — und die trägt das Primitiv, weil beide Zweige durch dieselbe Datei laufen.
   */
  if (!darfSchreiben) return <>{wert || '—'}</>;

  if (!gefuellt && !bearbeitet) {
    return (
      <Button type="link" onClick={() => setBearbeitet(true)}>
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
        onChange: (val) => {
          setBearbeitet(false);
          onSpeichern(val);
        },
        onCancel: () => setBearbeitet(false),
      }}
    >
      {wert ?? ''}
    </Typography.Text>
  );
}
