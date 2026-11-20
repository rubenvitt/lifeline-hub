# Pflichtfeld-Fehler ins Bild holen; eigene Stelle in der Meldung vorbelegen (LLH-1759)

Zunder: https://zunder.rubeen.dev/#/aufgabe/xqrd448ygruaijmom9oz49xe

Kleine Änderung, kurzes Design-Doc. Route `entwurf` wegen E2: die Erfassungs-Norm
(`frontend/AGENTS.md`) bekommt eine neue Regel für alle Erfassungsformulare.

## Absicht

Am Handy stehen nach „Meldung erfassen“ ohne Absender die Fehler „Absender ist erforderlich“ und
„Inhalt ist erforderlich“ über dem sichtbaren Bereich; es wird nicht gerollt, der Knopf wirkt tot.
Wer im Einsatz eine Meldung festhält, muss sofort sehen, was fehlt. Dazu tippt er die eigene
Stelle bisher jedes Mal, während das ETB sie aus dem Standard-Rufnamen vorbelegt.

## Ursache

- `components/Erfassung.tsx` setzt weder `scrollToFirstError` noch rollt es selbst; `onFinishFailed`
  meldet nur an `onPruefungGescheitert`.
- `meldungen/MeldungFormular.tsx` startet mit leerem Absender und Empfänger; der Standard-Rufname
  (`etb/useStandardRufname.ts`) wird außerhalb des ETB nicht gelesen.

## Ziele

1. **Jedes Erfassungsformular** (Hülle `ErfassungsFormular`, also auch `ErfassungsModal`) rollt bei
   gescheiterter Prüfung zum ersten fehlerhaften Feld (Mitte des Sichtbereichs) und setzt den Fokus
   hinein.
2. **Am Knopf steht, was fehlt:** eine Zeile in der Aktionszeile, in Alarmfarbe und als Wort, mit
   den Fehlertexten der Prüfung („Inhalt ist erforderlich · Absender ist erforderlich“). Der
   Primärknopf trägt sie als Beschreibung (`aria-describedby`), die Zeile ist `aria-live`. Sie
   verschwindet, sobald keine Feldfehler mehr stehen (Eingabe korrigiert) sowie beim Zurücksetzen
   (Erfassen, Abbrechen).
3. **Meldung: eigene Stelle vorbelegen wie im ETB** (Vorgabe je Art, wie `VORGABE_JE_TYP`): eine
   Meldung kommt meist von außen, also **Empfänger = eigene Stelle** (`standard.an`); bei der Art
   **Lagemeldung** (Seite Lagemeldungen, Fast-Path „Lagemeldung an übergeordnete Stelle“, Wahl der
   Art) geht sie von der eigenen Stelle aus, also **Absender = eigene Stelle** (`standard.von`).

## Nicht-Ziele

- Keine Abfrage des Standard-Rufnamens im Meldungsformular. Fehlt er, bleibt alles leer wie bisher;
  gesetzt wird er weiter im ETB (`etb/RufnameAbfrage.tsx`).
- Keine Änderung an Feldregeln, Feldbudget oder Server.
- Die Schnellerfassung im ETB (`etb/Schnellerfassung.tsx`, keine Hülle) bleibt unberührt.

## Anti-Ziele

- Eine Vorgabe überschreibt nie, was jemand eingetragen oder angefasst hat.
- Kein Toast, kein Modal für die Fehler (`frontend/AGENTS.md`, „Rückwege und Fehler“).

## Ansätze

- **Gewählt: in der Hülle.** Rollen, Fokus und Fehlerzeile in `ErfassungsFormular`; jedes Formular
  bekommt es ohne eigenen Code. Regel als Zeile in der Erfassungs-Norm.
- Verworfen: nur im Meldungsformular. Billiger, aber jedes andere Formular am Handy behielte das
  Problem; die Hülle ist genau dafür da.
- Verworfen bei der Vorbelegung: Absender immer (Wortlaut des Auftrags). Bei hereinkommenden
  Funkmeldungen stünde still die eigene Stelle als Absender — ein falscher Datensatz, der nicht
  auffällt. Entschieden mit dem Menschen am 20.11.2026: Vorgabe nach Art wie im ETB.

## Entscheidungen zur Form

- **Rollen nach dem Aufklappen:** antds `scrollToFirstError` liefe vor `onPruefungGescheitert`; ein
  Feld im eingeklappten Teil (`MeldungFormular`, `forceRender`) wäre dann noch unsichtbar. Die Hülle
  rollt deshalb selbst: erst `onPruefungGescheitert`, dann im nächsten Frame
  `form.scrollToField(erstes, { block: 'center', focus: true })`.
- **Vorgabe statt Startwert:** wie die S2-Empfängerfunktion (`MeldungFormular`, LLH-1062) setzt ein
  Effekt den Wert, solange das Feld leer und nicht angefasst ist; ein Wechsel der Art tauscht nur
  eine Vorgabe, die noch unverändert dasteht (Absender bzw. Empfänger wird geleert, wenn er genau der
  vorbelegten eigenen Stelle entspricht und unangefasst ist). Nach dem Zurücksetzen greift die
  Vorgabe wieder. „Werte behalten“ übernimmt weiter Absender und Empfänger.
- **Woher der Standard kommt:** `MeldungFormular` bekommt eine Prop `eigeneStelle?: StandardRufname
  | null`; die Seiten (`MeldungenPage`, `LagemeldungenPage`) lesen `useStandardRufname()`. Das
  Formular bleibt ohne Netz-Hook testbar.

## Dem Bauenden überlassen

- Genaue Gestaltung der Fehlerzeile innerhalb der Gestaltungssprache (Platz neben bzw. über den
  Knöpfen wie `zusammenfassung`; beides kann zugleich stehen).
- Tests: Hülle (Rollen/Fokus aufs erste Fehlerfeld, Zeile erscheint und verschwindet), Meldung
  (Vorgabe je Art, angefasste Felder bleiben, Reset stellt Vorgabe wieder her).
