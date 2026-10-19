# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/y4l621ihqmmx39letysldfu1 (LLH-1332)

## Why

Ein erfasster Verbleib „Transport“ gilt heute als Abschluss: die Person tritt aus der UHS aus und
verschwindet aus „Noch nicht aufgenommen“. Fachlich stimmt das nur, wenn ein **fremdes**
Rettungsmittel den Patienten übernimmt. Fährt ihn ein Fahrzeug **aus dem Einsatz**
(Eigentransport), bleibt er in unserer Verantwortung, bis er am Ziel übergeben ist. Dafür gibt es
weder eine Zuordnung zu diesem Fahrzeug noch einen Übergabeschritt. Umgekehrt bleiben
abgeschlossene Patienten (übergeben, vor Ort entlassen, Notunterkunft, Verbleib des Leichnams) in
Liste, Sichtungsraster und Lagezahlen genauso präsent wie Patienten in Versorgung. Bei einer
größeren Lage drängen sie die offenen Fälle aus dem Blick.

Dazu kommen zwei Bedienmängel aus derselben Rückmeldung (19.10.2026): Die UHS-Listen „Noch nicht
aufgenommen“ und „Wartebereich“ kürzen den Namen auf „SK III R-004 · …“, weil der Knopf
„Verbleib“ die halbe 240-px-Spalte belegt. Das Sichtungsraster ist eine gruppierte Tabelle und
kein Lagebild nach Sichtung.

## What Changes

- **Transport unterscheidet fremdes Rettungsmittel und Eigentransport.** Der Verbleib „Transport“
  bekommt die Angabe, wer fährt:
  - *Fremdes Rettungsmittel*: Freitext mit Vorschlägen (bisher eingetragene Transportmittel des
    Einsatzes und Fahrzeugstamm der Organisation). Der Patient ist mit dem Speichern übergeben
    und damit abgeschlossen.
  - *Eigentransport*: Pflichtwahl eines im Einsatz disponierten, nicht entlassenen Fahrzeugs.
    Der Patient ist **unterwegs** und bleibt in unserer Verantwortung.
- **Neuer Schritt „Übergabe quittieren“** für Patienten im Eigentransport, mit Uhrzeit (Vorgabe
  jetzt, nachtragbar) und optional Ziel. Erst danach ist der Patient abgeschlossen. Der Schritt
  ist ein eigenes Verlaufsereignis mit ETB-Spur, offline vormerkbar wie die übrigen Einträge.
- **Abgeschlossen ist ein abgeleiteter Zustand der Person** (`versorgung`: `offen` · `unterwegs` ·
  `abgeschlossen`), den der Server mitliefert. Abgeschlossen sind: Transport mit fremdem
  Rettungsmittel, quittierte Übergabe, Entlassung vor Ort, Notunterkunft, Verbleib des Leichnams.
- **Standardansichten blenden Abgeschlossene aus.** Betroffenenliste, Sichtungsraster,
  Kartenansicht der Betroffenen, UHS-Grundriss (rechte Spalte: nur noch „Unterwegs“ statt „Auf
  Transport gebracht“) und Lagekarten-Ebene zeigen standardmäßig nur offene und unterwegs
  befindliche Patienten. Ein Schalter „Abgeschlossene zeigen“ (in der Adresse) holt sie zurück.
  Detailseite, Suche/Sprungpalette, Druck, CSV und Zugriffsprotokoll finden sie weiter.
- **Lagezahlen trennen „in Versorgung“, „unterwegs“ und „abgeschlossen“.** Die Zeile
  „Transportiert / offen“ des Lage-Dashboards wird zu „Unterwegs / offen / abgeschlossen“.
- **UHS-Listen neu geformt:** Die Zeile trägt Sichtung, Kennung und Namen auf voller Breite (zweite
  Zeile für Wartezeit bzw. Fundort); die Verbleib-Aktion wird ein schmaler Symbolknopf mit
  zugänglichem Namen statt eines Wortknopfs. Bedienziele halten die Dichte-Staffel.
- **Sichtungsraster wird ein Sichtungsboard:** je Kategorie (SK I–IV, tot, unverletzt, ohne
  Sichtung) eine Spalte mit Farbkopf und Zahl, darin Karten mit Kennung, Name, „gesichtet vor“,
  Aufenthalt (UHS-Platz, Wartebereich, Fundort, „unterwegs · Fahrzeug“) und Transportpriorität.
  Die Karte öffnet die Person; die Sichtung ändert sich wie in der Zeile über die Sichtungszelle.

Keine **BREAKING**-Änderung am Wire: neue Felder sind additiv, bestehende Verbleib-Ereignisse
ohne Fahrer-Angabe gelten als fremdes Rettungsmittel (bisheriges Verhalten: abgeschlossen).

## Capabilities

### New Capabilities

- `patienten-uebergabe`: Wer einen Patienten transportiert (fremdes Rettungsmittel oder
  Eigentransport mit Einsatzfahrzeug), der Schritt „Übergabe quittieren“, der abgeleitete
  Versorgungszustand `offen`/`unterwegs`/`abgeschlossen` und die Vorschläge für fremde
  Rettungsmittel.
- `sichtungsboard`: Die Ansicht „Sichtungsraster“ der Betroffenenseite als Board mit einer Spalte
  je Sichtungskategorie und Karten je Person.

### Modified Capabilities

- `betroffene-lagedaten`: „Strukturierter Verbleib“ liefert den Versorgungszustand mit; die
  Verbleib-Zählung trennt unterwegs und abgeschlossen; „Lage-Dashboard zeigt Transport“ zählt
  unterwegs/offen/abgeschlossen; Kartenansicht und Liste blenden Abgeschlossene standardmäßig aus.
- `uhs-grundriss`: neue Anforderung an die Zeilen der Listen „Noch nicht aufgenommen“ und
  „Wartebereich“ (Name lesbar, Symbolknopf) und an die rechte Spalte „Unterwegs“ mit
  „Übergabe quittieren“.
- `lagekarte-betroffene`: die Ebene zeigt keine abgeschlossenen Patienten.

## Impact

- **Backend:** Migration (Spalten an `person_verbleib` und Cache-Spalten an `person`), Verbleib-
  Handler (`src/routes/einsatz_person.rs`), neue Route für die Übergabe, `src/person/mod.rs`
  (Zustand, Kurzform, ETB-Text), Vorschlagsabfrage für Transportmittel, Schwärzung der neuen
  Spalten (`src/einsatz/schwaerzung_registry.rs`), Typ-Codegen.
- **Frontend:** `personen/verbleibErfassungKern.ts`, `VerbleibErfassung.tsx`,
  `PatientenkopfPaneele.tsx`, `pages/uhs/Grundriss.tsx`, `pages/PersonenPage.tsx` und
  `personen/personenFilter.ts`, Lage-Dashboard, Lagekarten-Ebene, Offline-Schreibweg
  (`personEintragSpeichern.ts`, neue Aktion `uebergabe`), Anwenderdoku.
- **Regeln:** `frontend/src/personen/AGENTS.md` (Abgeschlossene, Board), Ergänzung der Regel „Kein
  Nutzerschalter Tabelle ↔ Karte“ in `frontend/AGENTS.md` um das Board als Überblick.
