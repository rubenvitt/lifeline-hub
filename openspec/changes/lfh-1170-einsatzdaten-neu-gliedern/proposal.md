# Proposal

## Why

Die Seite Einsatzdaten soll auf einen Blick beantworten: Was ist das für ein Einsatz, wo, seit
wann, wer hat gemeldet, wer führt von wo? Heute verteilt sie das über vier Blöcke und zwei
Bearbeitungswege. Einsatznummer und Leitstellen-Nr., die Aktenzeichen, mit denen Leitstelle,
Rückfragen und Einsatzbericht arbeiten, liegen eingeklappt unter „Technische Angaben“. Das
Paneel „Zugriff“ (Mitglieder und Rollen) steht als Verwaltungsaufgabe mitten in den Lagedaten.
Die schmale Lesebreite lässt die Seite anders aussehen als die übrigen Führungsseiten
(Rückmeldung aus dem UX-Durchgang vom 10.10.2026, LFH-1154 → LFH-1170).

## What Changes

- **Seitenkopf:** `meta` zeigt in Mono „Einsatznummer · Leitstellen-Nr.“ (`E-2026-0001 · ILS-4711`),
  ohne Aufklappen. Die Seite nimmt die volle Breite (`breite="voll"`), ab `xl` zweispaltig.
- **Neue Gliederung:** Kopfleiste (Stichwort, Alarmzeit, Einsatzort, Einsatzleitung, unverändert)
  → Paneel „Einsatz“ (Bezeichnung, Einsatzart, Einsatznummer, Leitstellen-Nr., Angelegt, Nächste
  Lagebesprechung bis LFH-1251) → Paneel „Einsatzort“ (Koordinate; Ortssuche und Karte folgen mit
  LFH-1175) → Paneel „Erstmeldung“ (Meldende Stelle, Sachverhalt / Meldebild, Anzahl Betroffene)
  → Paneel „Eigene Führungsstelle“ → Einsatzabschluss.
- **BREAKING (Bedienung):** Der Klappbereich „Technische Angaben“ entfällt.
- **BREAKING (Bedienung):** Das Vollformular „Bearbeiten“ entfällt samt `geaenderteKopfdaten`
  und `FormWerte`. Es gibt einen Bearbeitungsweg: die Zeile. Die Bezeichnung wird eine
  Pflicht-Zeile, die Koordinate eine eigene Zeile, die das Paar `einsatzort_lat`/`einsatzort_lon`
  in einem PATCH sendet.
- **Zugriff wandert in die Einsatz-Einstellungen:** neue Sektion `…/einstellungen/zugriff`
  („Zugriff“, hinter „Geräte“) trägt das bisherige Paneel mit unveränderten Rechten. Auf den
  Einsatzdaten bleibt für die Einsatzleitung ein Nebenweg „Zugriff verwalten ↗“ im Seitenkopf.
- „Einsatzbericht drucken“ geht aus `aktionen` in `weitere` (Nebenweg-Regel, LFH-963).
- Regel `frontend/AGENTS.md` („Inline-Bearbeitung und Status“) und die Anwenderdoku
  (`einsatzdaten.md`, `einsatz-einstellungen.md`, `rechte-im-einsatz.md` samt Bildern) werden
  fortgeschrieben.

## Capabilities

### New Capabilities

- keine

### Modified Capabilities

- `einsatzdaten-bearbeitung`: ein Bearbeitungsweg (Zeile), Bezeichnung und Koordinate als
  Zeile, kein Vollformular, Kennungen im Seitenkopf, Gliederung der Seite.
- `einsatz-zugriff`: der Ort der Verwaltung ist die Einstellungs-Sektion „Zugriff“; die
  Einsatzdaten tragen nur den Sprung dorthin.
- `einsatzkopf-live`: das Szenario „Offenes Bearbeitungsformular“ wird zur offenen Zeile.
- `einsatztauglichkeit-layout`: in der Liste der Bedienziele entfallen auf den Einsatzdaten
  „Bearbeiten“ und der Akkordeon-Kopf „Technische Angaben“; die Einstellungs-Sektion „Zugriff“
  kommt mit ihren Zielen dazu.
- `einsatznummer`: die „Bedienoberfläche“ nennt den Seitenkopf als Ort der Einsatznummer; das
  Szenario spricht von der Zeilenbearbeitung statt vom Formular.

## Impact

- Frontend: `pages/EinsatzdatenPage.tsx` (Umbau), `pages/MitgliederAbschnitt.tsx` (wandert
  unverändert in eine Sektion), neu `pages/einstellungen/EinsatzZugriff.tsx`,
  `routing/deeplinks.ts` (`EinstellungenSektion`, `EINSTELLUNGEN_SEKTIONEN`), `App.tsx`
  (`EINSTELLUNGEN_ROUTEN`), `anzeige/koordinatenFeld.guard.test.ts` (neue bewertete Stelle).
- Tests: `EinsatzdatenPage.test.tsx`, `MitgliederAbschnitt.test.tsx`, Routing-/Deeplink-Tests;
  e2e `einsatzdaten-inline`, `einsatzdaten-schmal`, `einstellungen-schmal`, `einsatzabschluss`,
  `trefflaeche-pruefflaechen`, `einsatzkopf-live` und weitere, die „Bearbeiten“, „Lagedaten“ oder
  „Zugriff“ auf den Einsatzdaten ansprechen; Doku-Bilder `einsatzdaten`, `rechte-im-einsatz`,
  `einsatz-einstellungen`.
- Kein Backend, keine Migration, kein Typ-Codegen: alle Felder gehen schon heute einzeln über
  `PATCH /api/einsaetze/{id}`, die Mitglieder-Routen bleiben.
- Bezüge: LFH-1175 (Ortssuche ersetzt die Koordinatenzeile), LFH-1181 (Führungsstelle),
  LFH-1199 (Einsatzleiter), LFH-1251 (Lagebesprechung übernimmt den Termin), LFH-1141 (shipped,
  Personenauswahl der Einsatzleitung).
