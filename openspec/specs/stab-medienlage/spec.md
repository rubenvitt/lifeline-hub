# stab-medienlage Specification

## Purpose

Die Medienlage verdichtet Presse-Log, Pressemitteilungen und Informationstelefon zu einem
Lagepunkt ohne Personenbezug. Sie steht auf der Presseseite und kann in den Abschnitt „Medienlage“
des Lagevortrags übernommen werden. Dazu gehört der Einstieg in die S5-Werkzeuge aus der Stabseite.

## Requirements

### Requirement: Einstieg aus der S5-Zeile
Die Sachgebietszeile S5 der Stabseite SHALL zwei Verweise tragen: „Pressearbeit“ auf
`/einsaetze/:id/stab/presse` und „Informationstelefon“ auf `/einsaetze/:id/stab/infotelefon`.
Beide Seiten MUST unter ihrer Adresse als Lesezeichen taugen. Die Navigation MUST dort den Stab als
aktiv zeigen. Keine der Seiten erscheint als eigenes Modul in Rail, Modulpanel, Modulfreigabe oder
Modulzähler.

Jede Seite MUST die Freigabe des Stabs ermitteln, bevor sie Daten zeigt. Ist die Freigabe nicht
ermittelbar, zeigt die Seite einen Fehler mit Wiederholen.

#### Scenario: Einstieg
- **WHEN** eine Person mit Leserecht auf den Stab in der Zeile S5 auf „Informationstelefon“ tippt
- **THEN** öffnet sich das Anrufprotokoll des Einsatzes, und das Stab-Modul ist in der Navigation
  aktiv

#### Scenario: Stab gesperrt
- **WHEN** das Stab-Modul für die Person gesperrt ist
- **THEN** sind Presseseite, Pressemitteilungen und Informationstelefon nicht erreichbar

### Requirement: Medienlage ohne Personenbezug
Das System SHALL aus den geladenen Medienkontakten, Pressemitteilungen und Anrufen eine Medienlage
ableiten:
- Medienkontakte gesamt, davon offen, aufgegliedert nach Art
- die Namen der anfragenden Medien, jedes einmal
- die freigegebenen Pressemitteilungen mit Titel, Version und Zeitpunkt der Freigabe
- Anrufe am Informationstelefon gesamt, nach Anliegen, und offene Rückrufe

Die Medienlage MUST NOT Ansprechpersonen, Erreichbarkeiten, Anrufernamen, Rückrufnummern, Notizen
oder Themen enthalten. Ist eine Quelle nicht geladen oder gesperrt, MUST ihr Teil mit „—“ und
Grund erscheinen, nie mit 0.

#### Scenario: Kein Personenbezug
- **WHEN** die Medienlage aus Kontakten mit Ansprechperson und Anrufen mit Rückrufnummer
  abgeleitet wird
- **THEN** enthält ihr Text weder die Namen noch die Nummern noch die Notizen

#### Scenario: Quelle fehlt
- **WHEN** die Anrufliste nicht geladen werden konnte
- **THEN** steht beim Informationstelefon „—“ mit Grund, und die übrigen Teile erscheinen

### Requirement: Abschnitt „Medienlage“ im Lagevortrag
Die Lagebericht-Vorlage „Lagevortrag zur Information“ SHALL einen Abschnitt „Medienlage“
unmittelbar vor der „Zusammenfassung“ führen. Bestehende Lageberichte ohne diesen Abschnitt MUST
lesbar und bearbeitbar bleiben; offene Entwürfe MUST freigebbar bleiben (sie bekommen den
Abschnitt leer nachgetragen). Ein leerer Abschnitt erscheint im Snapshot wie jeder andere leere
Abschnitt mit „(keine Angabe)“. Die übrigen Lagebericht-Vorlagen bleiben unverändert.

#### Scenario: Alter Entwurf
- **WHEN** ein vor dieser Änderung angelegter Entwurf geöffnet und gespeichert wird
- **THEN** gelingt das Speichern, und der Abschnitt „Medienlage“ steht leer im Editor

#### Scenario: Alter Entwurf wird freigegeben
- **WHEN** ein vor dieser Änderung angelegter, gefüllter Entwurf ohne weitere Bearbeitung
  freigegeben wird
- **THEN** gelingt die Freigabe, und der Snapshot führt „Medienlage“ mit „(keine Angabe)“

### Requirement: Medienlage aus S5 übernehmen
Im Abschnitt „Medienlage“ eines Lagevortrag-Entwurfs SHALL der Knopf „Aus S5 übernehmen“ stehen.
Er setzt die abgeleitete Medienlage als Text in den Abschnitt ein:
- Ist der Abschnitt leer, geschieht das ohne Rückfrage.
- Ist er gefüllt, MUST eine Rückfrage das Ersetzen bestätigen lassen.

Der Knopf MUST fehlen, wenn das Stab-Modul für die Person nicht freigegeben ist. An seiner Stelle
MUST ein Hinweis stehen, dass die Übernahme ohne Freigabe des Stabs nicht verfügbar ist. Solange
die Freigabe nicht ermittelt ist, stehen weder Knopf noch Hinweis. Ohne Schreibrecht ist er
gesperrt. Die Übernahme ändert nur den Entwurf und wird mit dem nächsten Speichern persistiert.

#### Scenario: Leerer Abschnitt
- **WHEN** die Person im leeren Abschnitt „Medienlage“ auf „Aus S5 übernehmen“ tippt
- **THEN** steht die abgeleitete Medienlage im Abschnitt, und der Entwurf gilt als geändert

#### Scenario: Gefüllter Abschnitt
- **WHEN** der Abschnitt schon Text enthält und die Person übernimmt
- **THEN** fragt die Oberfläche, ob der Text ersetzt werden soll, und ersetzt ihn erst nach
  Bestätigung

#### Scenario: Stab nicht freigegeben
- **WHEN** das Stab-Modul für die Person gesperrt ist
- **THEN** zeigt der Abschnitt keinen Übernahme-Knopf, sondern den Hinweis, dass die Übernahme
  aus S5 ohne Freigabe des Stabs nicht verfügbar ist
