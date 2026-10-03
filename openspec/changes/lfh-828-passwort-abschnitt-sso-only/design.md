# Design

## Context

Siehe `proposal.md`, „Why“. Für den Weg sind diese Stellen wichtig:

- Ein SSO-only-Konto erkennt man nur am Sentinel `PASSWORT_HASH_SSO_ONLY` in `benutzer.passwort_hash`
  (`src/auth/mod.rs`). Die Spalte ist NOT NULL, eine eigene Spalte gibt es nicht.
- Die Benutzerdarstellung `BenutzerAnzeige` entsteht auf zwei Wegen:
  1. über `Benutzer::anzeige(totp_aktiviert)`, für `me`, `login` und `totp_finish`.
     `Benutzer` trägt `passwort_hash` schon, denn die Session-Auflösung lädt ihn mit.
  2. per `sqlx::query_as::<_, BenutzerAnzeige>` direkt aus SQL, an fünf Stellen in
     `src/routes/benutzer.rs` (`liste`, `anlegen`, `deaktivieren`, `bearbeiten`, `totp_reset`).
     Vier davon lesen dieselbe Spaltenliste mit `WHERE id = ?`.
- Im Client hält `AuthContext` den Benutzer. Er kommt aus `login` (Antwort `BenutzerAnzeige`),
  aus `me` (Erstladen, Prüfung, `aktualisiere` nach Passkey und `totpFinish`). Die Profilseite
  liest ihn über `useAuth()`.

## Goals / Non-Goals

**Goals:**

- Ein Feld `passwort_gesetzt`, das auf jedem Anmeldeweg im `AuthContext` ankommt.
- Der Sentinel-Vergleich steht an einer Stelle in Rust. Der SQL-Weg bindet den Sentinel als
  Parameter, statt den Text ein zweites Mal als Literal zu führen.

**Non-Goals:**

- Den Server-Endpunkt `POST /api/auth/passwort` für SSO-only-Konten ändern (etwa 403 statt 422).
  Er bleibt die Durchsetzung. Die Profilseite bietet ihn nur nicht mehr an.
- Das Feld in der Admin-Benutzerliste anzeigen (etwa eine Spalte „SSO-Konto“). Dafür braucht es
  ein eigenes Ticket, falls jemand es will.
- Für SSO-only-Konten erstmals ein Passwort setzen. Auch das braucht ein eigenes Ticket.

## Decisions

### D1: Das Feld kommt in die gemeinsame `BenutzerAnzeige`, nicht nur auf `/me`

**Gewählt:** `BenutzerAnzeige` bekommt `passwort_gesetzt: bool`. `anzeige()` berechnet es aus
`self.passwort_hash != PASSWORT_HASH_SSO_ONLY`. Die SQL-Abfragen liefern es als
`passwort_hash <> ? AS passwort_gesetzt` mit dem Sentinel als gebundenem Parameter.

**Verworfen, Variante B: eigenes Antwort-DTO nur für `GET /api/auth/me`** (`BenutzerAnzeige`
per `#[serde(flatten)]` plus `passwort_gesetzt`). Die Admin-Liste bliebe dann unberührt. Aber
`login` und `totp_finish` liefern ebenfalls `BenutzerAnzeige` in den `AuthContext`. Nach einem
Passwort-Login fehlte das Feld bis zum nächsten `me`-Abruf. Ein Login mit Passwort hat zwar
immer ein Passwort, aber der Client bräuchte dann zwei Benutzertypen oder einen zusätzlichen
`me`-Abruf nach jedem Login. Das ist mehr Mechanik für weniger Halt.

**Verworfen, Variante C: das Feld aus der Provider-Liste ableiten** (OIDC aktiv ⇒ SSO-Konto).
Die Provider-Liste gilt für den ganzen Server, nicht je Konto. Ein lokales Konto auf einem
Server mit OIDC sähe den Abschnitt dann zu Unrecht nicht.

**Folge:** Admins sehen in den Antworten von `/api/benutzer` künftig, welche Konten SSO-only
sind. Das ist keine neue Information für sie, denn die Konten sind per OIDC entstanden. Der
Hash selbst verlässt den Server weiterhin nicht.

### D2: Eine Hilfsfunktion für die vier gleichen Einzelabfragen in `benutzer.rs`

Vier der fünf `query_as`-Stellen lesen dieselbe Spaltenliste per `WHERE id = ?`. Sie bekommen
eine gemeinsame Hilfsfunktion `anzeige_laden(pool, id)`. Damit steht die neue Spalte samt
gebundenem Sentinel genau zweimal im Code (Liste und Einzelabfrage) und nicht fünfmal.
Wichtig ist die Bind-Reihenfolge: Das `?` in der Spaltenliste steht im SQL-Text vor dem `?` der
`WHERE`-Klausel, deshalb wird der Sentinel zuerst gebunden.

### D3: Die Profilseite verknüpft beide Bedingungen

`passwortAktiv` bleibt die Provider-Frage. Neu kommt
`passwortWechselMoeglich = passwortAktiv && (benutzer?.passwort_gesetzt ?? false)` dazu. Ohne
geladenen Benutzer erscheint der Abschnitt also nicht. Das entspricht der bestehenden Haltung
der Seite: lieber kein Knopf als einer, der nicht wirken kann.

## Risks / Trade-offs

- [Neues Pflichtfeld bricht Frontend-Fixtures, die `BenutzerAnzeige` vollständig ausschreiben] →
  Es sind fünf Stellen (`test/fixtures.ts` und vier Testdateien), `tsc` findet sie alle. Der
  Default in `benutzerFixture` ist `true`, so bleibt jeder bestehende Test bei seinem Verhalten.
- [Sentinel-Text im SQL weicht von der Rust-Konstante ab] → Er wird nie als Literal
  geschrieben, sondern immer aus `PASSWORT_HASH_SSO_ONLY` gebunden. Ein Backend-Test legt ein
  SSO-only-Konto an und prüft `passwort_gesetzt == false` über die Admin-Liste und über `me`.
- [Falsche Bind-Reihenfolge in den SQL-Abfragen] → Derselbe Test prüft auch ein Konto mit
  Passwort (`true`). Eine vertauschte Reihenfolge würde dort rot.

## Migration Plan

Keine Datenmigration. Das Feld kommt zur Antwort hinzu, ältere Clients ignorieren es.
Rollback ist ein Revert des Commits.
