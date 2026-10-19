# Design

## Context

- **Baustein:** `kraefte/MaterialAmOrt.tsx` zeichnet die Zeilen aus `posten` des Aufrufers (Einheit
  aus dem Einheit-DTO, UHS und Bereitstellungsraum aus dem Detail, Fahrzeug aus der Materialliste).
  Das Lösen läuft über `useMaterialOrt().setOrt(…, null)`. Der Knopf zeigt `loading`, bis die
  Mutation fertig ist; antd nimmt in dieser Zeit keinen Klick an. `setOrt` wartet nur auf die
  Materialliste. Einheit-DTO und Details gleichen ohne Warten ab. Deshalb verschwindet die Zeile an
  der Einheit oft erst nach dem Ende der Mutation, und ihr Knopf ist dann einen Moment wieder
  bedienbar.
- **Sprung:** Fehlt die Zeile, rückt die nächste um eine Zeilenhöhe nach oben. Ihr Lösen-Knopf liegt
  rechtsbündig an derselben Stelle (Prüfliste LLH-1225, Teil II, Kriterium 12).
- **Muster im Haus:** Die Zuflussschleuse (`components/useZuflussSchleuse.ts`,
  `components/organigramm/baumSchleuse.ts`, LFH-1020/LFH-867) hält nur **Zuwachs** zurück.
  Entfallenes fällt dort ausdrücklich sofort weg (`flachZufluss`). Der Rückgängig-Hinweis
  `kommunikation/rueckgaengig.tsx` gilt nach einer Nutzeraktion mit serverseitigem Rückweg
  (`frontend/AGENTS.md`, „Rückwege und Fehler“). Den Rückweg gibt es: Wieder-Zuordnen ist derselbe
  PATCH der Disposition.

## Goals / Non-Goals

**Goals:** Nach dem eigenen Lösen springt nichts unter Finger, Zeiger oder Fokus, und zwar an allen
vier Orten über den einen Baustein. Ein Fehlgriff lässt sich zurücknehmen.

**Non-Goals:**
- Posten, die **andere** live entfernen oder umhängen. Sie fallen weiter sofort weg, wie Entfallenes
  in der Schleuse. Wer das ändern will, braucht eine eigene Change für `datensicht-zufluss`.
- Zuordnen aus der Auswahl. Der neue Posten erscheint wie bisher am Ende und verschiebt nichts über
  dem Zeiger.
- Andere Listen mit Entfernen-Knopf (Personal, Fahrzeuge an der Einheit). Bewährt sich das Muster,
  kann es eine Folgeaufgabe dorthin heben.

## Decisions

1. **Gelöste Zeile bleibt als Platzhalter (Weg A).** Nach dem Erfolg merkt sich der Baustein den
   Posten mit seinem Stand und seiner Stelle in der Liste. Er zeichnet dort eine gedämpfte Zeile in
   gleicher Höhe: Bezeichnung und Menge bleiben, Status und „Ausgeben“ entfallen. Rechts steht statt
   des Knopfs die Marke „Gelöst“.
   - **Verworfen B, Zuflussschleuse:** Sie hält per Spec nur Zuwachs. Hielte sie auch Entfallenes,
     würde sie die Regel aller `Datensicht`-Listen ändern, und das gehört nicht in diesen Task.
   - **Verworfen C, Zeitsperre aller Lösen-Knöpfe nach dem Wegfall:** Sie verhindert den
     Fehlklick, aber die Zeile springt weiter unter den Zeiger. Kriterium 12 bliebe offen, und die
     Regel „Live-Updates springen nicht unter dem Cursor“ (`frontend/AGENTS.md`, „Layout und Live“)
     ebenso.
   - **Verworfen: „Rückgängig“ an der Stelle des Knopfs.** Ein Doppeltipp würde dann lösen und
     sofort zurücknehmen, ein überraschendes Ergebnis.
2. **Marke ist ein träger Knopf in der Breite des Lösen-Knopfs.** Die Marke bleibt ein `Button` mit
   `aria-disabled` (nicht `disabled`), der Name lautet „Trage gelöst“, und ein Klick tut nichts. Der
   Fokus bleibt also auf ihm, wenn jemand per Tastatur gelöst hat, und Enter-Wiederholung löst
   nichts. Beide Wörter, `loesenText` und „Gelöst“, stehen übereinander im selben Gitterfeld, nur
   eines davon sichtbar. So ist die Marke nie schmaler als der Knopf, und keine Stelle des alten
   Knopfs trifft etwas anderes.
3. **Wann der Platzhalter fällt.** Alle Platzhalter fallen **zusammen** weg, sobald drei Dinge
   gelten: Kein Maus- oder Stiftzeiger steht über dem Baustein (`pointerenter`/`pointerleave`,
   Touch-Zeiger zählen nicht, denn sie verlassen das Element nach jedem Tipp), kein Fokus liegt im
   Baustein (`focusin`/`focusout`, Portal-Menüs wie bei `checkVerlassen`), und seit dem letzten
   `pointerdown` im Baustein sind `HALTEN_MS` = 4000 ms vergangen. Auf dem Touchgerät hält also die
   Zeit, an der Maus der Zeiger, an der Tastatur der Fokus. Einzeln wegfallende Platzhalter würden
   wieder springen.
4. **Daten gegen Platzhalter.** Je Posten gibt es zwei Phasen. `wartet`: Die Quelle zeigt den Posten
   noch (Einheit-DTO noch nicht abgeglichen), und trotzdem steht der Platzhalter. So wird der Knopf
   nicht noch einmal bedienbar. `weg`: Die Quelle zeigt ihn nicht mehr. Taucht der Posten in der
   Phase `weg` wieder auf (Rückgängig oder jemand anderes ordnet ihn zu), gewinnt die echte Zeile,
   und der Platzhalter entfällt. Die Stelle merkt sich der Baustein als Index in der zuletzt
   gezeichneten Folge. Eingefügt wird aufsteigend, sodass mehrere Platzhalter ihre Plätze behalten.
5. **Rückgängig über den Hinweis des Hauses.** `onSuccess` ruft `zeigeRueckgaengig(message,
   "Trage gelöst", …)` statt `message.success`. „Rückgängig“ ruft `setOrt(posten, ort)` und
   gleicht ab. Scheitert das, steht der Grund an der Zeile, solange der Platzhalter steht, sonst am
   Zuordnen-Fehler des Bausteins. Der Hinweis liegt oben im Bild, weit weg vom Zeiger.
6. **Kein neuer Baustein, kein Hook nach außen.** Die Logik bleibt in `MaterialAmOrt.tsx`, als
   kleiner lokaler Hook in derselben Datei (`useGeloestHalten`). Eine zweite Verwendung gibt es noch
   nicht (Non-Goal 3).

## Risks / Trade-offs

- [Platzhalter bleibt an der Maus lange stehen] → Gewollt: Solange der Zeiger im Baustein steht,
  springt nichts. Die Marke ist gedämpft und eindeutig. Die Kopfzahl zählt nur echte Posten.
- [Ablehnung nach dem Erfolg ist nicht möglich] → Der Platzhalter entsteht erst in `onSuccess`. Eine
  Ablehnung lässt die Zeile mit Knopf und Grund stehen wie bisher.
- [Timer in Tests] → Unit-Tests mit `vi.useFakeTimers({ shouldAdvanceTime: true })`. Der e2e-Test
  prüft nur den Doppelklick und das Ergebnis am Server, keine Wartezeit.
- [Wechsel von Einsatz oder Ort] → Der Zustand hängt am Baustein. Ein neuer `ort` oder `einsatzId`
  leert die Platzhalter.
