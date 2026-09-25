# Proposal

## Why

Lagebericht, Befehl und Meldebild lassen sich drucken, aber das Druckmuster
(`visibility: hidden` für alles, Druckbereich `position: absolute`) ist nur in Chromium
belastbar. Firefox und Safari schneiden einen absolut positionierten Druckbereich nach der
ersten Seite ab (LFH-71). Der Auftraggeber hat am 24.09.2026 entschieden, dass alle drei
Browser sicher drucken müssen. Dazu kommt: Das Einsatztagebuch, die wichtigste Unterlage der
Einsatznachbereitung, hat gar keinen Druckweg (LFH-22). Kein Ausdruck nennt die
Organisation, und deren Name lässt sich nur beim ersten Start per Konfiguration setzen.

## What Changes

- **Druck im normalen Fluss (LFH-71):** Die Druckbereiche von Lagebericht, Befehl und
  Meldebild stehen im Ausdruck im normalen Dokumentfluss. App-Rahmen (Kopfleiste, Rail,
  Modulpanel, Hinweisbanner) und schwebende Ebenen (Dialoge, Meldungen, Menüs, Drawer)
  werden ausgeblendet, ohne Platz zu belegen. Mehrseitige Dokumente drucken in Chromium,
  Firefox und Safari vollständig.
- **Umbruchregeln:** Abschnittstitel bleiben bei ihrem Text. Absätze, Listen, Zitate,
  Tabellenzeilen und Codeblöcke werden nicht zerrissen. Tabellenköpfe wiederholen sich je
  Seite. Die Regeln gelten im Lese- **und** im Entwurfszweig.
- **Gemeinsamer Druckkopf:** Ein Druckkopf trägt Organisation (Name, Logo),
  Dokumenttitel, Einsatz (Bezeichnung, Einsatznummer), Stand bzw. Auswahl, Ersteller und
  Druckzeitpunkt. Meldebild, Befehl und Lagebericht stellen darauf um; der Meldebild-eigene
  Kopf entfällt. Eine Seitenzählung im Seitenfuß kommt dort, wo der Browser sie trägt.
- **ETB-Druckansicht (LFH-22):** Eigene Ansicht des Einsatztagebuchs für Papier und PDF
  über den Druckdialog des Browsers. Sie lädt **alle** Einträge der aktiven Auswahl,
  übernimmt den Filter aus der ETB-Adresse und nennt ihn im Kopf. Berichtigungen und
  Nachträge sind sichtbar, Zeiten stehen in der Zeitzone der Organisation. Ein
  unvollständiger Ausdruck ist ausgeschlossen. Das ETB bekommt dafür „Drucken / als PDF“.
- **Org-Branding:** Admins ändern den Namen der Organisation in der Verwaltung und laden
  ein Logo hoch (PNG/JPEG, Größenlimit, Virenscan) oder entfernen es. Alle angemeldeten
  Nutzer der Organisation lesen Name und Logo. Das Logo ist eine org-weite Ablage und
  hängt an keinem Einsatz.
- **Kein Server-PDF.** Die bestehende Entscheidung „Browser-Print“ (Lagebericht-Spec,
  Entscheidung 5) gilt jetzt querschnittlich für alle Druckstücke.
- **Prüfliste Einsatztauglichkeit** für die ETB-Druckansicht und die umgebauten
  Druckansichten.

**Nicht-Ziele (Folgetickets):** Einsatzbericht als neue Vorlage (**LFH-726**), Druck der
Modul-Listen (Personen, Tiere, Schäden) samt Frage nach Audit (**LFH-727**), Oberfläche für
die vorhandenen CSV-Exporte (**LFH-728**), serverseitig erzeugte oder automatisch abgelegte
PDFs, Anschrift im Branding, Audit von Druckvorgängen.

**Benannte Reste mit Zielticket:** Druck in Firefox und WebKit automatisch prüfen, dazu Logo
und Seitenzählung im PDF belegen (**LFH-729**); Kontrast der ETB-Druckansicht am Bildschirm
messen (**LFH-730**); im Entwurfsdruck stehen Titel und Zeitstand noch als Eingabefelder
(**LFH-731**).

## Capabilities

### New Capabilities

- `druck-dokumente`: Wie ein Druckstück der App auf Papier kommt, also Druck im normalen
  Fluss in allen drei Browsern, Ausblendung von Rahmen und schwebenden Ebenen,
  Umbruchregeln im Lese- und Entwurfszweig und der gemeinsame Druckkopf (für Lagebericht,
  Befehl, Meldebild und den ETB-Druck).
- `etb-druck`: Die Druckansicht des Einsatztagebuchs mit Vollabruf der Auswahl,
  Filterübernahme und Nennung im Kopf, Ordnung nach laufender Nummer, sichtbaren
  Berichtigungen und Nachträgen, Zeiten in der Org-Zeitzone und dem Ausschluss
  unvollständiger Ausdrucke.
- `org-branding`: Name und Logo der Organisation, also Ändern durch Admins, Upload mit
  Formatprüfung, Größenlimit und Virenscan, Entfernen, Lesen durch alle Nutzer der
  eigenen Organisation und die Trennung zwischen Organisationen.

### Modified Capabilities

(keine: `lagekarte-fachebenen` ist nicht berührt)

## Impact

- **Datenbank:** eine neue Migration mit der Tabelle `org_logo` (org-weit, ein Logo je
  Organisation). Die Nummer ist größer als die höchste auf `origin/alpha` (heute `0120`),
  geprüft mit `scripts/check-migrationen.sh`. `organisation` selbst bleibt unverändert.
- **Backend:** `src/routes/organisation.rs` (PATCH nimmt `name`, neue Logo-Routen),
  `src/app.rs`, `src/api_doc.rs`, Wiederverwendung von `anhang::scan` und der
  PNG/JPEG-Erkennung aus `karte_hintergrundbild`. Der ETB-Druck braucht **keinen** neuen
  Endpunkt: Er liest über die bestehende Liste mit denselben Gates und demselben Filter.
- **API:** `PATCH /api/organisation` nimmt zusätzlich `name` (beide Felder optional,
  abwärtskompatibel); neu sind `GET|POST|DELETE /api/organisation/logo`;
  `OrganisationAnzeige` trägt die Logo-Metadaten. Codegen (`openapi.json`,
  `types.generated.ts`) wird mitgeführt.
- **Frontend:** ein neues gemeinsames Druck-Stylesheet samt Druckkopf-Baustein; die drei
  bestehenden `*Print.css` und ihre Tests; `LageberichtDetailPage`, `BefehlDetailPage`,
  `KraefteuebersichtPage`, `EtbPage`; eine neue Route `etb/druck`, `etbDruckPfad` in
  `routing/deeplinks.ts`, ein nicht-live Query-Key; `stammdaten/OrganisationTab.tsx` und
  `api/organisation.ts`.
- **Tests:** Vitest-Quelltests für die Druck-CSS, Seiten- und Hooktests, Rust-Tests für
  Organisation und Logo, e2e mit `emulateMedia('print')` und `page.pdf()` (nur Chromium;
  Firefox und Safari werden von Hand geprüft).
- **Abhängigkeiten:** keine neuen.
- **Schwärzung:** nicht betroffen. Das Logo ist org-weit und liegt außerhalb der
  einsatzbezogenen Tabellenmenge; ein Test hält das fest.
