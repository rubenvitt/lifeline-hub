# Proposal

Gemeinsame Change für LLH-1831 (`r9up3kp5`, Konfliktprüfung an allen Einzelfeldern) und LLH-1834
(`mdopfgqk`, „Zuletzt geändert von/um“), beide unter LLH-1813 „Zusammenarbeit, Druck und Tempo“.
Beide ändern dieselben Schreibwege und Specs (`einheit-ansicht`, `einsatzdaten-bearbeitung`).

## Why

Zwei Personen bearbeiten dieselbe Einzelangabe einer Einheit oder der Einsatzdaten: B speichert
nach A, der Server antwortet 200, die Meldung sagt „gespeichert“, und der Text von A ist still
weg. Die Konfliktprüfung gibt es nur in Paneelen, bei Tier, Schaden und in den Personendaten; die
zeilenweise bearbeiteten Ansichten Einheit und Einsatzdaten schreiben ohne Vergleich. Wer eine
Angabe zuletzt geändert hat, ist nirgends zu sehen, auch nicht im ETB. In einer Führungsstelle mit
mehreren Arbeitsplätzen ist das ein Datenverlust ohne Spur.

## What Changes

- **Feldvergleich an der Einzelangabe:** Die Ansichten Einheit und Einsatzdaten (Kopfdaten und
  eigene Führungsstelle) senden beim Speichern einer Angabe den Wert mit, den sie beim Öffnen
  hatte (`erwartet`). Hat jemand anderes genau diese Angabe inzwischen geändert, antwortet der
  Server mit 409 und schreibt nichts. Eine Änderung an einer anderen Angabe löst keinen Konflikt
  aus. Ein Aufruf ohne `erwartet` schreibt wie bisher ohne Vergleich.
- **Ein Konfliktdialog überall:** „Zwischenzeitlich geändert“ nennt den aktuellen Wert, wer ihn
  wann gesetzt hat, und bietet „Meine Änderung übernehmen“ und „Verwerfen und neu laden“. Die
  Personendaten wechseln von „Überschreiben“ auf diesen Wortlaut.
- **Hinweis im offenen Feld:** Trifft während der Bearbeitung ein fremder Wert ein, zeigt das
  offene Feld „Inzwischen geändert von … um …: <Wert>“; die eigene Eingabe bleibt stehen.
- **Änderungsvermerk je Feld:** Jedes Schreiben einer Angabe von Einheit, Einsatzkopf und
  Führungsstelle hält fest, wer sie wann zuletzt geändert hat. Die Ansicht zeigt das dezent an der
  Zeile und die jüngste Änderung eines Paneels in dessen Kopf.
- **Nicht in dieser Change:** ETB-Einträge für Feldänderungen (bewusst nicht), eine
  Präsenzanzeige „wird gerade bearbeitet von …“ und die übrigen Schreibwege ohne Basisstand
  (Liste in `design.md`); beides als Folgeaufgaben.

## Capabilities

### New Capabilities

- `aenderungsvermerk`: Wer eine Einzelangabe von Einheit, Einsatzkopf und eigener Führungsstelle
  zuletzt geändert hat und wann, wie das gespeichert, geliefert und angezeigt wird.

### Modified Capabilities

- `formularseiten`: Eine Einzelangabe in einer Ansicht prüft beim Speichern auf eine
  zwischenzeitliche Änderung genau dieser Angabe, zeigt einen eintreffenden fremden Wert im
  offenen Feld an und fragt mit dem einheitlichen Dialog nach.
- `einheit-ansicht`: Das Speichern einer Angabe trägt den Wert beim Öffnen; Konflikt nur bei
  derselben Angabe.
- `einsatzdaten-bearbeitung`: Die Zeilen der Kopfdaten tragen den Wert beim Öffnen; Konflikt nur
  bei derselben Angabe, die Koordinate als Paar.
- `einsatz-fuehrungsstelle`: Die Angaben der eigenen Führungsstelle tragen den Wert beim Öffnen.
- `personendaten-bearbeiten`: Der Konfliktdialog nutzt den einheitlichen Wortlaut und nennt, wer
  wann geändert hat, sofern bekannt.

## Impact

- **Backend:** `PATCH /api/einsaetze/{id}`, `PATCH /api/einsaetze/{id}/einheiten/{eid}` und
  `PATCH /api/einsaetze/{id}/fuehrungsstelle` nehmen ein optionales `erwartet` an (neue 409-Quelle);
  gemeinsamer Feld-CAS-Baustein, aus `person::repo` herausgelöst. Neue Einsatztabelle für den
  Vermerk samt Migration, Schwärzungsregister, Spiegel-Einordnung und Triggern.
  `EinsatzAnzeige`, `EinheitAnzeige` und `FuehrungsstelleAnzeige` tragen die Vermerke
  (Typ-Codegen).
- **Frontend:** `InlineAngabe` (Wert beim Öffnen, Hinweis bei fremdem Wert), ein gemeinsamer
  Konflikt-Hook statt des Dialogs in `Personendaten.tsx`, `EinheitKopf`, `EinheitFunk`,
  `EinsatzdatenPage`, `EinsatzleiterAngabe`; Vermerk an Zeile und Paneelkopf.
- **Regeln:** `frontend/AGENTS.md` (auch eine Einzelangabe trägt den Feldvergleich),
  `src/AGENTS.md` (409-Quellen, Vermerk-Tabelle). Anwenderdoku zu Einsatzdaten und Einheit.
- **Kompatibel:** Ein Aufruf ohne `erwartet` (alte Tabs, öffentliche API, Schreib-Warteschlange)
  verhält sich wie bisher.
