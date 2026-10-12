---
titel: Stab und Checkliste
gruppen: [fuehrung]
reihenfolge: 430
quellen: [frontend/src/pages/StabPage.tsx, frontend/src/stab/BesetzungModal.tsx, frontend/src/stab/besetzung.ts, frontend/src/stab/sachgebiete.ts, frontend/src/stab/unterseiten.ts, frontend/src/stab/useStabFreigabe.tsx, frontend/src/lagebesprechung/LagebesprechungZeile.tsx, frontend/src/stab/ChecklistePaneel.tsx, frontend/src/stab/checkliste.ts, frontend/src/einsatz/schreibrecht.ts, src/routes/stab.rs, src/stab/mod.rs, src/stab/repo.rs, src/stab/checkliste.rs]
---

## Überblick

Die Seite „Stab“ unterstützt die Führungsgruppe oder den Stab der Einsatzleitung. Sie zeigt, wer
die Sachgebiete S1 bis S6 besetzt, und führt von jedem Sachgebiet zu seinen Werkzeugen. Oben
steht die nächste Lagebesprechung mit dem Verweis „Zur Lagebesprechung“; vorbereitet,
abgeschlossen und nachgelesen wird sie im eigenen Kapitel [Lagebesprechung](lagebesprechung.md).
Die Checkliste „Arbeitsaufnahme“ begleitet den Aufbau der Führungsstelle. Lesen können alle Mitglieder des
Einsatzes, bedienen Einsatzleitung und Führungspersonal.

## Abläufe

### Ein Sachgebiet besetzen

1. „Stab“ öffnen. Im Paneel „Besetzung S1–S6“ beim Sachgebiet „Besetzung ändern“ wählen.
2. Unter „Besetzung“ wählen, wer das Sachgebiet führt: „nicht vergeben“, „bei der
   Einsatzleitung“, „disponierte Person“, „extern (nicht disponiert)“ oder „rückwärtig
   (Leitstelle/FEZ)“.
3. Bei „disponierte Person“ unter „Person“ die Person wählen; fehlt sie, öffnet „Ad-hoc-Person
   anlegen …“ einen Dialog, der sie anlegt. Bei „extern“ und „rückwärtig“ die „Bezeichnung“ eintragen.

   ![Dialog „Besetzung S4 · Versorgung“ mit disponierter Person](../bilder/stab/besetzung.png)

4. „Übernehmen“ wählen.

### Die Arbeitsaufnahme abhaken

1. Auf der Seite „Stab“ zum Paneel „Arbeitsaufnahme“ gehen.
2. Einen erledigten Punkt anhaken. Die Zeile zeigt danach „erledigt“ mit Uhrzeit; ein zweiter
   Klick nimmt den Haken zurück.

   ![Paneel „Arbeitsaufnahme“ mit drei erledigten Punkten und einer Bemerkung](../bilder/stab/arbeitsaufnahme.png)

3. Für eine Ergänzung „Bemerkung hinzufügen“ wählen, den Text eingeben und speichern.

## Hintergrund

### Wer was darf

Besetzung und Checkliste bedienen Einsatzleitung und Führungspersonal, solange der Einsatz läuft.
Wer das nicht darf, sieht den Grund unter dem Seitenkopf. Einzelheiten stehen in
[Rechte im Einsatz](rechte-im-einsatz.md).

Ist das Modul Stab für den Einsatz nicht freigegeben, sind auch seine Unterseiten (Funkplan,
Kommunikationsplan, Pressearbeit, Informationstelefon) gesperrt: „… nicht verfügbar“, „Modul Stab
nicht freigegeben“. Die Lagebesprechung hat ihre eigene Freigabe; ist sie gesperrt, steht
„Zur Lagebesprechung (Keine Berechtigung)“ gesperrt da.

### Die Zeilen der Besetzung

Jede Zeile nennt das Sachgebiet mit der Bezeichnung der Organisation, seine Aufgaben mit der
Fundstelle in der FwDV 100 und die Werkzeuge des Sachgebiets als Verweise, etwa „Personal“ und
„Einheiten“ bei S1, „Lagekarte“ und „ETB“ bei S2, „Pressearbeit“ und
„Informationstelefon“ bei S5, „Funkplan“ und „Kommunikationsplan“ bei S6. Ein Verweis auf ein
gesperrtes Modul fehlt. Eine Besetzung wird überschrieben; die App führt keine Historie, der
Verlauf steht im Einsatztagebuch.

### Was ins Einsatztagebuch geht

- **Besetzung:** jeder wirksame Wechsel, etwa „S2 Lage: Besetzung → … (vorher: …)“. Dieselbe Wahl
  ein zweites Mal schreibt nichts.
- **Arbeitsaufnahme:** nur der Punkt „Einsatzbereitschaft an die Leitstelle gemeldet“, beim Haken
  wie bei der Rücknahme. Die anderen Punkte und ihre Bemerkungen schreiben nichts.

### Checkliste

- Die sieben Punkte der „Arbeitsaufnahme“ sind fest. Kein Punkt wird aus anderen Modulen
  abgeleitet; abgehakt wird von Hand.
- Der Punkt „Standort der Führungsstelle festgelegt“ zeigt Bezeichnung und Standort der eigenen
  Führungsstelle aus den Einsatzdaten und verweist dorthin. Der Haken bleibt trotzdem offen,
  bis jemand ihn setzt.

### Fälliger Termin

Erreicht die Uhr den Termin der nächsten Lagebesprechung, zeigt die Zeile oben „jetzt fällig“,
danach „seit … min überfällig“, als Hinweis, nicht als Alarm.

### Ohne Netz

Besetzung und Checkliste werden ohne Netz nicht vorgehalten (siehe
[Arbeiten ohne Netz](ohne-netz.md)).

## Grundlagen und Quellen

- FwDV 100, Anlage 2: Sachgebiete S1 bis S6 und ihre Aufgaben.
- FwDV 100, Anlage 5, S. 64, und LFS-BW F5-I, Kapitel 5, S. 33–34: Punkte der Arbeitsaufnahme.
- EEMUA 191: Ein fälliger Termin ist kein Alarm (Alarmbudget).
