# Proposal

## Why

Ein ETB-Eintrag braucht fachlich einen Absender (Von) und einen Empfänger (An), beim Schreiben
bleiben beide Felder aber meist leer. Im Alltag sind sie fast immer gleich, nämlich der eigene
Rufname, oft für Von und An derselbe. Heute gibt es dafür keinen Standardwert, der Server nimmt
Einträge ohne Von/An an, und rund 25 Kopplungspfade schreiben ETB-Einträge ganz ohne Von/An.
Das Ergebnis sind lückenhafte Einträge (LFH-894, Anwenderwunsch vom 01.10.2026).

## What Changes

- **Standard-Rufname pro Nutzer.** Jede Person legt einen Standard-Absender und einen
  Standard-Empfänger fest, als Benutzer-Präferenz (LFH-391) und damit geräteübergreifend. Die
  Abfrage bietet „Empfänger wie Absender“ an.
- **Abfrage im ETB.** Wer im ETB schreiben darf und noch keinen Standard hat, wird in der
  Erfassung nach dem Rufnamen gefragt. Ist einer gesetzt, steht er sichtbar in der Erfassung und
  lässt sich dort ändern. Die Auswahl bietet Funkrufnamen und Sachgebiete an, Freitext bleibt
  erlaubt.
- **Vorbelegung.** Ein neuer Eintrag trägt den Standard in Von und An, sichtbar als Chips.
  `@Funkrufname` und `/von`, `/an` überschreiben nur für diesen Eintrag; `atZielFeld` bleibt.
- **Von und An werden Pflicht** für jeden neuen Eintrag, den jemand schreibt. Client und Server
  lehnen einen Eintrag ohne Von oder An ab (400). Bestehende Einträge bleiben unverändert.
  **BREAKING** für API-Aufrufer: `POST /api/einsaetze/{id}/etb` ohne `von` oder `an` ist 400.
- **Systemeinträge.** Was ein Modul an Von/An kennt (Meldungsabsender, Auftragsadressat),
  bleibt; eine fehlende Seite bekommt die feste Kennung „System“, an einer Stelle für alle
  Kopplungspfade. *(Empfehlung, Entscheidung beim Auftraggeber angefragt; die Alternativen
  stehen in `design.md`, D5.)*
- **Vorrangregel der An-Vorbelegung** (Führungsstelle → erstes Sachgebiet) belegt nicht mehr
  den Entwurf vor, sondern wird zum ersten Vorschlag der Rufname-Abfrage.
- **Entwürfe** dürfen weiter ohne Von/An gespeichert werden; die Pflicht greift beim Absenden.

## Capabilities

### New Capabilities
- `etb-absender-empfaenger`: Von und An eines ETB-Eintrags: Standard-Rufname je Person,
  Abfrage und Änderung im ETB, Vorbelegung neuer Einträge, Pflicht in Client und Server und das
  Von/An der Einträge, die das System selbst schreibt.

### Modified Capabilities
- `fuehrungsfunktionen`: Die „Vorrangregel der ETB-Vorbelegung“ belegt „An“ nicht mehr vor,
  sondern liefert den ersten Vorschlag für den Standard-Rufnamen.

## Impact

- **Backend:** `src/benutzer_einstellungen/mod.rs` (neuer Schlüssel), `src/routes/etb.rs`
  (Pflichtprüfung), `src/etb/repo.rs` (`einfuegen`: Systemkennung für fehlende Seiten),
  Demo-Szenario und Dev-Seeds (Hand-Einträge mit eigenem Rufnamen). Keine Migration, keine
  Änderung an Response-DTOs.
- **Frontend:** `etb/Schnellerfassung.tsx`, `etb/schnellerfassungModell.ts`,
  `etb/entwuerfe/useEtbEntwuerfe.ts`, `etb/entwuerfe/EtbEntwurfsTabs.tsx`, neuer Hook für den
  Standard (`api/benutzerEinstellungen.ts`, `globalKeys.benutzerEinstellungenVon`),
  `fuehrung/funktionsOptionenKern.ts` (`anVorbelegung` als Vorschlag).
- **Tests:** Jeder Rust-Integrationstest, der `POST …/etb` ohne `von`/`an` schickt, bekommt
  beide Felder. e2e-Specs, die über die Oberfläche ins ETB schreiben, setzen vorher einen
  Standard.
- **Regeln:** `frontend/src/etb/AGENTS.md` (Erfassung), `frontend/src/fuehrung/AGENTS.md`
  (Vorrangregel).
