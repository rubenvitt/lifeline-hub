# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/c11mj7y1kq79zaf523tujjyu (LLH-1822)
Zunder: https://zunder.rubeen.dev/#/aufgabe/qick1bpds52stnb0cgwhvw5j (LLH-1827)
Teil von LLH-1812 „Grundmuster: Zustände, Hilfe, Tastatur, Sprache“, Welle 1.

## Why

Ein einziger Datensatz, an dem ein erwartetes Feld fehlt, ersetzt heute die ganze Anwendung
durch die englische Standardseite des Routers („Unexpected Application Error!“ samt Stacktrace).
Kopf, Navigation und Rückweg sind dann weg, und das Modul ist für alle gesperrt, die den
Datensatz sehen. Daneben meldet die Anwendung „gibt es nicht“ auf mindestens fünf Arten. Manche
Seiten zeigen dazu einen Knopf „Erneut abrufen“, obwohl ein neuer Versuch nichts ändern kann,
andere leiten still weiter. Ein Deeplink wie `?meldung=99999` verschwindet sogar ohne jeden
Hinweis.

## What Changes

- **Fehlergrenze je Rahmen:** Wirft eine Seite beim Zeichnen, bleibt der Rahmen stehen: Kopf,
  Rail und Modulleiste im Einsatz, der Rahmen der Ebene 1, die Verwaltung mit ihrem Menü, die
  Hülle eines gekoppelten Geräts. An der Stelle der Seite steht dann „Diese Seite konnte nicht
  angezeigt werden“ mit zwei Auswegen: „Neu laden“ und „Zum Überblick“ (außerhalb des Einsatzes
  „Zur Einsatzliste“, in der Gerätehülle „Zur Startseite“). Englischer Text, Fehlermeldung und
  Stacktrace erscheinen nicht. Ein letztes Netz an der Wurzel fängt Fehler in den Rahmen selbst,
  ebenfalls auf Deutsch.
- **Bericht an den Server:** Jeder gefangene Fehler geht einmal an einen neuen angemeldeten
  Endpunkt `POST /api/client-fehler`. Er enthält das Routenmuster ohne Kennungen, die App-Version
  sowie die gekürzte Meldung samt Stack. Der Server schreibt nur eine gedrosselte Warnzeile ins
  Log. Es gibt keine Tabelle und keine Migration.
- **Ein Muster für „gibt es nicht“:** Jede Detailseite im Einsatzrahmen, deren Objekt es nicht
  (mehr) gibt, zeigt „<Sache> gibt es nicht (mehr)“ mit genau einem Knopf „Zur <Liste>“. Die
  Seite bleibt im Rahmen und zeigt kein „Erneut abrufen“. Ein echter Abruffehler (Netz, 5xx)
  behält „Erneut abrufen“. Stille Weiterleitungen auf die Liste entfallen.
- **Deeplink auf Unbekanntes:** Zeigt ein Query-Parameter-Deeplink (`?meldung=`, `?auftrag=`,
  `?fahrzeug=` …) auf ein Objekt, das es nicht gibt, erscheint über der Liste eine schließbare
  Hinweisleiste, etwa „Meldung #99999 gibt es nicht (mehr)“. Sie verschwindet bei der nächsten
  Wahl. Der Parameter wird wie bisher aus der Adresse geräumt.
- Neue Texte sind unpersönlich formuliert, ohne Du und ohne Sie (Festlegung vom 17.11.2026 für
  das Epic; den Bestand stellt LLH-1830 um).

## Capabilities

### New Capabilities

- `seiten-zustaende`: Wie eine Seite sich verhält, wenn sie nicht gezeigt werden kann. Dazu
  gehören die Fehlergrenze je Rahmen mit dem letzten Netz, der Bericht an den Server und das eine
  Muster für ein Objekt, das es nicht (mehr) gibt, auf Detailseiten und bei Deeplinks.

### Modified Capabilities

- `liste-detail`: Die Anforderung „Deeplink öffnet das Detail“ bekommt den Fall eines Deeplinks
  auf ein Objekt, das es nicht gibt (Hinweisleiste statt Stille).
- `textkontrast-rollen`: Das Szenario „Nicht gefunden auf dem Seitengrund“ beruht auf dem roten
  Text „Befehl nicht gefunden.“. Diesen Text gibt es nach der Änderung nicht mehr, deshalb belegt
  ein anderer roter Fehlertext außerhalb eines Formulars die Anforderung.

## Impact

- **Frontend:**
  - `App.tsx` (Routenbaum: `errorElement` je Rahmen und an der Wurzel)
  - neue Bausteine in `components/` (Fehlergrenze, Nicht-gefunden-Form, Deeplink-Hinweis)
  - `routing/useQueryParamSelektion.ts` und seine 13 Aufrufer
  - die Detailseiten im Einsatzrahmen: Person, Tier, Schaden, UHS, Bereitstellungsraum,
    Lagebericht, Befehl, Betreuungsstelle, Evakuierungsbezirk, Unterkunft; Einheit, Zeitfenster
    und Einsatzkraft stellen auf den gemeinsamen Baustein um
  - `api/` (Bericht)
  - e2e `fehlertext-kontrast.spec.ts`
- **Backend:** neue Route `POST /api/client-fehler` (`src/routes/`, `src/app.rs`) mit
  Body-Grenze, Sitzungspflicht und Sammelzeile aus `log_drossel`. Keine Migration, keine
  Response-DTOs, kein Typ-Codegen.
- **Regeln und Doku:**
  - `frontend/AGENTS.md`: jede Rahmenebene hat eine Fehlergrenze; ein Nicht-gefunden-Muster
  - Architekturdoku Kapitel 8
  - Anwenderkapitel zur Einsatzoberfläche nach Mitänderungsregel
- **Nicht enthalten:**
  - die Ursache des konkreten „rolle“-Absturzes bei Personen (eigener Bug)
  - eine Grenze je Kachel auf Überblick und Lagebild (Folgeaufgabe)
  - die Zustände der Meldungsliste (LLH-1823, ohne Change im selben Branch)
