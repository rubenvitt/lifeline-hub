# CodeQL-Triage (GitHub Code Scanning, Default Setup)

CodeQL läuft über GitHubs **Default Setup** — es gibt bewusst keine
`.github/codeql/codeql-config.yml` und keine repoweite `query-filters`-Liste. Der Grund ist
derselbe, aus dem `cargo clippy -D warnings` nicht im Gate steht (CLAUDE.md, „Qualitäts-Gates"):
**ein abgeschalteter Query ist von einem bestandenen nicht zu unterscheiden.** Wer
`rust/insecure-cookie` repoweit ausfiltert, um zwölf begründete Fundstellen loszuwerden, ist
gegen die dreizehnte blind — und zwar ohne roten Test und ohne Fehlerbild.

Stattdessen wird **je Alert** entschieden und die Entscheidung im Security-Tab hinterlegt
(*Dismiss → „Used in tests"* / *„Won't fix"*). Diese Datei ist die Begründung dazu, damit die
nächste Sichtung nicht bei null anfängt.

**Diese Datei ist kein Freibrief.** Ein neuer Fund derselben Query ist **nicht** automatisch
gedeckt: gedeckt ist die hier benannte Zeile mit der hier benannten Ursache. Wer eine neue
Fundstelle einträgt, schreibt die Messung dazu, nicht den Verweis auf einen Nachbareintrag.

Stand: 22.09.2026 · Alerts #1–#25.

---

## Behoben (Code geändert)

| Alert | Query | Ort | Was geändert wurde |
|---|---|---|---|
| #24, #25 | `rust/cleartext-logging` | `src/auth/totp/mod.rs` | Das frisch erzeugte TOTP-Secret stand in zwei `assert!`-Meldungen und wäre bei einem Fehlschlag im CI-Log gelandet. Die Meldungen tragen es nicht mehr; `assert_eq!` nennt die Ist-Länge ohnehin selbst. |
| #11 | `rust/uncontrolled-allocation-size` | `src/uhs/platz_repo.rs` | `Vec::with_capacity(menge)` — `menge` kam aus dem Request-Body. Die Grenze lag **nur** in der Route (`1..=50`), das Repo hatte sie als Annahme. Jetzt `platz_repo::MENGE_MAX` als eine Wahrheit: die Route validiert dagegen (422), das Repo klemmt vor der Allokation. |
| #1 | `js/incomplete-sanitization` | `frontend/src/components/dichte.guard.test.ts` | Die Regex-Maskierung des Elementnamens kannte genau ein Metazeichen (den Punkt in `Space.Compact`). Ersetzt durch `regexMaskiert()` über die ganze Zeichenklasse. |

Zu #11 im Einzelnen: die Klemme ist **kein** Ersatz für die Route-Validierung, sondern ihre
zweite Hälfte. Die Route antwortet weiter 422 statt still 50 Plätze anzulegen — ein Klemmen,
das eine Fehleingabe stillschweigend zurechtbiegt, wäre eine Verschlechterung. Neu ist nur,
dass die Zahl nicht mehr davon abhängt, dass **jeder** künftige Aufrufer vorher prüft.
`anlegen_bulk_klemmt_menge_auf_menge_max` prüft den Repo-Aufruf unter Umgehung der Route; die
Mutationsprobe (Klemme raus) färbt ihn rot.

---

## Nicht behoben — begründet (`Won't fix`)

### #12–#23 · `rust/insecure-cookie` · `src/routes/auth.rs` (12 Alerts)

**`Secure` folgt dem Transport, und das ist die Zusicherung, nicht ihr Fehlen.**
`session_cookie`, `mfa_pending_cookie`, `oidc_state_cookie`, `webauthn_reg_cookie`,
`webauthn_auth_cookie` und `webauthn_disc_cookie` setzen `.secure(secure)` aus
`auth::session::cookie_secure()`; `src/main.rs` setzt den Schalter im `--tls`-Zweig auf `true`.
Dokumentiert in `docs/betrieb-tls.md`.

`.secure(true)` fest zu verdrahten ist keine Härtung, sondern ein **Totalausfall der
Anmeldung** im Klartext-HTTP-Betrieb — und der ist für dieses Produkt kein Randfall, sondern
der dokumentierte Standardbetrieb (Fükw/LAN ohne erreichbare CA, `docs/betrieb-tls.md`
Abschnitt „Rest-Lücke"). Ein Browser sendet ein `Secure`-Cookie über `http://` nicht zurück;
die Sitzung käme nie zustande.

Ein Teil der zwölf Fundstellen sind zudem **Removal-Cookies** (`jar.remove(Cookie::build((NAME,
""))…)`, Zeilen 242 · 380 · 767 · 984 · 1167 · 1390): leerer Wert, kein Geheimnis, und Browser
matchen die Löschung über Name/Pfad/Domain, nicht über `Secure`.

Gepinnt ist das Verhalten in `session_cookie_secure_folgt_parameter` und
`oidc_state_cookie_secure_folgt_parameter` — beide Zweige, damit der Schalter nicht still auf
eine Seite fällt.

**Was diesen Eintrag ungültig machen würde:** wenn HTTPS zur Voraussetzung des Betriebs wird
(kein `--tls`-loser Pfad mehr). Dann wird `.secure(true)` richtig und diese zwölf Alerts
werden zu echten Funden.

### #9 · `rust/request-forgery` (critical) · `src/geocoding/mod.rs:116`

**Der konfigurierbare Geocoder ist das Feature, nicht der Fehler.** Die Basis-URL kommt aus
`organisation_einstellungen.geocoder_url`, gesetzt über `PUT /api/org/einstellungen` und dort
gegen `ist_gueltige_geocoder_url` geprüft (nur `http://`/`https://`). `lat`/`lon` sind `f64`
und können nichts injizieren — variabel ist allein der Admin-gepflegte Präfix.

Eine SSRF-Abwehr im üblichen Sinn (interne Adressen sperren) wäre hier **gegen** die Anforderung
gerichtet: der Offline-Betrieb setzt eine Nominatim-Instanz im eigenen LAN voraus, und
`http://10.0.0.5:8080` steht als gültiger Fall im Test `geocoder_url_nur_http_s`. Der
Vertrauensbereich ist die Org-Administration, nicht der Einsatz-Benutzer.

Zum Vergleich: wo eine URL **nicht** aus der Administration stammt, fährt das Projekt sehr wohl
SSRF-Abwehr — `src/karte/download.rs` nutzt `ssrf_redirect_policy()` plus den pinnenden
`proxy::SichererResolver` gegen DNS-Rebinding. Die beiden Pfade sind unterschiedlich bewertet,
nicht unterschiedlich sorgfältig.

**Was diesen Eintrag ungültig machen würde:** wenn `geocoder_url` je aus einer Einsatz- oder
Benutzer-Ebene statt aus der Org-Administration gesetzt werden kann.

### #4–#8 · `rust/path-injection` (5 Alerts)

Kein Pfadsegment stammt aus einem Request.

| Alert | Ort | Woraus der Pfad entsteht |
|---|---|---|
| #4, #5 | `src/karte/download.rs:291-292` | `karten_dir.join(format!("karte-{id}.mbtiles"))`, `id: i64` — ein `i64` trägt weder `/` noch `..`. |
| #6 | `src/cache_db.rs:99` | `daten_dir.join("nachschlage-cache.db")` — fester Dateiname. |
| #7 | `src/karte/tile_cache.rs:132` | `karten_dir.join("tile-cache.db")` — fester Dateiname. |
| #8 | `src/routes/karte.rs:1167` | `std::fs::read_dir(karten_dir)` — nur gelesen, nichts angehängt. |

`karten_dir`/`daten_dir` sind in allen fünf Fällen der Serverstart-Parameter (`AppState`), kein
Request-Wert. CodeQL verfolgt sie bis zur CLI-Konfiguration und zählt die als „user-provided" —
wer die Kommandozeile des Servers stellt, hat ohnehin Dateisystemzugriff.

### #10 · `rust/uncontrolled-allocation-size` · `src/auftrag/eingabe.rs:282`

`Vec::with_capacity(req.empfaenger.len())` — die Kapazität ist die Länge eines **bereits
deserialisierten** `Vec`. Der Speicher dafür steht zum Zeitpunkt des Aufrufs längst; die
Allokation kann die vorhandene Menge nicht übersteigen. Die Eingangsgrösse begrenzt der
Body-Limit-Layer, nicht diese Zeile.

Der Unterschied zu #11 ist genau dieser: dort war die Zahl ein `i64` aus dem Body und **nicht**
durch bereits allokierten Speicher gedeckelt.

### #3 · `rust/cleartext-logging` · `src/auth/oidc/mod.rs:423`

`panic!("erwartete ServiceUnavailable (Discovery-Fehler), fand {andere:?}")` in
`unerreichbarer_idp_liefert_err_statt_panic` — ein `#[cfg(test)]`-Panic über einem
`AppError`-Debug. Kein Geheimnis, kein Produktivcode. Dismissal-Grund im Security-Tab:
**„Used in tests"**.

Anders als bei #24/#25 wird hier **nichts geändert**: dort stand ein echtes Secret in der
Meldung, hier steht der Fehlerwert, den der Test gerade diagnostizieren soll. Ihn zu entfernen
nähme dem Test seine Diagnose, ohne irgendetwas zu schützen.
