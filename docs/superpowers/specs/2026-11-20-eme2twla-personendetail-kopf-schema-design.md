# Personendetail: Name in den Kopf, Körperschema sichtbar, ein „Bearbeiten“ — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/eme2twlak8n9wzivyi71b9ut (LLH-1769)
Größe: kleine Änderung (kurzes Design-Doc). Route `entwurf` wegen E2 (Regel in
`frontend/src/personen/AGENTS.md`).

## Warum

Auf der Personendetailseite fehlt oben, um wen es geht: Der Kopf zeigt nur „Person R-021“, der
Name steht erst weit unten in den Personendaten. Das Körperschema öffnet unterhalb des sichtbaren
Bereichs, ohne dass die Seite dorthin rollt, und im Nachtbetrieb sind die Regionen auf der
dunkelgrauen Figur nicht zu erkennen. „Bearbeiten“ hat drei Formen: Rahmenknopf („Anlass
festlegen“, „Transport festlegen“), Link („Versorgende Einheit eintragen“, „+ Geburtsdatum“) und
Wert mit Stift (Name, PAT-Nummer, Zustand).

## Ziele

1. **Name im Kopf.** Der Seitentitel lautet „Mustermann, Erika“, dahinter klein die Kennung
   „R-021“ (Mono, sekundär), danach wie bisher Status, Sichtung und „storniert“. Ohne Namen und
   Vornamen bleibt er „Person R-021“. Die Namensform kommt aus `nameText`
   (`personen/personenSpalten.tsx`), es gibt keine zweite.
2. **Körperschema ins Bild.** Öffnet „Verletzung markieren“, rollt die Seite das Paneel ins Bild
   (`scrollIntoView({ block: 'nearest' })`, bei `reducedMotion` ohne Animation). Beim Markieren
   ist jede Region gestrichelt in der Konturfarbe (`koerperschemaFarben().kontur`, hält schon
   ≥ 3 : 1 gegen Silhouette und Untergrund) umrandet. Fokus und Wahl zeichnen wie bisher
   durchgezogen in `bedien`. In Lesen, Druck und der kleinen Figur gibt es keine Umrandung.
3. **Eine Form für „Bearbeiten“ im Personendetail.**
   - Ein **gesetzter Stand** wird am Wert mit Stift geändert: Anlass und Transport bekommen den
     Wertknopf (`wertAngabeStil` + `IconStift`, Name „Anlass bearbeiten“ bzw. „Transport
     bearbeiten“), der dasselbe Paneel öffnet wie heute (`aria-expanded`).
   - Eine **leere Angabe** fordert als Wort auf (Link-Stil `leerKnopfStil`): „Anlass festlegen“,
     „Transport festlegen“ (bestehende Regel „Ein leeres Feld muss sagen, dass man es schreiben
     kann“, `frontend/AGENTS.md`).
   - Ein **neuer Eintrag** entsteht über einen Rahmenknopf: „Maßnahme erfassen“, „Verletzung
     markieren“, „Verbleib erfassen“, „In UHS aufnehmen“, „Übergabe quittieren“ bleiben.

## Nicht-Ziele

- Breadcrumb und Browser-Tab bleiben ohne Namen (Name gehört nicht in Verlauf und Lesezeichen;
  der Tab-Titel trägt ohnehin nur das Modul).
- Keine Änderung an `InlineAngabe` und anderen Seiten; die Sichtungsfläche bleibt der große
  Auslöser (Farbachse), „Rettungsmittel anfordern“ bleibt ein Weg.
- Keine neue Farbe für die Silhouette (Kontrastprüfung bleibt unverändert).

## Ansätze

- **Stift am Wert (gewählt):** passt zur feldweisen Bearbeitung der Personendaten, hält den
  Patientenkopf kurz genug für 1280 × 800 ohne Bildlauf.
- Rahmenknopf „Bearbeiten“ neben jedem Wert (verworfen): rund zehn Knöpfe mehr, der Kopf
  passte nicht mehr ohne Bildlauf.
- Stift auch an leeren Angaben (verworfen): widerspricht der Regel, dass ein leeres Feld als
  Wort auffordert.

## Regel (E2)

Unter „Patientenkopf mit vollem PAT-Kern“ in `frontend/src/personen/AGENTS.md` ein Satz: Ein
gesetzter Stand wird am Wert mit Stift geändert, eine leere Angabe fordert als Wort auf, ein
neuer Eintrag entsteht über einen Rahmenknopf. Dazu bei „Körperschema“: Regionen beim Markieren
gestrichelt in `kontur`, das Paneel rollt beim Öffnen ins Bild; bei „Personen-Detail“: der
Titel trägt „Name, Vorname“ vor der Kennung.

## Nachweis

Vitest: Titel mit/ohne Namen (`PersonenDetailPage`), Wertknopf vs. Wort für Anlass und Transport
(`Patientenkopf.test.tsx`), gestrichelte Zonen nur im Modus `markieren` (`Koerperschema.test.tsx`),
`scrollIntoView` beim Öffnen. Bestehende e2e (`personen-detail.spec.ts`,
`betroffene-handy.spec.ts`, Doku-Bilder `betroffene`) auf neue Namen und Titel prüfen; Bilder des
Kapitels `betroffene` neu erzeugen (Mitänderungsregel).

## Dem Bauenden überlassen

Strichmuster und -stärke der Umrandung (dezent, aber im Nachtbetrieb erkennbar); ob überlappende
Rechtecke einer Region einzeln umrandet werden.
