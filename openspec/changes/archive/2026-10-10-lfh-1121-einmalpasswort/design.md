# Design

## Context

Zur Motivation siehe `proposal.md`, „Why“. Für den Weg sind diese Stellen wichtig:

- **Passwort-Login** (`src/routes/auth.rs`, `login`). Nach `passwort_pruefen` verzweigt der Handler auf
  `totp_aktiviert`, und zwar **vor** `session::anlegen`.
  - Ein TOTP-Konto bekommt keine Sitzung, sondern einen Schlüssel im Pending-Speicher
    `auth/totp/state.rs` (`BegrenzterAblaufSpeicher`, 5 min, einmal entnehmbar) und das
    HttpOnly-Cookie `mfa_pending` auf dem Pfad `/api/auth`.
  - `totp_finish`/`totp_pruefen` entnehmen den Schlüssel, laden das Konto frisch und legen am Ende
    die Sitzung an.
  - `LoginAntwort` ist `#[serde(untagged)]` und steht nicht im Codegen. Die Union im Frontend ist
    handgepflegt (`api/auth.ts`).
- **Admin-Routen** in `src/routes/benutzer.rs`.
  - Vorlage ist `totp_reset`: Transaktion mit `session::alle_loeschen`, nach dem Commit
    `live.melde_sitzung_ende` und `admin_audit::schreibe`.
  - `totp_reset` prüft weder die Organisation noch das eigene Konto. `routes/sitzung.rs` prüft
    beides (`WHERE id = ? AND org_id = ?` → 404).
- **Admin-Spur:** `AdminAktion` und der CHECK in `admin_audit` müssen zusammenpassen. Eine neue Aktion
  braucht deshalb eine Migration mit Neuaufbau der Tabelle (Muster `0170`, `-- no-transaction`) und
  einen Eintrag in `tests/enum_wire_kontrakt.rs` (`src/AGENTS.md`, Admin-Spur).
- **Client** (`auth/AuthContext.tsx`, `login`).
  - Bei Erfolg laufen nacheinander `vorhaltungAnmelden` (Offline-Schnappschuss), `uebernimm` und
    `meldeAuthWechsel('angemeldet')`. Andere Tabs übernehmen den Benutzer dann über `pruefe`.
  - Der TOTP-Schritt bleibt davor stehen (`{status:'mfa_erforderlich'}`) und rendert auf
    `LoginPage` ein eigenes Formular.
- **Testhelfer.**
  - `tests/common/mod.rs::benutzer_anlegen` legt per `POST /api/benutzer` mit dem Passwort
    `{name}pw1` an (274 Aufrufer). Die Aufrufer melden sich danach per `login_cookie` an, und das
    erwartet 200 samt Cookie.
  - Die e2e-Specs legen Konten ebenso per API an (rund 12 Dateien).

## Goals / Non-Goals

**Goals:**

- Bis zum Festlegen des neuen Passworts gibt es keine Sitzung. Der Client übernimmt niemanden, und es
  entsteht kein Offline-Schnappschuss und keine Tab-Übernahme.
- Das Einmalpasswort berührt nur die Antwort an den Admin. Es steht in keinem Log, keiner Spur und
  keinem Cache.
- Bestehende Tests bleiben inhaltlich unverändert. Den Erstwechsel erledigen die Helfer.

**Non-Goals:**

- Eine Ablaufzeit für das Einmalpasswort. Es gilt, bis es benutzt und gewechselt ist. Bei Bedarf
  kommt eine Frist in ein eigenes Ticket.
- Ein Zwang für Passkey, SSO und App-Code (Entscheidung des Menschen).
- Ein Server-generiertes Passwort bei „Benutzer anlegen“: Die Anlage behält ihr Passwortfeld (D6).
- Die fehlende Organisationsprüfung in `totp_reset` und die fehlende Oberfläche für den
  TOTP-Reset. Beides wird als eigenes Ticket erfasst und hier nicht mitgezogen.
- Eine Anzeige „Einmalpasswort offen“ in der Benutzerliste.

## Decisions

### D1: Der Zwischenzustand hat keine Sitzung (TOTP-Muster)

**Gewählt:** Der Passwort-Login auf ein Konto mit `passwort_wechsel_pflicht = 1` ergibt keine Sitzung.
Er legt einen Schlüssel in einen neuen Pending-Speicher `auth/passwort_wechsel.rs` (dort steht auch der Erzeuger aus D5). Das ist
dasselbe Muster wie `totp/state.rs`: `BegrenzterAblaufSpeicher`, TTL 10 min, Obergrenze wie dort.
Der Eintrag hält die `benutzer_id` **und den Passwort-Hash zum Zeitpunkt der Prüfung** (D3, Schritt
7). Dazu setzt er das HttpOnly-Cookie `passwort_wechsel` (Lax, Pfad `/api/auth`, `Secure` nach
Transport). Die Antwort ist die neue untagged Variante
`LoginAntwort::PasswortWechselErforderlich { passwort_wechsel_erforderlich: true }`.

**Verworfen, Variante B: Sitzung mit Sperrflag.** Der Login legt eine Sitzung an, `/me` meldet den
Zwang, und `CurrentUser` sperrt jede Route außer einer Positivliste.

- Der Client hielte die Person dann für angemeldet: `vorhaltungAnmelden` schreibt den
  Offline-Schnappschuss, `meldeAuthWechsel` lässt andere Tabs übernehmen, und die Offline-Identität
  gälte 24 h.
- `RequireAuth`, `AppAnmeldungPage` und die Offline-Schicht müssten den Zwang zusätzlich verstehen.
- Die Positivliste in `CurrentUser` wäre eine neue Stelle, die jede künftige Route kennen muss.
- Variante A braucht nichts davon: Ohne Sitzung gibt es nichts zu sperren.

**Folge:** Ein Neustart des Servers verwirft offene Zwischenschritte. Die Person meldet sich dann noch
einmal mit dem Einmalpasswort an, und das gilt weiter, bis es gewechselt ist.

### D2: Bei TOTP lautet die Reihenfolge Passwort → TOTP → Wechsel

Der TOTP-Zweig von `login` bleibt unverändert. `totp_pruefen` liefert künftig das Konto, aber noch
keine Sitzung. `totp_finish` prüft danach den Zwang:

- Steht er an, legt `totp_finish` den Schlüssel in den Wechsel-Speicher, setzt das Cookie, räumt
  `mfa_pending` und antwortet `{"passwort_wechsel_erforderlich": true}`.
- Sonst legt es wie bisher die Sitzung an.

Die Antwort von `totp_finish` wird dafür ein untagged Enum wie `LoginAntwort`, weiterhin außerhalb
des Codegens. Der TOTP-Zwischenspeicher (`auth/totp/state.rs`) hält dafür neben der `benutzer_id` den
geprüften Passwort-Hash; hat er sich bis zum Code geändert (ein neues Einmalpasswort), antwortet
`totp_finish` mit 401 (Befund aus dem Review). Erst nach bestandenem zweitem Faktor darf jemand ein
neues Passwort setzen. Sonst
reichte das Einmalpasswort allein, um den Zugang zu übernehmen.

**Audit:** Der TOTP-Erfolg schreibt wie bisher seinen Eintrag über `audit_anmeldung`, also `login_ok`
mit Provider `totp`. Das Festlegen schreibt danach `passwort_geaendert`. Ohne TOTP schreibt das
Festlegen `passwort_geaendert` und `login_ok` mit Provider `passwort`.

**Fehlversuche:** Hat das Konto kein TOTP, räumt schon der bestandene Passwortschritt die
Fehlversuche (`rate_limit::erfolg`), denn danach gibt es kein ratbares Geheimnis mehr. Das Cookie
trägt 256 Bit.

### D3: `POST /api/auth/passwort/festlegen` mit Body `{ "neues_passwort": "…" }`

Die Schritte in dieser Reihenfolge:

1. Passwort-Provider aktiv, sonst 403.
2. `pruefe_passwort_laenge`, bei Verstoß 400. Der Schlüssel bleibt dann unberührt, denn die Prüfung
   läuft vor der Entnahme.
3. Den Schlüssel entnehmen, ohne Cookie, unbekannt oder abgelaufen 401.
4. Das Konto frisch laden. Ist es inaktiv oder steht der Zwang nicht mehr an, 401.
5. Das neue Passwort gegen den bisherigen Hash prüfen, unter dem KDF-Gate. Gleicht es ihm, 422
   „Das neue Passwort muss sich vom bisherigen unterscheiden.“ Der Schlüssel wird dann unter neuem
   Ablauf wieder eingelegt, damit die Person korrigieren kann, ohne sich neu anzumelden.
6. `hash_gedrosselt`.
7. In einer Transaktion: `UPDATE benutzer SET passwort_hash = ?, passwort_wechsel_pflicht = 0 WHERE
   id = ? AND passwort_wechsel_pflicht = 1 AND passwort_hash = ?`, wobei der letzte Parameter der
   im Speicher gemerkte Hash ist. Betrifft das keine Zeile, hat ein Admin dazwischen ein neues
   Einmalpasswort vergeben, oder das Passwort wurde anders gewechselt. Es folgt 401, und die Person
   meldet sich mit dem aktuellen Einmalpasswort neu an.
8. `session::anlegen`, Cookie `passwort_wechsel` löschen, Sitzungs-Cookie setzen, Antwort
   `BenutzerAnzeige` wie `totp_finish`.

Die Route bekommt das Body-Limit `AUTH_START_BODY_MAX` (4 KiB) wie der Login, denn ein Passwort von
128 Zeichen passt hinein. Sie steht im Bündel der öffentlichen Anmelderouten in `src/app.rs`.

**Verworfen: den bestehenden `POST /api/auth/passwort` wiederverwenden.** Er setzt `CurrentUser`
voraus, also eine Sitzung, und widerspricht damit D1. Er verlangt außerdem das alte Passwort, das
der Server im Zwischenschritt aber schon geprüft hat.

### D4: Die Admin-Route `POST /api/benutzer/{id}/einmalpasswort`

Die Schritte in dieser Reihenfolge:

1. `AdminUser`.
2. Passwort-Provider aktiv, sonst 403.
3. Ziel per `WHERE id = ? AND org_id = ?` laden, fremd oder fehlend 404. Muster und Begründung wie in
   `routes/sitzung.rs` und `src/AGENTS.md`, Admin-Schreibwege: „nie `ist_admin()` allein“.
4. `verweigere_geraetekonto`, 404.
5. Ziel ist der Admin selbst: 422 „Das eigene Passwort wird im Profil geändert.“
6. SSO-only (`PASSWORT_HASH_SSO_ONLY`): 422 „Dieses Konto meldet sich über SSO an und hat kein
   Passwort.“
7. Das Passwort erzeugen (D5) und `hash_gedrosselt`.
8. In einer Transaktion `UPDATE … SET passwort_hash = ?, passwort_wechsel_pflicht = 1` und
   `session::alle_loeschen`, dann der Commit.
9. `live.melde_sitzung_ende`.
10. `admin_audit::schreibe(EinmalpasswortVergeben)` ohne Detail.
11. 200 mit `Json(Einmalpasswort { einmalpasswort })` und dem Header `Cache-Control: no-store`.

Ein deaktiviertes Konto ist erlaubt. Es kann sich ohnehin nicht anmelden, und die Reihenfolge von
„Reaktivieren“ und „Einmalpasswort vergeben“ soll keine Rolle spielen. Die Oberfläche bietet die
Aktion trotzdem nur im Bearbeiten-Dialog an, und der steht für beide Zustände offen.

**Verworfen: das Feld `passwort` in `PatchBenutzer`.** Der PATCH ist partiell und idempotent gedacht.
Ein Passwort, das der Server erzeugt und nur einmal ausliefert, passt weder zu dem einen noch zum
anderen. Außerdem soll die Spur eine eigene Aktion bekommen.

### D5: Form des Einmalpassworts: `xxxx-xxxx-xxxx` aus 31 Zeichen

Das Alphabet besteht aus `abcdefghjkmnpqrstuvwxyz23456789`, also Kleinbuchstaben und Ziffern ohne
`0 o 1 l i`. Gezogen wird mit `OsRng` und Zurückweisung (rejection sampling), damit jedes Zeichen
gleich wahrscheinlich ist. Das ergibt 12 Zeichen mit rund 59 Bit, drei Gruppen zu je vier Zeichen.

Gegen Raten reicht das: Die Anmeldung ist je Quelle und Konto gesperrt, und jede Prüfung kostet
Argon2. Die Länge von 14 Zeichen liegt in den Grenzen 8–128. Die Bindestriche gehören zum Passwort,
denn so kann die Person es genau so abtippen, wie sie es sieht.

**Verworfen: Wörter (Diceware).** Dafür bräuchte es eine Wortliste im Binary, und ein deutsches
Wort wäre am Telefon nicht eindeutiger als vier Zeichen aus einem bereinigten Alphabet.

### D6: „Benutzer anlegen“ setzt den Zwang, behält aber sein Passwortfeld

`anlegen` schreibt `passwort_wechsel_pflicht = 1`, sonst bleibt alles wie bisher. Die Spalte hat den
Default 0. Deshalb bleiben `bootstrap_admin`, die Dev-Seeds, die Demo-Daten und die SSO-Erstanlage
ohne Zwang, ohne dass sie geändert werden.

**Verworfen: Auch bei der Anlage erzeugt der Server das Passwort.** Das ist einheitlicher, ändert aber
Formular, Bild und Doku der Anlage und jeden Test, der die Anlage mit Passwort aufruft. Für den
Zwang ist es nicht nötig. Will der Mensch es, kommt es in ein eigenes Ticket.

### D7: Der Self-Service-Wechsel hebt den Zwang auf

`passwort_aendern` setzt im selben `UPDATE` `passwort_wechsel_pflicht = 0`. Andernfalls bliebe ein
Konto, das per Passkey hereinkam und sein Passwort im Profil gewechselt hat, unter Zwang. Die nächste
Anmeldung mit dem selbst gewählten Passwort verlangte dann einen zweiten Wechsel.

### D8: Die Testhelfer erledigen den Erstwechsel

- **Rust** (`tests/common/mod.rs`): `benutzer_anlegen` legt wie bisher mit `{name}pw1` an und hebt
  den Zwang danach mit `zwang_aufheben(name)` **direkt in der Test-Datenbank** auf. Den Pool kennt
  der Helfer über ein `thread_local`, das jedes `setup*` setzt. Die 274 Aufrufer bleiben
  unverändert. `login_cookie` bricht mit einer klaren Meldung ab, wenn ein Konto noch unter Zwang
  steht. Stellen, die `POST /api/benutzer` direkt rufen und sich danach anmelden, rufen
  `zwang_aufheben` selbst.
  - *Umsetzung abweichend vom ersten Plan* (Erstwechsel per API mit `{name}pw0` → `{name}pw1`):
    Jeder API-Wechsel hätte eine zusätzliche Sitzung und drei Spureinträge erzeugt
    (`passwort_geaendert`, `login_ok`, `logout`). Tests, die Sitzungen oder Spurzeilen zählen,
    wären dadurch verfälscht worden. Den Weg selbst prüft `tests/einmalpasswort.rs`.
- **e2e:** `e2e/konto-anlegen.ts` legt das Konto an und erledigt den Erstwechsel per API, in einem
  eigenen API-Kontext, und meldet die dabei entstandene Sitzung wieder ab. Die e2e-Suite hat keinen
  Zugriff auf die Datenbank. Die Specs und Bildskripte, die sich mit dem angelegten Konto anmelden,
  nutzen ihn. Konten, die nur als Listenzeilen gebraucht werden, brauchen ihn nicht.

**Verworfen: Ein Feld `passwort_wechsel_erzwingen: false` in der Anlage.** Damit gäbe es einen
Produktionsweg um die Entscheidung herum, nur damit Tests einfacher werden.

### D9: Die Oberfläche: Bearbeiten-Dialog, Rückfrage, einmalige Anzeige

Die Aktion steht im Bearbeiten-Dialog. Für eine vierte Zeilenaktion ist sie nicht gedacht, denn die
Aktionsspalte trägt schon drei Knöpfe, und die Bündelungsregel (`frontend/AGENTS.md`,
Datensatz-Aktionen) würde sie sonst weiter überdehnen. Wer ein Passwort zurücksetzen will, sucht
zuerst unter „Bearbeiten“. Bisher sagt die Doku genau dort, dass es nicht geht.

- **Sperren mit Grund:** eigenes Konto mit „Eigenes Passwort im Profil ändern.“ und SSO-only-Konto
  (`!passwort_gesetzt`) mit „Meldet sich über SSO an.“
- **Rückfrage** per `Popconfirm`, rot und mit benanntem `okText`, wie es `frontend/AGENTS.md` für
  Unumkehrbares vorgibt („Destruktiv ist nicht gleich destruktiv“). Sie enthält einen Satz zur
  Folge: „Das bisherige Passwort gilt nicht mehr, und alle Anmeldungen von {Name} enden.“ Der
  Bestätigungsknopf heißt „Einmalpasswort vergeben“.
- **Ergebnis:** eine Anzeige in Monospace mit Kopierknopf (`components/KopierbarerText.tsx`). Der
  Dialog bleibt mit „Abbrechen“ bzw. „Speichern“ offen, wie er war. Das Passwort steht
  nur im lokalen Zustand der Komponente, nie im Query-Cache. Es geht über `useMutation` ohne
  `onSuccess`-Cache-Schreiben, und nach dem Erfolg wird `globalKeys.benutzer()` invalidiert.
- **Anmeldeseite:** Der Schritt „Neues Passwort festlegen“ ersetzt das Formular wie der TOTP-Schritt.
  Die Felder „Neues Passwort“ und „Neues Passwort wiederholen“ samt Regeln kommen aus einem
  gemeinsamen Baustein mit `PasswortAendernDialog`, damit dieselbe Eingabe nicht zweimal gebaut
  wird.
- **AuthContext:** `login()` bekommt das Ergebnis `{status:'passwort_wechsel'}`, `totpFinish`
  (`api/totp.ts`) liefert die schmale Antwort an `LoginPage` durch, und neu kommt
  `passwortFestlegen()` dazu. Erst `passwortFestlegen()` ruft `vorhaltungAnmelden`,
  `uebernimm` und `meldeAuthWechsel`.

## Risks / Trade-offs

- **[Risiko] Testhelfer verdecken den Weg:** Ein Helfer, der den Zwang direkt in der Datenbank
  aufhebt, prüft den Erstwechsel nicht mit. → Den Weg prüfen `tests/einmalpasswort.rs` und
  `e2e/einmalpasswort.spec.ts` eigens, und die e2e-Helfer gehen ihn per API.
- **[Risiko] Übersehene Testpfade:** Ein e2e-Spec, das ein Konto anlegt und sich über die
  Oberfläche anmeldet, landet im neuen Schritt statt auf `/einsaetze`. → Ein Grep auf
  `/api/benutzer` in `frontend/e2e/` liefert die Liste der Dateien, und der volle e2e-Lauf des Gates
  ist der Nachweis.
- **[Risiko] Ein Admin vergibt ein zweites Einmalpasswort, während die Person mit dem ersten im
  Zwischenschritt steht** (etwa weil das erste in falsche Hände geriet). → Der Zwischenschritt des
  ersten scheitert an Schritt 7 von D3, denn der Hash hat sich geändert. Nur das jeweils aktuelle
  Einmalpasswort führt zu einer Sitzung.
- **[Kompromiss] Verhaltensänderung für bestehende Abläufe:** Wer heute ein Konto anlegt und die
  Zugangsdaten weitergibt, sieht beim ersten Login jetzt den Zwischenschritt. → Gewollt (Entscheidung
  3). Die Doku zur Anlage beschreibt es.
- **[Kompromiss] Zwischenschritte gehen bei einem Neustart verloren.** → Die Person meldet sich
  erneut an (D1).

## Migration Plan

- Zwei Migrationen mit der nächsten freien Nummer nach `0171`, vor dem Push mit
  `scripts/check-migrationen.sh` gegen `origin/alpha` geprüft:
  1. `ALTER TABLE benutzer ADD COLUMN passwort_wechsel_pflicht INTEGER NOT NULL DEFAULT 0 CHECK
     (passwort_wechsel_pflicht IN (0, 1))`. Bestehende Konten bekommen 0, ihr Verhalten bleibt
     gleich.
  2. Neuaufbau von `admin_audit` mit `'einmalpasswort_vergeben'` im CHECK, Muster und Test wie bei
     `0170`.
- **Rückweg:** Ein älteres Binary ignoriert die Spalte. Konten mit offenem Zwang melden sich dann
  direkt mit dem Einmalpasswort an. Das neue CHECK-Wort stört das alte Binary nicht, denn es schreibt
  das Wort nicht.
