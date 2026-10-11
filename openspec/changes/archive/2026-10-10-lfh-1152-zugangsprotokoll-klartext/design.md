# Design

## Context

Siehe `proposal.md` (Why). Stand im Code:

- **Anmeldeweg.** `auth_audit.provider` ist `TEXT NOT NULL` ohne CHECK. Geschrieben werden die
  Registry-Kennungen `auth::provider::ID_*` (`passwort`, `dev`, `oidc`, `webauthn`) und drei
  modul-eigene Konstanten: `auth::totp::PROVIDER = "totp"`, `geraet::PROVIDER = "geraetecode"`,
  `auth::huelle::PROVIDER = "systembrowser"`. Die API liefert `provider: String`; das Frontend
  übersetzt mit einer offenen Map (`zugangsprotokollText.ts`, Rückfall auf die Kennung).
- **Sitzung.** `session` trägt seit LFH-1092 `geraet`, aber keinen Anmeldeweg. Personensitzungen
  entstehen in `auth::session::anlegen` (sechs Aufrufe in `routes/auth.rs`: Passwort, SSO,
  Passkey zweimal, zweiter Faktor, Mac-App), Gerätesitzungen in `anlegen_geraet`. Logout
  (`routes/auth.rs`) und `routes/sitzung.rs::nach_dem_beenden` schreiben fest `ID_PASSWORT`.
- **Detail.** `admin_audit.detail` ist freier Text. Nur zwei Stellen schreiben ihn:
  `routes/benutzer.rs` (Anlage: `system_rolle: …, org_rolle: …`; Rollenwechsel:
  `org_rolle: keine → fuehrungskraft`) und `routes/sitzung.rs` (`<Gerät>, angemeldet <UTC>`).
  Das Frontend zeigt die Spalte „Zeitpunkt“ als taktische DTG in der Zone der Organisation
  (`ZeitAnzeige`, `anzeige/format.ts`); BOS-Zeiten sind 24-Stunden, das 12h-Setting gilt dort
  nicht.
- **Kontofilter.** `auth/audit.rs` und `auth/admin_audit.rs` vergleichen `= ? COLLATE NOCASE`.
  Das Kontofeld der Seite meldet getippten Text entprellt (300 ms) an die URL, die Liste lädt
  neu und findet bei einem halben Namen nichts.
- Aufbewahrung: Anmeldespur 90 Tage, Admin-Spur 365 Tage, Sitzung höchstens 7 Tage.

## Goals / Non-Goals

**Goals:**

- Keine interne Kennung und keine UTC-Zeit mehr in neuen Einträgen des Zugangsprotokolls.
- Ein neuer Anmeldeweg im Backend bricht den Typecheck im Frontend (wie Ereignis und Aktion).
- Abmeldung und „Sitzung beendet“ nennen den tatsächlichen Anmeldeweg oder ehrlich „—“.

**Non-Goals:**

- Altbestand in `auth_audit` und `admin_audit` umschreiben (D5).
- Den Anmeldeweg in der Sitzungsliste (Profil und Benutzer-Dialog, LFH-1092) zeigen. Die Spalte
  macht das später billig möglich; das ist ein eigener Task.
- Das 12h-Zeitformat ins Zugangsprotokoll tragen: die Spalte „Zeitpunkt“ folgt ihm heute nicht,
  das Detail folgt der Spalte.

## Decisions

### D1 Anmeldeweg als geschlossenes Enum

Ein `wire_enum!` `Anmeldeweg` in `auth::provider` mit allen acht Werten: `passwort`, `dev`,
`oidc`, `webauthn`, `totp`, `geraetecode`, `systembrowser`, `unbekannt`. Es ist Schema-Anker für
`AnmeldeEintragAnzeige.provider` (`#[schema(value_type = Anmeldeweg)]`, Spalte bleibt `String`,
wie bei `ereignis`). Die bestehenden `&str`-Konstanten bleiben; ein Test beweist, dass jede
geschriebene Konstante als `Anmeldeweg` parst, ein zweiter, dass jede Variante einen Klartext im
Frontend hat — den trägt der Typecheck des exhaustiven `Record<Anmeldeweg, string>`.

`anmeldewegText(id: string)` bleibt für die Spalte „Ziel“ der Admin-Spur (Registry-Kennungen,
Teilmenge) und liest dieselbe Map; ein unbekannter Wert dort wird „—“ statt roh.

Klartexte: Passwort, SSO, Passkey, Entwicklung, Zweiter Faktor, Gerätecode, Mac-App, „—“.

*Alternative:* nur die Map im Frontend um drei Einträge ergänzen. Verworfen: genau so ist der
Fehler entstanden, beim nächsten Anmeldeweg wieder.

### D2 Die Sitzung merkt sich ihren Anmeldeweg

Neue Migration (nächste freie Nummer nach `origin/alpha`, `scripts/check-migrationen.sh`):
`ALTER TABLE session ADD COLUMN anmeldeweg TEXT` — nullable, kein CHECK (die Werte prüft das
Enum beim Schreiben, ein Altbestand-NULL bleibt erlaubt).

- `session::anlegen(pool, benutzer_id, geraet, anmeldeweg: Anmeldeweg)`. Regel: **die Sitzung
  trägt den Anmeldeweg ihres `login_ok`-Eintrags.** Mit zweitem Faktor ist das `totp`, über die
  Mac-App `systembrowser`. `anlegen_geraet` schreibt `geraetecode`.
- Logout: der Nachschlag vor dem Löschen (`benutzer_id_zu_token`) liefert zusätzlich den
  Anmeldeweg; `BeendeteSitzung` bekommt das Feld `anmeldeweg`.
- Fehlt der Wert (Sitzung von vor dem Update, Token ohne Sitzung), schreibt die Spur
  `unbekannt`, das Frontend zeigt „—“.

*Alternative A:* bei Abmeldung und Beenden immer „—“. Verworfen: die Information ist für einen
Admin wertvoll („wurde die Passkey-Sitzung beendet?“), und die Spalte kostet nach LFH-1092
(`geraet`) nur eine Migration und einen Parameter.
*Alternative B:* `auth_audit.provider` nullable machen statt `unbekannt`. Verworfen: SQLite
braucht dafür einen Tabellenneubau der Audit-Tabelle; der Sentinel ist im Enum sichtbar und
typgeprüft.

### D3 Detail strukturiert, Klartext im Frontend

Die drei Schreiber legen in `admin_audit.detail` statt Prosa ein JSON ab, eine flache Struktur
`ZugangsAngaben` mit optionalen Feldern; welche stehen, folgt aus der Aktion:

- `benutzer_angelegt`: `system_rolle`, `org_rolle`
- `rolle_geaendert`: je geänderter Rolle `…_vorher` und die neue
- `sitzung_beendet`: `geraet?`, `angemeldet_at` (UTC, SQLite-Format wie `zeitpunkt`)

Flach statt eines mit `art` getaggten Enums (so noch im ersten Entwurf): im Projekt gibt es kein
getaggtes Serde-Enum, und der Enum-Wächter (`tests/enum_wire_kontrakt.rs`) erwartet für jedes
registrierte Enum feldlose Varianten. Die Aktion steht ohnehin in derselben Zeile.

Beim Lesen versucht `admin_audit::liste`, `detail` als `ZugangsAngaben` zu lesen (ein leeres
Objekt zählt nicht). Gelingt es,
steht es im neuen Antwortfeld `angaben`, und `detail` fehlt; sonst bleibt `detail` der Text
(Altbestand). Das Frontend rendert `angaben`: Rollen mit den Bezeichnungen des
Benutzer-Dialogs (die wandern aus `pages/BenutzerPage.tsx` als exhaustive `Record<SystemRolle>`
bzw. `Record<OrgRolle>` nach `stammdaten/rechteText.ts`; der Dialog hängt bei „Führungskraft“
weiter seinen Hinweis an), den Zeitpunkt über `ZeitAnzeige` wie die Spalte „Zeitpunkt“.

*Alternative K:* Klartext beim Schreiben im Server. Verworfen: Rust müsste die Rollennamen des
Dialogs und die taktische DTG ein zweites Mal führen (Drift), und der Text fröre Zone und
Bezeichnung zum Schreibzeitpunkt ein.
*Alternative S:* eigene Spalten in `admin_audit`. Verworfen: Tabellenneubau für drei Aktionen;
das Detail ist schon die Stelle dafür.

### D4 Kontofilter als Teiltreffer

Beide Spuren vergleichen `instr(lower(<spalte>), lower(?)) > 0` statt `= ? COLLATE NOCASE`.
`lower()` und `NOCASE` falten in SQLite beide nur ASCII, die Schreibweisen-Regel ändert sich
also nicht. `instr` statt `LIKE`, weil `%` und `_` in Benutzernamen sonst Platzhalter wären.

Der Route kürzt den Filter nicht mehr wie beim Schreiben (64 Zeichen plus „…“), sondern nur
noch auf 64 Zeichen ohne „…“: so findet auch ein längerer getippter Name den gekürzt
gespeicherten. Die Admin-Spur trifft weiter handelnde Person und Zielkonto, nie einen
Anmeldeweg (`ziel_benutzer_id IS NOT NULL`). Das Frontend bleibt, wie es ist.

*Alternative:* das Kontofeld meldet erst bei Auswahl oder Enter. Verworfen: der Admin kennt
nicht jeden Namen ganz, und die Vorschläge zeigen nur bestehende Konten, keine versuchten Namen.

### D5 Altbestand bleibt

Bestehende Zeilen werden nicht umgeschrieben: beide Tabellen sind als Nachweis gedacht
(„revisionssicher“, `auth/audit.rs`), und eine Migration, die Spureinträge ändert, ist genau das
Muster, das die Spur ausschließen soll. Folge: alte Abmeldungen zeigen bis zu 90 Tage weiter
„Passwort“, alte Details bis zu 365 Tage den Rohtext. Die Anwenderdoku nennt das.

## Risks / Trade-offs

- [Ein freier Detailtext, der zufällig gültiges `ZugangsAngaben`-JSON ist] → es gibt heute keinen
  anderen Schreiber; der Test der Leseseite deckt Rohtext und kaputtes JSON ab.
- [Teiltreffer über `instr` nutzt keinen Index] → die Tabellen sind durch die Fristen klein; der
  Kontofilter lief schon vorher über eine Unterabfrage ohne Index.
- [Eine vergessene `session::anlegen`-Stelle] → der Parameter ist Pflicht, der Compiler findet
  jede Stelle; je Anmeldeweg ein Test, der nach Anmeldung und Abmeldung den Weg in der Spur prüft.
- [Altbestand zeigt weiter falsche bzw. rohe Werte] → läuft mit den Fristen aus, Doku nennt es.

## Migration Plan

Eine additive Migration (`session.anmeldeweg`), kein Neubau. Rückweg: die Spalte bleibt
ungenutzt stehen; die API-Felder sind additiv (`angaben` optional, `provider` behält seine
Werte). Typ-Codegen (`scripts/check-typ-codegen.sh`) im selben Commit wie die DTO-Änderung.
