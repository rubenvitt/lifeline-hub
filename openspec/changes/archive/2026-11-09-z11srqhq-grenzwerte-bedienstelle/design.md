## Context

Der Server ist vollständig (LLH-1552, LLH-730):

- `PATCH /api/einsaetze/{id}/abloesungen/schichtplan/grenzwerte` nimmt die Felder `max_dienst_minuten` und `min_ruhe_minuten` als Tri-State an: fehlt = unverändert, `null` = Vorgabe. Die Bereiche sind 60–1440 und 0–1440 (`MAX_DIENST_BEREICH`, `MIN_RUHE_BEREICH`), sonst 400. Der Aufruf verlangt `EinsatzSchreibzugriff<Abloesung>`.
- Ein wirksamer PATCH schreibt einen ETB-Systemsatz und meldet `abloesung`, `einheit` und `personal`. Ein PATCH ohne Änderung schreibt und meldet nichts.
- Die Antwort ist der ganze Plan (`Schichtplan`), mit `grenzwerte: SchichtplanGrenzwerte`. Das DTO trägt die wirksamen Minuten und die Merker `max_dienst_eigen` und `min_ruhe_eigen`.
- Im Client heißt der Aufruf `api/schichtplan.ts:setzeSchichtplanGrenzwerte`, bisher ohne Aufrufer. Der Plan liegt unter `einsatzKeys.schichtplan(id)`, die Grenzwerte der Einstufung liegen unter `kraefteZeitachseGrenzwerte(id, 'einheiten'|'personal')`. Das Live-Ereignis `abloesung` trifft beide Prefixe (`queryKeys.ts`, `abloesung: [abloesungen, kraefteZeitachse]`).

Die Wahl des Orts, der Leseweg und das Zurücksetzen sind mit dem Menschen abgestimmt (Zunder LLH-1603, 08.11.2026).

## Goals / Non-Goals

**Goals:**

- Eine einzige Bedienstelle für beide Grenzwerte, dazu eine Lesezeile dort, wo der Befund erscheint.
- Die Kennzeichnung „(Vorgabe)“ folgt aus den Merkern `*_eigen` des Servers und wird nie aus dem Wert geraten.

**Non-Goals:**

- Keine neue Route und kein neuer Typ im Codegen. Ein schmaler GET nur für die Grenzwerte wurde abgewogen und verworfen (D2).
- Keine Grenzwerte je Abschnitt oder je Einheit und keine Vorgabe der Organisation. Die Vorgaben 12 h und 8 h bleiben fest im Server.
- Keine Änderung an Einstufung, Befund oder Trennregel.

## Decisions

**D1 Ort: Einstellungen › Ablösung, Paneel „Dienst und Ruhe“. Der Schichtplan bekommt nur eine Lesezeile.**
Die Werte sind eine Einstellung des Einsatzes und wirken über den Plan hinaus in Meldebild und Personalliste. Neben „Schichtmodell des Einsatzes“ stehen sie bei der anderen Vorgabe des Einsatzes für die Ablösung, mit denselben Rechten und derselben Sperre bei fehlender Modulfreigabe. Im Plan sieht man trotzdem, wogegen „zu lange im Dienst“ prüft, ohne die Seite zu wechseln.
Verworfen: die Bedienung nur im Schichtplan (eine Einsatz-Einstellung läge dann in einer Planungsansicht), die Bedienung nur in den Einstellungen (der Plan zeigte seine Prüfgrundlage nicht) und zwei Bedienstellen (zwei Schreibwege für denselben Wert).

**D2 Lesen über den Schichtplan-GET, Key `schichtplan`.**
Das Paneel liest `fetchSchichtplan` unter `einsatzKeys.schichtplan(id)`, denselben Key wie die Ablösung. Es nimmt nur `grenzwerte`. Die Antwort des PATCH ersetzt diesen Cache (`setQueryData`). Live kommt der Wert über `abloesung`, und die Modulsperre gilt wie für den Schreibweg (Modul Ablösung).
Verworfen: ein neuer `GET …/schichtplan/grenzwerte`. Er wäre leichter, bräuchte aber Backend, Route, Wächter und Codegen für vier Felder, die der Plan schon trägt. Ebenfalls verworfen sind die Lese-Endpunkte der Zeitachse (`…/{einheiten,personal}/zeitachse/grenzwerte`): Sie hängen an anderen Modulen, und die Projektregel lässt sie nur für die Einstufung zu.

**D3 Nach dem Speichern: Plan ersetzen, Einstufung neu holen.**
`onSuccess` setzt den Plan aus der Antwort und invalidiert `kraefteZeitachseGrenzwerte(id, 'einheiten')` und `…('personal')`. So sehen die eigenen offenen Seiten den Wert sofort, auch wenn Live gerade fehlt. Die anderen Sitzungen erreicht er über die Live-Ereignisse, die der Server schon sendet.

**D4 Dialog statt Inline-Formular. Leeres Feld heißt Vorgabe. Gesendet wird nur, was sich geändert hat.**
„Werte ändern“ öffnet ein `ErfassungsModal` mit zwei Textfeldern, „Höchstdienst“ und „Mindestruhe“. So arbeitet auch „Werte ändern“ am Schichtmodell (`SchichtmodellModal`). Die Felder sind mit dem eigenen Wert in Dauerform vorbelegt (`dauerFeldText`). Gilt die Vorgabe, bleibt das Feld leer, und der Platzhalter nennt sie (`mitVorgabe(formatDauer(720))` → „12 h (Vorgabe)“). Geprüft wird mit `dauerRegel` ohne Pflicht: Höchstdienst 60–1440, Mindestruhe 0–1440.
Der Body trägt nur Felder, deren Bedeutung sich geändert hat (eigener Wert ↔ Vorgabe, oder ein anderer eigener Wert). Ein leeres Feld wird `null`, und ein unverändertes Feld fehlt im Body. Damit überschreibt der Dialog nie einen Wert, den jemand anderes gerade gesetzt hat. Ändert sich gar nichts, schließt der Dialog ohne Aufruf. Diese Rechnung steht als reine Funktion in `abloesung/grenzwerte.ts` und ist getestet.
Mindestruhe 0 ist erlaubt und erscheint als „0 min“. So zeigt `formatDauer` die Null schon heute, und die Bedeutung (keine Ruhe nötig) erklärt die Doku.

**D5 „Vorgaben wiederherstellen“ ohne Rückfrage, mit Rückgängig.**
Der Knopf steht nur, solange mindestens ein Merker `*_eigen` gilt. Er sendet `null` für jeden eigenen Wert. Der Rückgängig-Toast (`zeigeRueckgaengig`) sendet die alten Minuten zurück. Das Muster entspricht „Vorgabe entfernen“ am Schichtmodell (LFH-343/LFH-363): Die Handlung ist umkehrbar, deshalb gibt es keine Rückfrage. Der Fehler steht über dem Paneel (`SeitenHinweise`), der Fehler des Dialogs im Dialog.

**D6 Eine Textquelle für „wirksamer Wert (Vorgabe)“.**
`abloesung/grenzwerte.ts` erhält `grenzwertText(minuten, eigen)`: `formatDauer`, bei einer Vorgabe über `mitVorgabe`. Paneel und Lesezeile im Plan nutzen beide diese Funktion, damit keine zweite Fassung entsteht. Die Lesezeile lautet „Höchstdienst 12 h (Vorgabe) · Mindestruhe 8 h (Vorgabe)“. Mit Schreibrecht folgt ein Link „ändern“ auf `einsatzEinstellungenPfad(id, 'abloesung')`.

**D7 Grenzen im Spiegel.**
Die Grenzen 60 und 1440 kommen als `SCHICHTPLAN_MAX_DIENST_MIN_MINUTEN`, `SCHICHTPLAN_MAX_DIENST_MAX_MINUTEN` und `SCHICHTPLAN_MIN_RUHE_MAX_MINUTEN` nach `api/eingabegrenzen.ts`. `tests/eingabegrenzen_spiegel.rs` vergleicht sie mit `MAX_DIENST_BEREICH` und `MIN_RUHE_BEREICH` (Spec `eingabegrenzen`: Eine Maske lässt nie mehr zu als der Server). Das ist der einzige Eingriff in `tests/`, eine Zeile je Grenze ohne Verhaltensänderung. Die Untergrenze 0 der Mindestruhe ist keine eigene Grenze.

## Risks / Trade-offs

- [Das Paneel lädt den ganzen Plan] → Der Cache wird mit der Ablösung geteilt. Ein Einsatz hat höchstens einige hundert Blöcke, und das Laden geschieht nur beim Öffnen des Reiters. Wird das spürbar, kann ein schmaler GET nachgezogen werden, ohne die Bedienung zu ändern.
- [Ohne Freigabe des Moduls Personal kommen Personen im Plan als `null`] → Für das Paneel ist das unerheblich, es liest nur `grenzwerte`.
- [Zwei Sitzungen ändern gleichzeitig] → Gesendet wird nur das geänderte Feld (D4), und der Server schreibt pro Feld. Den letzten Stand zeigt die Antwort, die anderen Sitzungen holen ihn über Live.
- [Mindestruhe 0 wirkt wie ein Fehler] → In der Doku erklärt. Ein Sonderwort wie „keine“ wurde verworfen: Es bräuchte eine zweite Anzeigeform neben `formatDauer`.
