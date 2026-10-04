# Proposal

## Why

Die Führung braucht je Einsatz zwei Führungsmittel des S6 (FwDV 100 Anlage 2, S. 60,
„Kommunikationskonzept einschließlich Fernmeldeskizze“): einen **Fernmeldeplan** für den Funk und
einen **Kommunikationsplan** für alle übrigen Verbindungen (Telefon, Mobil, Fax, E-Mail, Messenger,
Melder). LFH-848 hat beides gefordert.

Der Fernmeldeplan steht seit LFH-548 (Funkplan) und LFH-625 (Fernmeldeskizze) zum großen Teil:
Er wird aus Sprechgruppen und Zuordnungen abgeleitet, ist druckbar und zeigt seine Lücken. Ihm fehlt
nur die Sicht **je Sprechgruppe**: welche Stellen auf „TMO 311“ arbeiten und wozu der Kanal dient.
Heute muss S6 das aus der Stellentabelle zurückrechnen.

Den Kommunikationsplan gibt es gar nicht. Abschnitte und Einheiten tragen je ein Kommunikationsmittel
und eine Erreichbarkeit (Migrationen 0047, 0086). Für die Einsatzleitung, die Sachgebiete S1–S7, die
Fachberater, die Leitstelle, Behörden und Verbindungspersonen gibt es kein Feld. Diese Nummern
stehen heute auf Papier im ELW. Fällt das Netz aus, braucht man genau diese Liste.

## What Changes

- **Neue Seite „Kommunikationsplan“** unter `/einsaetze/:id/stab/kommunikationsplan`. Einstieg ist
  die S6-Zeile der Stabseite neben „Funkplan“. Kein eigenes Modul, die Seite erbt die Sperre des
  Stabs.
  - **Eine Zeile je Stelle**, gegliedert in Gruppen: Einsatzleitung und Stab, Abschnitte, Einheiten,
    externe Stellen.
  - **Gepflegte Stellen:** Führungsfunktionen aus dem Katalog (EL, S1–S7, Führungshilfspersonal und
    Fachberater mit Bezeichnung) und externe Stellen (Leitstelle, Behörde, Verbindungsperson,
    sonstige). Jede Stelle trägt beliebig viele Verbindungen: Mittel, Rufnummer bzw. Adresse und
    Hinweis.
  - **Abgeleitete Stellen:** Abschnitte und Einheiten mit ihrem vorhandenen Kommunikationsmittel und
    ihrer Erreichbarkeit. Sie werden nicht doppelt gepflegt, ihre Zeile führt zum Datensatz.
  - Die Verbindung hängt an der Stelle, nicht an einer Person. Die aktuelle Besetzung aus dem Stab
    erscheint nur als Nebentext.
  - Rufnummern sind als `tel:`, Adressen als `mailto:` antippbar.
  - Fehlt eine Leitstelle, sagt die Seite das als benannte Lücke.
- **Druck** des Kommunikationsplans als eigenes Druckstück (A4, Druckkopf mit Einsatz und Stand),
  mit Rufnummern. **Keine** Übernahme in den Lagebericht, denn der Plan besteht aus
  Personenbezug.
- **Ohne Netz lesbar:** Der Kommunikationsplan kommt in die Offline-Allowlist (LFH-723). Bearbeiten
  braucht weiter das Netz.
- **Dritte Darstellung des Funkplans „Sprechgruppen“** (`?ansicht=sprechgruppen`): eine Zeile je
  Sprechgruppe des Einsatzes mit Betriebsart, Hinweis (Zweck), Herkunft (Katalog oder einsatzlokal)
  und den teilnehmenden Stellen samt Rufnamen. Rein abgeleitet, dieselben Quellen und Lücken wie
  Tabelle und Skizze.
- **Neue Tabellen** `einsatz_kommunikation_stelle` und `einsatz_kommunikation_verbindung`, beide im
  Schwärzungsregister (Rufnummer, Hinweis und Bezeichnung werden geschwärzt).
- Die eigene Führungsstelle (ELW) bekommt im Kommunikationsplan eine abgeleitete erste Zeile, sobald
  [LFH-849](https://app.clickup.com/t/123zgec5xhy) ihre Felder am Einsatz anlegt. Diese Change legt
  dafür keine eigenen Felder an.

## Capabilities

### New Capabilities

- `stab-kommunikationsplan`: Der Kommunikationsplan des Sachgebiets S6. Er regelt Ort und Einstieg,
  Stellen und Verbindungen, abgeleitete Zeilen, Bearbeitung und Rechte, Personenbezug, Druck,
  Lücke „Leitstelle“ und Lesbarkeit ohne Netz.

### Modified Capabilities

- `stab-funkplan`: neue Darstellung „Sprechgruppen“ (Kanalbelegung) auf derselben Seite.
- `stab-fernmeldeskizze`: Der Umschalter hat drei Stellungen statt zwei („Tabelle | Skizze |
  Sprechgruppen“).
- `lagebild-offline-lesen`: Der Kommunikationsplan gehört zu den ohne Netz lesbaren Daten.

## Impact

- **Backend:** Migration mit den zwei Tabellen (nächste freie Nummer beim Umsetzen, heute 0145;
  LFH-849 legt parallel vermutlich ebenfalls eine an). Neues Modul `src/stab/kommunikation.rs`
  (Repo), Routen in `src/routes/stab.rs` unter `…/stab/kommunikationsplan` mit
  `EinsatzLesezugriff<Stab>` bzw. `EinsatzSchreibzugriff<Stab>`, Live über das bestehende
  `LiveEvent::Stab`. Neue Enums `Stellenart`, `Verbindungsmittel` (Wire-Kontrakt, `api_doc.rs`),
  Schwärzungsregister, Typ-Codegen.
- **Frontend, neu:** `pages/KommunikationsplanPage.tsx`, `stab/kommunikationsplan.ts` (Zeilenmodell,
  Ableitung), `stab/sprechgruppenplan.ts` (Kanalbelegung), `api/kommunikationsplan.ts`, Deeplink
  `kommunikationsplanPfad`, Druck-CSS.
- **Frontend, geändert:** `stab/unterseiten.ts` (zweiter S6-Eintrag), `App.tsx` (Route),
  `pages/FunkplanPage.tsx` und `routing/deeplinks.ts` (`parseFunkplanAnsicht` kennt
  `sprechgruppen`), `api/queryKeys.ts` (Key und `LAGEBILD_OFFLINE`), `datensicht.guard.test.ts`,
  `frontend/src/stab/AGENTS.md`.
- **e2e:** neue Spec für den Kommunikationsplan (Breite, Druck, Bearbeiten, Offline), Gate 1 und
  Gate 3 um die neue Route, Funkplan-Spec um die dritte Darstellung.
- Keine Änderung an Modulfreigaben oder Rollen. Kein ETB-Eintrag je Änderung am Plan.
