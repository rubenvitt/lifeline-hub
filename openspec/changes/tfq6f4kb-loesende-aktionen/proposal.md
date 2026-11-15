# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/tfq6f4kb9o70rxmvsor6zqa4 (LLH-1722) mit den
Unteraufgaben LLH-1799 (`zjnw0rkj`), LLH-1800 (`d9x8cge8`) und LLH-1801 (`fx4335q2`). Thema 8
der UI/UX-Analyse vom 12.11.2026 (LLH-1714).

## Why

Lösende Aktionen feuern ohne Rückfrage, und das versprochene „Rückgängig“ stellt nur einen Teil
wieder her. Nach „Entlassen“ und „Rückgängig“ steht ein Fahrzeug ohne Einheit, ohne Besatzung,
ohne Raum und auf dem Anfangsstatus. Am Handy ist „Entlassen“ der größte Knopf jeder
Fahrzeugkarte. Im Einheit-Detail löst ein roter Zeilenknopf ein Fahrzeug ohne jeden Rückweg, und
weil die nächste Zeile hochrückt, löst ein Doppeltipp zwei. Dahinter steht Wildwuchs: sieben
Verben fürs Beenden mit vier Sicherungsstufen, Bearbeiten und Anlegen je Modul anders, und zwei
Regeln, die sich bei der Farbe widersprechen.

## What Changes

- **Muster für Beenden, Bearbeiten, Anlegen und den Kopf** (`fx4335q2`): eine Regel in
  `frontend/AGENTS.md` und in der neuen Fähigkeit `bedien-muster`. Beenden kennt fünf Arten
  (Zuordnung lösen, Kraft entlassen, Gebilde auflösen oder schließen, Fehlanlage stornieren,
  eigene Buchung zurücknehmen), je mit Verb, Ort und Sicherung. Im ⋮-Menü steht nur
  Endgültiges rot. Der Kopf zeigt höchstens zwei Handlungen, der Rest liegt im ⋮.
- **Beenden in allen Modulen nachziehen**: Stornieren immer im ⋮, Auflösen als letzter
  Abschnitt einer Detailseite, Schließen einer Betreuungsstelle mit Rückgängig, Lösen mit
  gehaltener Zeile „Gelöst · Rückgängig“. Bearbeiten (UHS und Bereitstellungsraum in die
  Ansicht) und Anlegen (Drawer, eingeklappte Formulare) ziehen Folgeaufgaben nach.
- **Fahrzeug „Entlassen“ vollständig zurücknehmen** (`zjnw0rkj`): Ein neuer Schreibweg stellt
  Einheit, Besatzung, Raum, Führungsstelle, Beladung und Status in einer Transaktion wieder her.
  Auf der Karte wandert „Entlassen“ ins ⋮.
- **„Aus Einheit lösen“ mit Rückweg** (`d9x8cge8`): Das Fahrzeug bekommt ein ⋮. Seine Zeile
  hält ihre Stelle als „Gelöst · Rückgängig“. Ein Rückgängig scheitert sichtbar, statt das
  Fahrzeug einer anderen Einheit still wegzunehmen. Auch das Lösen einer Person bekommt
  Rückgängig, samt Führerrolle.
- Personal-Entlassen und Material „Aus dem Einsatz nehmen“ behalten vorerst ihr unvollständiges
  Rückgängig. Die Regel nennt diese Lücke, Folgeaufgaben schließen sie.

## Capabilities

### New Capabilities
- `bedien-muster`: Verb, Ort und Sicherung für Beenden, Bearbeiten und Anlegen über alle Module,
  dazu die Höchstzahl sichtbarer Handlungen im Kopf einer Detailseite.

### Modified Capabilities
- `datensatz-aktionsmenue`: Rot hinter dem Trenner steht nur noch Endgültiges, nicht mehr alles
  Entfernende.
- `fahrzeug-bearbeitung`: Auf der Karte ist „Entlassen“ keine Hauptaktion mehr, sondern steht im
  Menü.
- `kraefte-entlassung`: Neue Anforderung „Entlassung eines Fahrzeugs zurücknehmen“. Das Szenario
  „Rückgängig nach Entlassen“ wird präzisiert.
- `einheit-ansicht`: Fahrzeuge bekommen ein Menü, das Lösen hat einen Rückweg, die gelöste Zeile
  hält ihre Stelle, und Lösen-Einträge stehen neutral.
- `material-am-ort`: Die gehaltene Zeile trägt „Rückgängig“ selbst, nicht nur im Hinweis.
- `bedien-wortlaut`: Das Szenario „Bereitstellungsraum stornieren“ fragt im Dialog aus dem ⋮
  nach, statt am sichtbaren Knopf.

Die Ortsregeln für UHS, Bereitstellungsraum und Betreuungsstelle (Auflösen als letzter Abschnitt,
Stornieren im ⋮, Schließen mit Rückgängig) trägt `bedien-muster`. Die Specs dieser Module legen
den Ort heute nicht fest. Die Muster für Bearbeiten und Anlegen stehen als Regel in
`frontend/AGENTS.md` und in der ADR. Ihre Spec-Anforderungen bringen die Folgeaufgaben mit, die
den Bestand nachziehen. Bis dahin beschriebe eine Spec ein Verhalten, das der Code noch nicht hat.

## Impact

- **Backend:** `src/fahrzeug/disposition_repo.rs` (Vorzustand beim Entlassen, Rücknahme),
  `src/routes/einsatz_fahrzeug.rs` und `src/app.rs` (neue Route `…/entlassen/zuruecknehmen`,
  Antwort von `…/entlassen` mit Vorzustand), `src/einheit/mitglied_repo.rs` und
  `src/routes/einsatz_einheit.rs` (Vorbedingung „nur wenn frei“ beim Zuordnen),
  `src/api_doc.rs`, Tests unter `tests/`. Keine Migration. Typ-Codegen
  (`frontend/src/api/openapi.json`, `types.generated.ts`).
- **Frontend:**
  - Kräfte: `pages/FahrzeugePage.tsx`, `api/einsatzFahrzeuge.ts`, `api/einheiten.ts`,
    `pages/einheit/FahrzeugeBesatzung.tsx`, `pages/einheit/einheitAnsichtKern.ts`,
    `kraefte/MaterialAmOrt.tsx` und ein neuer geteilter Halte-Hook unter `components/`.
  - Orte: `pages/uhs/UhsDetailPage.tsx`, `pages/bereitstellungsraum/BrDetailPage.tsx`,
    `pages/BetreuungsstelleDetailPage.tsx`, `pages/EvakuierungsbezirkPage.tsx`.
  - Tests und Wächter.
- **Regeln und Doku:** `frontend/AGENTS.md` (Bedien-Leitlinie: Aktionen, Farbe, Rückwege), eine
  neue ADR unter `docs/architektur/entscheidungen/`, die Anwenderkapitel `fahrzeuge`,
  `einheiten`, `uhs`, `bereitstellungsraeume`, `betreuung` mit Bildern.
- **Folgeaufgaben** (über `zunder-task-anlegen`):
  - UHS und Bereitstellungsraum in der Ansicht bearbeiten
  - Anlegen vereinheitlichen (Drawer UHS und BR, eingeklappte Formulare)
  - Personal-Entlassen vollständig zurücknehmen
  - Material „Aus dem Einsatz nehmen“ vollständig zurücknehmen
  - Material am Ort: Vorbedingung beim Rückgängig
