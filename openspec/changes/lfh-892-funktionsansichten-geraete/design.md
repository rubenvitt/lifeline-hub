# Design

## Context

Motivation in `proposal.md`, Abschnitt „Why“. Der Stand, der den Weg vorgibt:

- **Eine Sitzung ist ein Benutzer.** `CurrentUser` (`src/auth/session.rs`) löst das Cookie
  `lifeline_sid` über die Tabelle `session` zu einem aktiven `benutzer` auf, bei jeder Anfrage
  neu. Ablauf fest 7 Tage (`SITZUNG_TAGE`), keine Verlängerung.
- **Jede Einsatzroute läuft durch einen Gate-Extractor** (`src/einsatz/kontext.rs`):
  `EinsatzKontext` (Org-Floor) und darauf `EinsatzLesezugriff<M>`, `EinsatzSchreibzugriff<M>`,
  `EinsatzSchreibfreigabe<M>`, `EinsatzLeitungszugriff<M>`, `EinsatzVerwaltungszugriff`.
  `tests/einsatz_kontext_guard.rs` erzwingt das für jede `/api/einsaetze/{id}/…`-Route und
  prüft den Modul-Marker gegen `PFAD_KEY`.
- **Urheberschaft ist überall eine `benutzer.id`:** `etb_eintrag.erfasser_id NOT NULL`,
  dazu `erfasst_von`, `geaendert_von`, `gesichtet_von` in rund 70 Quelldateien.
- **Rechte je Objekt gibt es nicht.** `uid` einer UHS ist nur eine Zugehörigkeitsprüfung zum
  Einsatz. Sichtung und Verbleib hängen an `personen`, nicht an der UHS; Personen tragen
  `aktuelle_uhs_id`, die Belegungshistorie steht append-only in `person_uhs_belegung`.
- **Live-Kanal** (`GET /api/einsaetze/{id}/live`, SSE) berechnet die erlaubten Module einmal beim
  Verbindungsaufbau und prüft die Sitzung danach nicht mehr. Ein Entzug wirkt heute erst beim
  Neuverbinden.
- **Nächstes Vorbild für eine Kopplung** ist der Einmalcode der Desktop-Hülle (LFH-818,
  `src/auth/huelle/`): kurzlebig, einmalig, gebunden.
- **`bedien-arbeitsplatz`** verbietet, dass ein Arbeitsplatz Rechte gewährt oder das Startziel
  formt. Eine Gerätekopplung ist kein Arbeitsplatz einer Person, braucht aber genau das
  (D10).

## Goals / Non-Goals

**Goals:**

- Ein Gerät arbeitet ohne Personenkonto, nur in seinem Einsatz, seiner Ansicht und seiner Stelle.
- Die Schranke steht auf dem Server und in den bestehenden Gate-Extractoren, nicht nur in der
  Oberfläche. Was die Ansicht nicht nennt, ist verboten.
- Widerruf wirkt sofort, auch auf einen offenen Live-Kanal, und ist im Test nachgewiesen.
- Keine Änderung für Personen, ihre Sitzungen und ihre Rechte.

**Non-Goals:**

- Eine Person, die sich an einem gekoppelten Gerät anmeldet (D2).
- Ansichten für Betreuungsstelle, Bereitstellungsraum, Einsatzabschnitt und Verpflegung. Der
  Katalog ist dafür offen (D4), die Ansichten selbst kommen als eigene Tasks.
- Ein UHS-eigener Stärke-Datensatz. Es gibt ihn heute nicht (`src/staerke.rs` kennt nur
  Einheiten und Personal). Der UHS-Laptop zeigt das, was da ist (D6).
- Fernlöschen eines ausgeschalteten Geräts. Darum speichert ein Gerät kein Lagebild auf der
  Platte (D8).
- Änderungen an der Desktop-Hülle.

## Decisions

### D1 Gerätekonto als `benutzer`-Zeile, Kopplung als eigene Tabelle

Jede Kopplung bekommt ein eigenes **Gerätekonto**: eine Zeile in `benutzer` (Org des Einsatzes,
`passwort_hash` = Sentinel `PASSWORT_HASH_SSO_ONLY`, `system_rolle` `keiner`, `org_rolle`
`keine`, Anzeigename aus Stelle und Gerätebezeichnung, etwa „UHS Nord · Tablet 1“) und eine
Zeile in `geraet_kopplung`, die genau auf dieses Konto zeigt (`benutzer_id UNIQUE`). Damit
laufen alle Fremdschlüssel (`erfasser_id`, `erfasst_von`, …), die Anzeige des Erfassers und die
Bindung `X-Erwarteter-Benutzer-Id` (LFH-387) unverändert weiter.

*Verworfen:* ein eigener Prinzipal-Typ (`Akteur::Benutzer | Akteur::Geraet`). Er träfe rund 200
Handler und jede Urheberspalte samt Migration. *Verworfen:* das Gerät unter dem Konto der
Person laufen lassen, die es ausgibt. Dann schriebe ein Tablet Einträge im Namen einer Person,
die nicht danebensteht, und Widerruf hieße, die Person auszusperren.

*Folge:* Gerätekonten müssen aus allen Personenlisten heraus (Benutzerverwaltung,
Personenauswahl der Führungsorganisation, Mitgliederauswahl) und dürfen sich nie interaktiv
anmelden. Die Listen filtern über `NOT EXISTS (… geraet_kopplung …)`, die Login-Wege (Passwort,
OIDC, WebAuthn, App-Code) lehnen ein Gerätekonto ausdrücklich ab, zusätzlich zum Sentinel.

### D2 Nur „Gerät ohne Person“ in dieser Change

Das Ticket fragt, ob es zwei Varianten braucht. Diese Change baut nur die Gerätekopplung. Eine
Person, die sich anmeldet, behält ihre volle Oberfläche und ihre Rechte aus Rolle, Systemrolle
und Modulfreigabe; eine zusätzliche Verengung je Person widerspräche `bedien-arbeitsplatz`
(„Die Rechteachse bleibt allein zuständig“) und löst kein Problem aus dem Feld: Wer eine Person
anmeldet, will ihre Rechte, wer ein Gerät ausgibt, will die Schranke. Braucht ein Gerät später
eine namentliche Unterschrift (etwa eine Ärztin bestätigt eine Sichtung), wird das ein eigener
Task „Bediener am Gerät“, der die Kopplung nicht ersetzt.

### D3 Kopplung, Code und Gerätesitzung

- **Anlegen** darf nur die Einsatzleitung eines aktiven Einsatzes (`EinsatzLeitungszugriff`),
  in den Einsatzeinstellungen unter „Geräte“ (Modul `einsatz-einstellungen`, nicht
  ausblendbar, darum kein neuer Modul-Key). Pflicht: Ansicht, Bezeichnung, bei UHS-Ansichten
  die UHS. Optional: Ablauf.
- **Kopplungscode:** 8 Zeichen aus einem Alphabet ohne Verwechsler (Crockford-Base32), gültig
  10 Minuten, einmalig, in der DB nur als SHA-256 (wie der Sitzungstoken). Angezeigt als Text
  und als QR mit `https://<server>/koppeln#<code>`; der Code steht im Fragment und landet so
  in keinem Zugriffslog. Einlösen über `POST /api/geraete/koppeln` mit Rate-Limit je IP
  (`src/auth/rate_limit.rs`). Falscher, abgelaufener oder verbrauchter Code: einheitlich 401.
- **Ein Gerät je Kopplung:** Ein neuer Code für dieselbe Kopplung (Gerät getauscht, Browser
  geleert) beendet beim Einlösen alle bisherigen Sitzungen dieser Kopplung.
- **Gerätesitzung:** eine normale Zeile in `session` mit `kopplung_id`. Die Auflösung prüft bei
  jeder Anfrage zusätzlich: Kopplung nicht widerrufen, nicht abgelaufen, Einsatz aktiv. Sonst 401.
- **Ablauf:** Vorgabe 24 Stunden ab Anlage, einstellbar bis höchstens 72 Stunden, verlängerbar
  durch die Einsatzleitung. Mit dem Einsatzabschluss endet jede Kopplung, auch in der
  Nachlauffrist (Geräte lesen nie nach Abschluss). *Verworfen:* „gilt bis Einsatzende“ ohne
  Frist. Ein verlorenes Tablet, das niemand vermisst, bliebe dann tagelang offen.

### D4 Funktionsansicht als feste Scope-Liste im Code

Eine Funktionsansicht ist ein Enum (`uhs-tablet`, `uhs-laptop`, `lagemonitor`) mit einer im Code
festen Tabelle: je Modul-Key *lesen* und/oder *schreiben*, ob die Ansicht an eine Stelle
gebunden ist, welche Einsatzrolle sie trägt (Lagemonitor `beobachter`, UHS-Ansichten
`fuehrungspersonal`) und welche Routen ohne Modul-Marker sie nutzen darf. Die Matrix steht in
`specs/funktionsansichten/spec.md`.

*Verworfen:* frei konfigurierbare Ansichten je Org. Jede Ansicht braucht zugeschnittene
Oberfläche und Stellenfilter im Server; eine Konfiguration ohne beides wäre eine Schranke, die
nur auf dem Papier steht. Neue Ansichten kommen als Code mit Tests.

### D5 Durchsetzung in den Gate-Extractoren, Vorgabe „verboten“

- `EinsatzKontext` trägt zusätzlich `geraet: Option<GeraetKontext>` (Kopplung, Ansicht,
  Stelle). Bei einer Gerätesitzung kommt die Rolle aus der Ansicht, nicht aus
  `einsatz_mitgliedschaft`; ein anderer Einsatz als der gekoppelte ist 404, wie ein
  unbekannter Einsatz.
- `EinsatzLesezugriff<M>` verlangt für Geräte `M ∈ lesen(Ansicht)`, die Schreib-Extractoren
  `M ∈ schreiben(Ansicht)`. `OhneModul` ist für Geräte verboten, außer die Route steht in der
  Ausnahmeliste der Ansicht (Einsatzkopf, `modul-freigaben`, `modul-zaehler`, `live`).
  `EinsatzLeitungszugriff` und `EinsatzVerwaltungszugriff` sind für Geräte immer 403. Die
  bestehende Modulfreigabe gilt zusätzlich: Sperrt die Org ein Modul für Mitglieder ohne
  Führungsrolle, sperrt sie es auch für das Gerät.
- **Außerhalb von `/api/einsaetze/{id}/…`** lehnt `CurrentUser` eine Gerätesitzung mit 403 ab.
  Wenige Routen ziehen stattdessen einen eigenen Extractor, der Geräte zulässt (`/api/auth/me`,
  `/api/auth/logout`, die lesenden Kartengrundlagen unter `/api/karte/` wie Konfiguration,
  Kacheln, Schriften, Sprites und Proxy, sowie `GET /api/organisation` für das Branding). Ein Guard-Test neben
  `einsatz_kontext_guard.rs` hält beide Listen gegen `app.rs`.
- **Stellenbindung im Handler, über einen Helfer:** Routen mit `{uid}` vergleichen gegen die
  Stelle der Kopplung (fremde UHS: 404, damit der Statuscode nichts verrät). Listen filtern auf
  die eigene Stelle. Personen sind für ein UHS-Gerät sichtbar, wenn sie mindestens eine Belegung
  in der eigenen UHS haben (auch nach dem Austritt, für den Verbleib).
- *Verworfen:* Schranke nur in der Oberfläche. Ein Gerät liegt unbeaufsichtigt im Feld; wer es
  in die Hand bekommt, hat die Entwicklerwerkzeuge des Browsers.

### D6 Zuschnitt der drei Ansichten

- **UHS-Tablet:** Aufnahme, Patientenliste der eigenen UHS, Sichtung, Verbleib, Notizen,
  Belegung (Eintritt, Wechsel innerhalb der eigenen UHS, Austritt), Platzverfügbarkeit,
  Grundriss lesen. Eine Aufnahme vom Gerät legt die Person an **und** bucht sie im selben
  Schritt in den Eingang der eigenen UHS. Sonst wäre die neue Person für das Gerät gleich wieder
  unsichtbar (D5).
- **UHS-Laptop:** alles vom Tablet, dazu Grundriss bearbeiten (Plätze anlegen, ändern,
  stornieren), Stammdaten der eigenen UHS ändern (nicht Status, nicht stornieren), Anhänge der
  eigenen UHS, Material der eigenen UHS lesen, Meldungen an die Einsatzleitung schreiben und die
  eigenen lesen. Eine „Stärke“ der UHS gibt es nicht als Datensatz; der Laptop zeigt Plätze,
  Belegung und Material. Ein Stärke-Datensatz wäre ein eigener Task.
- **Lagemonitor:** nur lesen, keine personenbezogenen Daten. Er bekommt einen eigenen
  Lese-Endpunkt `GET /api/einsaetze/{id}/lagemonitor` mit verdichteten Zahlen (Kopfzahlen,
  Belegung je UHS als Zahl, Kräftesummen, Datenstand) statt der Personen-, Personal- und
  UHS-Detaillisten. Dazu die Lagekarte ohne personenbezogene Ebenen. *Verworfen:* den Monitor
  die Listen des Lage-Dashboards lesen lassen. Die tragen Namen und Personenbezüge, die an einer
  Wand im Führungsraum nichts zu suchen haben.

### D7 Widerruf wirkt sofort, auch im Live-Kanal

HTTP ist sofort, weil jede Anfrage die Sitzung samt Kopplung neu auflöst (D3). Für den
Live-Kanal hält der Server einen prozessweiten Broadcast „Kopplung beendet“ (Widerruf, neuer
Code, Ablauf, Einsatzabschluss). Ein Strom mit `kopplung_id` beendet sich, sobald seine Kopplung
dort auftaucht, und prüft sie zusätzlich bei jedem Keep-alive. Nachweis in einem
Integrationstest: Strom offen, Widerruf, Strom zu, nächste Anfrage 401. Personenströme bleiben,
wie sie sind.

### D8 Offline nur im Speicher, nie auf der Platte

Ein Gerät persistiert kein Lagebild (`lagebild-offline-lesen`, LFH-723): ein verlorenes,
ausgeschaltetes Tablet ließe sich nicht mehr leeren. Der Abfragecache im Speicher trägt eine
kurze Netzlücke, solange die Seite offen ist. Die Offline-Warteschlange für Schreibvorgänge
(LFH-705) bleibt für UHS-Geräte an, denn eine Aufnahme ohne Netz darf nicht verloren gehen; sie
ist an das Gerätekonto gebunden, und nach einem Widerruf scheitert ihr Abgleich mit 401 und
bleibt als Beweissicherung liegen, wie heute.

### D9 Eigene Hülle, vorhandene Flächen

`frontend/src/geraet/` bekommt eine eigene Hülle (`GeraeteLayout`) statt des
`EinsatzLayout`: keine Modulleiste, keine Sprungpalette, kein Benutzermenü, sondern ein
Gerätemenü (Helligkeit, Dichte, „Gerät abmelden“). Die Inhalte nutzen die vorhandenen Flächen
weiter (Aufnahme-Route, UHS-Detail mit Grundriss, Sichtung, Verbleib) und verbergen nur deren
Sprünge in fremde Module. Eine Gerätesitzung, die eine Route außerhalb ihrer Ansicht öffnet,
landet auf der Startseite der Ansicht. Ein 401 zeigt „Kopplung beendet“ statt der Anmeldung.

### D10 `bedien-arbeitsplatz` bekommt die Gerätekopplung als Rechtequelle

Die Kopplung gewährt nichts über die Ansicht hinaus und gilt nur für Gerätekonten. Für Personen
ändert sich keine Anforderung. Die beiden betroffenen Requirements nennen die Kopplung künftig
ausdrücklich, statt sie als Ausnahme im Code zu verstecken.

## Risks / Trade-offs

- [Ein vergessener Listenfilter zeigt Gerätekonten als Personen] → Filter als ein gemeinsames
  SQL-Fragment; Test, der für jede Personen-Auswahlroute ein Gerätekonto anlegt und es dort
  nicht findet.
- [Eine neue Einsatzroute ohne Modul-Marker wäre für Geräte offen] → Vorgabe „verboten“ im
  Extractor; der Guard-Test kennt die Ausnahmeliste und schlägt bei jeder neuen Route an, die
  ein Gerät erreicht.
- [Stellenfilter in Handlern kann vergessen werden] → Helfer `fordere_stelle(uid)` und je
  UHS- und Personenroute ein Test mit fremder UHS (404).
- [Modulfreigabe der Org sperrt ein Modul, das die Ansicht braucht] → Die Kopplungsmaske prüft
  beim Anlegen, ob alle Module der Ansicht für einfache Mitglieder frei sind, und sagt sonst,
  welche fehlen.
- [Eine Person meldet sich im selben Browser an] → Das Cookie wird ersetzt, die Gerätesitzung
  ist weg. Neu koppeln mit neuem Code; die Kopplung selbst bleibt.
- [Wake Lock und Vollbild fehlen in manchen Browsern] → Der Monitor zeigt dann einen Hinweis,
  den Bildschirmschoner am Gerät abzuschalten, und läuft weiter.

## Migration Plan

Neue Tabellen und eine nullbare Spalte `session.kopplung_id`, angehängt nach der höchsten
Nummer auf `alpha` (`scripts/check-migrationen.sh`). Bestehende Sitzungen haben `NULL` und
bleiben Personensitzungen. Rücknahme: Kopplungsmaske ausblenden und alle Kopplungen
widerrufen; die Tabellen dürfen stehen bleiben.

## Open Questions

- Soll der QR später zusätzlich `lifeline://koppeln?server=…` für die Desktop-Hülle tragen?
  Ändert weder Spec noch Schnitt; erst, wenn Laptops mit der Hülle gekoppelt werden.
