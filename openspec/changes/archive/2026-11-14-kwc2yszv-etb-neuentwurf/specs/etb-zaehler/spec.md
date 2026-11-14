## RENAMED Requirements

- FROM: `### Requirement: ETB-Kopf und Bilanz zeigen die exakte Zahl`
- TO: `### Requirement: ETB-Kopf und Typ-Segmente zeigen die exakte Zahl`

## MODIFIED Requirements

### Requirement: ETB-Kopf und Typ-Segmente zeigen die exakte Zahl
Die ETB-Seite SHALL im Kopf und an den Typ-Segmenten der Filterleiste die Zahlen der Zählung
anzeigen, nicht die Zahl der geladenen Einträge. Eine eigene Bilanz-Leiste MUST es nicht geben.
- **Kopf:** Ohne aktiven Filter MUST dort „n Einträge“ mit der Zahl der Handeinträge stehen; sind
  Systemeinträge ausgeblendet, folgt „· m Systemeinträge ausgeblendet“. Mit aktivem Filter steht
  „n Treffer“ mit `gesamt` der gefilterten Zählung. Bei n = 1 steht die Einzahl.
- **Typ-Segmente:** Jedes zeigt die Zahl aus `je_typ`, „Alle“ die Summe der Handeinträge.
- **Sendestatus:** Der Kopf SHALL zeigen, ob alle Einträge übertragen sind („alles übertragen“) oder
  wie viele ausstehen („n ausstehend“), mit dem Weg zu den ausstehenden.
- **Keine Zahl:** Solange die Zählung lädt oder fehlgeschlagen ist, MUST die Seite keine Gesamtzahl
  behaupten. Sie zeigt dann keine Zahl bzw. den Hinweis, dass die Zählung aussteht.

#### Scenario: Kopf ohne Filter
- **WHEN** die Seite 100 von 412 Einträgen geladen hat, davon 300 Systemeinträge, und kein Filter außer der Vorgabe aktiv ist
- **THEN** steht im Kopf „112 Einträge · 300 Systemeinträge ausgeblendet“

#### Scenario: Kopf mit Filter
- **WHEN** ein Volltextfilter aktiv ist, der auf 7 Einträge passt
- **THEN** steht im Kopf „7 Treffer“, und die Typ-Segmente summieren sich zu 7

#### Scenario: Vorgemerkte Einträge
- **WHEN** zwei Einträge ohne Netz vorgemerkt sind
- **THEN** steht im Kopf „2 ausstehend“ statt „alles übertragen“

#### Scenario: Zählung schlägt fehl
- **WHEN** der Zähl-Endpunkt mit einem Fehler antwortet
- **THEN** zeigen Kopf und Typ-Segmente keine Zahl; die Liste bleibt bedienbar
