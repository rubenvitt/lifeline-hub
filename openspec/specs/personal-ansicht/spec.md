# personal-ansicht Specification

## Purpose

Personalliste und Personenansicht einer Einsatzkraft: die Liste nach Einheit gruppiert, mit
Einheit, Fahrzeug und Position in der Zeile änderbar und ohne Zeilenaktion; je Person eine eigene
Ansicht mit Einteilung, Angaben zur Person, Zeitachse und dem Weg aus dem Einsatz (Entlassen,
Stornieren, erneut disponieren). Eingeführt mit LLH-1060.

## Requirements

### Requirement: Spalten der Personalliste

Die Personalliste eines Einsatzes SHALL je Person Name, Funktion, Einheit, Fahrzeug, Position als
Kürzel (F, UF, M), Status und Einsatzdauer zeigen. Einheit und Fahrzeug MUST ab einer Breite von
1366 px ohne Spaltenschalter sichtbar sein. Träger, Ruhe und Bemerkung MUST über den
Spaltenschalter einblendbar sein und im Zähler ausgeblendeter Spalten stehen.

#### Scenario: Einteilung am Fükw
- **WHEN** die Personalliste bei 1440 px Breite geöffnet wird
- **THEN** stehen „Einheit“ und „Fahrzeug“ ohne Spaltenschalter im Bild, und der Spaltenschalter nennt Träger, Ruhe und Bemerkung als ausgeblendet

#### Scenario: Position als Kürzel
- **WHEN** eine Person die Stärke-Position Unterführer hat
- **THEN** zeigt ihre Zeile in der Spalte „Position“ „UF“

### Requirement: Einteilungsspalten nach Modulfreigabe

Ohne Freigabe des Moduls Einheiten bzw. Fahrzeuge MUST die Spalte „Einheit“ bzw. „Fahrzeug“ der
Personalliste entfallen, statt eine Kraft als nicht eingeteilt erscheinen zu lassen.

#### Scenario: Modul Fahrzeuge ausgeblendet
- **WHEN** das Modul Fahrzeuge im Einsatz ausgeblendet ist
- **THEN** hat die Personalliste keine Spalte „Fahrzeug“, und keine Zeile zeigt „—“ an ihrer Stelle

### Requirement: Personalliste nach Einheit gruppiert

Die Personalliste SHALL nach Einheit gruppieren. Personen ohne Einheit MUST als erste Gruppe
„nicht eingeteilt“ stehen, danach die Einheiten in der Folge des Kräftebaums (Spec `kraeftebaum`).
Eine Untereinheit MUST mit ihrem Pfad benannt sein. Ohne geladene Einheitenliste MUST die Liste
ungruppiert stehen. Der Status MUST als Filter erhalten bleiben.

#### Scenario: Nicht eingeteilt zuerst
- **WHEN** drei Personen ohne Einheit und vier in der Einheit „Rettungsstaffel“ disponiert sind
- **THEN** steht die Gruppe „nicht eingeteilt“ mit drei Personen vor der Gruppe „Rettungsstaffel“ mit vier

#### Scenario: Untereinheit mit Pfad
- **WHEN** die Einheit „Staffel A“ dem „Zug 1“ unterstellt ist und Personen beider Einheiten disponiert sind
- **THEN** heißt die Gruppe der Untereinheit „Zug 1 › Staffel A“ und steht nach der Gruppe „Zug 1“

### Requirement: Einheitswechsel unter dem Zeiger

Wechselt eine Person die Einheit, während Fokus oder Zeiger in der Personalliste liegen, MUST ihre
Zeile an ihrem Platz bleiben, bis beide die Liste verlassen haben; erst dann MUST sie in die Gruppe
ihrer neuen Einheit wechseln.

#### Scenario: Wechsel mit Fokus in der Liste
- **WHEN** eine Person in der Zeile von „nicht eingeteilt“ in die Einheit „Rettungsstaffel“ gesetzt wird und der Fokus danach in der Liste bleibt
- **THEN** bleibt die Zeile an ihrem Platz, bis Fokus und Zeiger die Liste verlassen, und wechselt erst dann in die Gruppe „Rettungsstaffel“

### Requirement: Einteilung in der Zeile ändern

Mit Schreibrecht im aktiven Einsatz SHALL die Personalliste Einheit, Fahrzeug und Position je
Person in der Zeile änderbar machen, als Auswahl mit ausdrücklichem Speichern und ohne Speichern
beim Verlassen. Einheit und Fahrzeug MUST über den Zuordnungsweg des Zielmoduls schreiben, Leeren
MUST die bisherige Zuordnung freigeben. Eine Ablehnung MUST mit Grund an der Zelle stehen, die
Auswahl bleibt mit dem gewählten Wert offen. Ohne Schreibrecht MUST der Wert als Text stehen.

#### Scenario: Person einer Einheit zuordnen
- **WHEN** in der Zeile einer nicht eingeteilten Person die Einheit „Rettungsstaffel“ gewählt und gespeichert wird
- **THEN** ist sie der Rettungsstaffel zugeordnet, und das ETB nennt die Zuordnung

#### Scenario: Einheit leeren
- **WHEN** die Einheit einer Person in der Zeile geleert und gespeichert wird
- **THEN** ist sie aus ihrer bisherigen Einheit freigegeben und steht unter „nicht eingeteilt“

#### Scenario: Wählen allein schreibt nicht
- **WHEN** in der Zeile eine andere Einheit gewählt und die Bearbeitung mit Escape verlassen wird
- **THEN** bleibt die Einheit unverändert, und es entsteht kein ETB-Eintrag

#### Scenario: Ablehnung an der Zelle
- **WHEN** der Server die Zuordnung zu einem Fahrzeug ablehnt
- **THEN** steht der Grund an der Fahrzeugzelle der Person, und die Auswahl zeigt weiter das gewählte Fahrzeug

#### Scenario: Beobachter
- **WHEN** ein Beobachter die Personalliste öffnet
- **THEN** stehen Einheit, Fahrzeug und Position als Text ohne Bearbeitungsauslöser

### Requirement: Fahrzeug unabhängig von der Einheit

Die Fahrzeugauswahl einer Person MUST die Fahrzeuge ihrer Einheit zuerst anbieten. Ein
Einheitswechsel MUST das Fahrzeug der Person unverändert lassen. Gehört ihr Fahrzeug einer anderen
Einheit, MUST die Fahrzeugangabe das als Text „andere Einheit“ kennzeichnen.

#### Scenario: Fahrzeuge der eigenen Einheit zuerst
- **WHEN** die Fahrzeugauswahl einer Person der Rettungsstaffel geöffnet wird
- **THEN** stehen die Fahrzeuge der Rettungsstaffel vor allen anderen Fahrzeugen

#### Scenario: Einheitswechsel ohne Mitleeren
- **WHEN** eine Person auf einem Fahrzeug der Rettungsstaffel in die Einheit „Zug 1“ wechselt
- **THEN** bleibt sie auf dem Fahrzeug, und ihre Fahrzeugangabe zeigt „andere Einheit“

### Requirement: Liste ohne Zeilenaktion

Die Personalliste MUST NOT je Person einen Knopf oder Menüeintrag zum Entlassen, Stornieren oder
Entfernen tragen und MUST NOT die Zeitachse einer Person aufklappen. Der Name einer Person SHALL
in ihre Personenansicht führen. Der Block „Entlassen“ mit „Erneut disponieren“ MUST unter der
Liste bleiben, und seine Namen SHALL in die Personenansicht führen.

#### Scenario: Keine Löschbedienung
- **WHEN** die Einsatzleitung die Personalliste eines aktiven Einsatzes öffnet
- **THEN** trägt keine Zeile „Entlassen“, „Stornieren“, „Entfernen“ oder „Zeitachse“

#### Scenario: Name öffnet die Ansicht
- **WHEN** der Name „Lena Beispiel“ in der Liste gewählt wird
- **THEN** öffnet sich die Personenansicht von Lena Beispiel

### Requirement: Personenansicht einer Einsatzkraft

Das System SHALL je disponierter Person eine Ansicht unter `/einsaetze/<id>/personal/<epId>`
führen. Ihr Kopf MUST Name, Marken (ad-hoc, Demo, entlassen), Funktion, Träger und die laufende
Einsatzdauer bzw. die Ruhezeit zeigen. Darunter MUST in dieser Folge stehen: „Einteilung“,
„Person“, „Zeitachse“ und zuletzt „Aus dem Einsatz“.

#### Scenario: Aufbau
- **WHEN** die Ansicht einer eingeteilten Person geöffnet wird
- **THEN** folgen auf den Kopf „Einteilung“, „Person“, „Zeitachse“ und als letzter Abschnitt „Aus dem Einsatz“

### Requirement: Einteilung in der Ansicht

Die Einteilung der Personenansicht SHALL Status, Einsatzfunktion, Einheit, Fahrzeug,
Unfallhilfsstelle, Position und Bemerkung zeigen. Jede Angabe MUST einzeln gespeichert werden,
über denselben Schreibweg wie in der Liste. Ohne Freigabe ihres Moduls MUST die Zeile „Einheit“,
„Fahrzeug“ bzw. „Unfallhilfsstelle“ entfallen. Führt die Person ihre Einheit, MUST die Zeile
„Einheit“ das nennen.

#### Scenario: Position in der Ansicht
- **WHEN** in der Einteilung die Position auf „Führer“ gesetzt und gespeichert wird
- **THEN** ist nur die Position geändert, und die Liste zeigt „F“

#### Scenario: Einheitsführer sichtbar
- **WHEN** die Person ihre Einheit „Rettungsstaffel“ führt
- **THEN** nennt die Zeile „Einheit“ der Einteilung „Rettungsstaffel“ und „Einheitsführer“

### Requirement: Ansicht ohne Person oder ohne Schreibrecht

Eine ungültige ID MUST zur Personalliste führen. Eine unbekannte oder stornierte Person MUST die
Ansicht als nicht (mehr) im Einsatz melden, mit einem Weg zur Personalliste. Ohne Schreibrecht
oder bei abgeschlossenem Einsatz MUST die Ansicht nur lesen und den Grund nennen.

#### Scenario: Stornierte Person
- **WHEN** die Ansicht einer stornierten Person aufgerufen wird
- **THEN** meldet die Seite, dass die Person nicht (mehr) im Einsatz ist, und bietet den Weg zur Personalliste

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Ansicht in einem abgeschlossenen Einsatz geöffnet wird
- **THEN** stehen alle Angaben als Text, und die Seite nennt den Grund „nur Ansicht“

### Requirement: Angaben zur Person in der Ansicht

Die Personenansicht SHALL bei einer Ad-hoc-Person Name, Qualifikation und Träger änderbar machen,
den Namen als Pflichtangabe. Bei einer Person aus dem Personalstamm MUST sie diese Angaben nur
anzeigen und SHALL, wenn der Benutzer die Verwaltung öffnen darf, einen Sprung „im Stamm ändern“
auf den Stammdatensatz anbieten.

#### Scenario: Ad-hoc-Name berichtigen
- **WHEN** der Name einer Ad-hoc-Person in der Ansicht von „Maier“ auf „Meier“ geändert wird
- **THEN** zeigen Kopf und Personalliste „Meier“

#### Scenario: Leerer Name
- **WHEN** der Name einer Ad-hoc-Person geleert und gespeichert werden soll
- **THEN** wird nichts gesendet, und der alte Name bleibt mit einem Hinweis stehen

#### Scenario: Stamm-Person
- **WHEN** eine Führungskraft der Organisation die Ansicht einer Stamm-Person öffnet
- **THEN** stehen Name, Qualifikation und Träger als Text, und „im Stamm ändern ↗“ führt auf den Stammdatensatz

#### Scenario: Ohne Verwaltung
- **WHEN** eine Person ohne Zugang zur Verwaltung die Ansicht einer Stamm-Person öffnet
- **THEN** fehlt der Sprung „im Stamm ändern ↗“

### Requirement: Entlassen und Stornieren in der Ansicht

Die Personenansicht SHALL im letzten Abschnitt „Aus dem Einsatz“ die Handlungen „Entlassen“ und
„Stornieren“ mit Abstand zueinander anbieten. „Entlassen“ MUST ohne Rückfrage wirken und einen
Rückgängig-Weg anbieten. „Stornieren“ MUST mit einem Satz zur Folge rückfragen und mit einem Knopf
„Stornieren“ bestätigt werden. Nach einem Storno MUST die Seite zur Personalliste führen.

#### Scenario: Entlassen aus der Ansicht
- **WHEN** in der Ansicht „Entlassen“ gewählt wird
- **THEN** ist die Person entlassen, ein Hinweis bietet „Rückgängig“, und die Ansicht zeigt sie als entlassen

#### Scenario: Storno nach Rückfrage
- **WHEN** eine vor fünf Minuten disponierte Person ohne Einteilung storniert und die Rückfrage mit „Stornieren“ bestätigt wird
- **THEN** ist sie storniert, und die Seite zeigt die Personalliste

### Requirement: Storno-Frist und Ablehnung am Ort

Liegt die Disposition sicher mehr als 15 Minuten zurück, MUST „Stornieren“ gesperrt stehen und den
Grund in wenigen Wörtern nennen. Lehnt der Server einen Storno oder ein Entlassen ab, MUST der Grund
im Abschnitt „Aus dem Einsatz“ stehen.

#### Scenario: Frist abgelaufen
- **WHEN** die Ansicht einer vor 40 Minuten disponierten Person geöffnet wird
- **THEN** steht „Stornieren“ gesperrt mit dem Grund „nur in den ersten 15 Minuten“

#### Scenario: Storno abgelehnt
- **WHEN** der Server den Storno einer Person ablehnt, weil sie schon eingetroffen ist
- **THEN** steht der Grund im Abschnitt „Aus dem Einsatz“

### Requirement: Entlassene Person in der Ansicht

Die Personenansicht SHALL auch eine entlassene Person zeigen: nur lesend, mit dem Zeitpunkt der
Entlassung, mit ihrer Zeitachse ohne Nachtrag und Streichung und mit der Handlung „Erneut
disponieren“.

#### Scenario: Nachweis einer entlassenen Person
- **WHEN** die Ansicht einer um 14:00 entlassenen Person geöffnet wird
- **THEN** zeigt sie „entlassen 14:00“, ihre Zeitachse mit der Entlassung und „Erneut disponieren“, aber keine änderbare Angabe

#### Scenario: Erneut disponieren
- **WHEN** in der Ansicht einer entlassenen Person „Erneut disponieren“ gewählt wird
- **THEN** ist sie wieder aktiv, und ihre Angaben sind wieder änderbar

### Requirement: Deeplinks auf eine Einsatzkraft

Ein Verweis `?personal=<id>` auf die Personalliste MUST weiter die Zeile der Person hervorheben und
ins Bild holen; Lagekarte und Schaden MUST weiter dorthin springen. Die Sprungpalette SHALL eine
Person in ihrer Personenansicht öffnen. Die Brotkrume „Personal“ der Ansicht SHALL zur
hervorgehobenen Zeile der Person führen. Pfade zur Ansicht MUST aus der Deeplink-Quelle entstehen.

#### Scenario: Bestandslink aus der Lagekarte
- **WHEN** aus der Lagekarte eine Führungskraft geöffnet wird
- **THEN** öffnet sich die Personalliste mit ihrer hervorgehobenen Zeile

#### Scenario: Sprungpalette
- **WHEN** in der Sprungpalette eine Person gewählt wird
- **THEN** öffnet sich ihre Personenansicht

#### Scenario: Zurück zur Zeile
- **WHEN** in der Ansicht die Brotkrume „Personal“ gewählt wird
- **THEN** öffnet sich die Personalliste mit der Zeile dieser Person hervorgehoben
