# Adapter-Störung an die Admins melden (LLH-2026)

Zunder: https://zunder.rubeen.dev/#/aufgabe/k5fdiw6n15wrlvkgqdn0dlpw
Folgearbeit aus LLH-2017 (Adapter-Rahmen Teil A) und LLH-2018 (Seite „Anbindungen“).

## Absicht

Ein Adapter ruft ein Fremdsystem im Hintergrund ab, etwa eine Alarmierungsquelle. Hält er an
(`braucht_eingriff`) oder ist er länger gestört, sieht das heute nur, wer die Seite
„Anbindungen“ öffnet. Eine still ausgefallene Alarmierungsquelle fällt so erst im Einsatz auf.
Künftig erfahren es die Admins der Org von selbst: als Eingang überall in der App und als Web Push,
einmal je Störung, mit Entwarnung, wenn der Adapter von allein zurückkommt.

## Ziele

- Hält der **Lauf** einen Adapter an (Fehler, den nur ein Mensch beheben kann), bekommen die
  zuständigen Admins **genau eine** Benachrichtigung.
- Ist ein Adapter **30 Minuten** am Stück gestört (gerechnet ab `fehler_seit`), bekommen sie
  **eine** Benachrichtigung. Kürzere Aussetzer melden sich nie.
- Kommt ein gemeldeter Adapter **von selbst** zurück (erfolgreicher Abruf), wird die offene
  Störungsmeldung für alle erledigt, und es folgt eine **Entwarnung**.
- Greift ein **Admin** ein (Fortsetzen, Anhalten, wirksame Änderung, die einen Lauf-Stopp
  aufhebt, Löschen), wird die offene Störungsmeldung für alle erledigt, **ohne** Entwarnung.
- Die Meldung nennt Adapter (Name) und Fehlercode, nie ein Geheimnis, nie eine URL.
- Ein Klick springt in die Einzelansicht des Adapters
  (`/admin/einstellungen/anbindungen/adapter/{id}`).

## Nicht-Ziele

- Keine allgemeine „Org-Benachrichtigung ohne Einsatz“ für beliebige künftige Anlässe. Gebaut wird
  der Ort „Adapter“; ein späterer Anlass (Sicherung, Kopplung) bekommt seinen eigenen Ort nach
  demselben Muster.
- Kein eigener Posteingang für Admins außerhalb eines Einsatzes. Toast, Eingangsband, Push und
  Nachreichen tragen die Meldung; dauerhaft sichtbar bleibt der Zustand auf der Seite
  „Anbindungen“ (LLH-2018).
- Keine einstellbare Schwelle, keine Schwelle je Art.
- Keine Meldung für „Verbindung prüfen“ (Probelauf); er ändert den Zustand nicht.
- Keine E-Mail.

## Anti-Ziele

- Eine Meldung je Fehlversuch (Backoff 1, 2, 4, 8, 15 Minuten wäre ein Strom).
- Ein Alarmton für eine Verwaltungssache bei einem Admin, der zugleich im Einsatz führt.
- Text des Ziels, URL oder Geheimnis in Zeile, Nutzlast, Push oder Log.
- Ein Push an jemanden, der den Adapter nicht ändern kann.

## Rahmen

- Regeln: `src/AGENTS.md`, „Benachrichtigungen“ (Melden nur über `melden`, Empfänger nur in
  `aufloesung::empfaenger`, kein Text in der Tabelle, Push nur aus `melden`) und „Adapter“.
- ADR-0077 (Geheimnisse nie in Fehlertext oder Log), ADR-0006 (`wire_enum!`, Enum-Kontrakt),
  ADR-0012 (UTC), ADR-0027 (Hinweise reisen zum Hub; hier nicht berührt, s. u.).
- `benachrichtigung.einsatz_id` ist heute `NOT NULL` mit FK auf `einsatz`, `bezug_id` ist eine
  Zahl, die Adapter-ID ist Text. Die Tabelle muss ohnehin neu gebaut werden (CHECK der Arten,
  Muster `migrations/0352_benachrichtigung_fuehrung_angefragt.sql`).
- Adapter gehören einer Org (`adapter.org_id`). Ändern dürfen sie System-Admins dieser Org
  (`routes::adapter`, `benutzer.org_id`); Führungskräfte sehen die Seite nur.
- Eine Org, die sich bei einem Hub meldet, ruft keine Adapter ab (`lauf::is_org_am_hub`), also
  entsteht dort auch keine Meldung.

## Ansätze

1. **Benachrichtigung ohne Einsatz** *(gewählt am 22.11.2026)*. Die Tabelle bekommt einen zweiten
   Ort: `einsatz_id` darf leer sein, wenn `adapter_id` gesetzt ist. Drei neue Org-Arten laufen
   über `melden`: Toast überall in der App über den Org-Kanal, Web Push, Nachreichen über die
   offene Liste, Abschalten je Art in den Einstellungen. Folgt den bestehenden Regeln; Preis ist
   der Tabellenumbau und `einsatz_id: number | null` auf dem Wire.
2. **Eigener schmaler Weg** (verworfen). Merker am Adapter, Org-Live-Ereignis und Web Push direkt,
   Banner im Admin-Bereich. Kein Tabellenumbau, bricht aber „Push nur aus `melden`“, hat keinen
   Verlauf, kein Quittieren, kein Abschalten.
3. **Nur Anzeige** (verworfen). Abzeichen an „Anbindungen“ und Banner aus dem Zustand. Ohne Push
   merkt es niemand, der nicht hineinschaut: genau das Problem der Aufgabe.

## Entwurf

### Wann gemeldet wird: der Merker `adapter.gemeldet`

Neue Spalte `adapter.gemeldet TEXT NULL CHECK (gemeldet IN ('gestoert', 'eingriff'))`: was zur
laufenden Störung schon gemeldet ist. Sie ist die eine Quelle für „einmal je Störung“.

| Ereignis | Bedingung | Merker danach | Meldung (nach dem Commit) |
|---|---|---|---|
| Lauf hält an (`NachFehlschlag::Anhalten`, Adapter war `aktiv`) | `gemeldet` ist nicht `eingriff` | `eingriff` | offene `adapter_gestoert` erledigen, `adapter_eingriff` melden |
| Lauf wiederholt (`NachFehlschlag::Wiederholen`) | `gemeldet IS NULL` und `jetzt − fehler_seit ≥ 30 min` | `gestoert` | `adapter_gestoert` melden |
| Abruf erfolgreich (`save_erfolg`) | `gemeldet IS NOT NULL` | `NULL` | offene Störungsmeldungen erledigen, `adapter_wieder_ok` melden |
| Admin: Fortsetzen, Anhalten, wirksame Änderung oder Geheimnis, das einen Lauf-Stopp aufhebt (`WIEDER_FAELLIG`) | `gemeldet IS NOT NULL` | `NULL` | offene Störungsmeldungen erledigen, keine Entwarnung |
| Admin löscht den Adapter | — | (Zeile weg) | vor dem Löschen erledigen; die Zeilen fallen per CASCADE |
| Serverstart nimmt Adapter wieder auf (`rearm_nach_schluessel`) | — | unverändert | keine; der nächste Erfolg entwarnt |

- Die Schwelle ist `zustand::MELDESCHWELLE_GESTOERT = 30 min` und wird in einer reinen Funktion
  neben `nach_fehlschlag` entschieden (Vorschlag: `zustand::meldung_nach_fehlschlag(nach, gemeldet,
  jetzt) -> Option<Meldung>`), damit Schwelle und Eskalation ohne Datenbank testbar sind.
- Der Merker wird **in derselben Transaktion** wie `save_fehlschlag`/`save_erfolg` gesetzt, und
  zwar bedingt (`… WHERE id = ? AND gemeldet IS NOT 'eingriff'` bzw. `IS NULL`); nur wer die Zeile
  ändert (`rows_affected == 1`), meldet danach. Ein Abruf, dessen Stand veraltet ist
  (`is_unveraendert` falsch), setzt keinen Merker und meldet nichts, wie er auch den Zustand
  nicht schreibt.
- Eskalation: wer erst gestört gemeldet wurde und dann anhält, bekommt die Eingriffsmeldung
  zusätzlich; die Störungsmeldung wird dabei erledigt, damit nur eine offen steht.
- Nach dem Fortsetzen bleibt `fehler_seit` stehen (heutiges Verhalten). Scheitert der nächste
  Abruf vorübergehend, ist die Schwelle meist schon überschritten, und `adapter_gestoert` kommt
  sofort. Das ist gewollt: der Adapter ist seit über 30 Minuten nicht gesund.
- Ein Admin, der den Adapter während einer gemeldeten Störung nur umbenennt oder das Intervall
  ändert (nicht wirksam, kein Lauf-Stopp), lässt den Merker stehen.

### Arten, Stufe, Bezug

- Drei neue `BenachrichtigungArt`, alle **Stufe Eingang** (`hinweis`) und Org-Arten
  (`ist_org() == true`, also nicht am Einsatz einstellbar):
  - `adapter_eingriff`, Titel „Anbindung braucht Eingriff“
  - `adapter_gestoert`, Titel „Anbindung gestört“
  - `adapter_wieder_ok`, Titel „Anbindung läuft wieder“
  Jede ist je Person abschaltbar wie jede Eingangs-Art (`benachrichtigungen_aus`).
- Neuer `BenachrichtigungBezugTyp::Adapter` (`"adapter"`), Modul `None`. `bezug_id` ist die
  Kennung des `adapter_versuch`, der die Meldung ausgelöst hat (eine Zahl, eindeutig je Meldung,
  ohne FK, weil der Verlauf auf 50 Versuche gekappt wird). Den Adapter selbst trägt die neue
  Spalte `benachrichtigung.adapter_id`. `save_versuch` liefert dafür seine Kennung.
- Der Hub-Wächter `hinweis::bezug_tabelle` / `jeder_bezugstyp_ist_eingeordnet` ordnet `adapter`
  als „reist nicht“ ein: ohne Einsatz gibt es keine Hub-Ziele (`hub_ziele` entfällt für diesen
  Ort), Push kommt immer von hier.

### Tabelle `benachrichtigung`

Neubau nach dem Muster von 0352 (Blatt-Umbau in der Transaktion von sqlx):

- `einsatz_id INTEGER NULL REFERENCES einsatz(id) ON DELETE CASCADE`
- neu `adapter_id TEXT NULL REFERENCES adapter(id) ON DELETE CASCADE`
- `CHECK ((einsatz_id IS NULL) <> (adapter_id IS NULL))`: genau ein Ort
- CHECK der Arten um die drei neuen ergänzt
- Index `idx_benachrichtigung_adapter ON benachrichtigung(adapter_id)`
- `adapter.gemeldet` kommt per `ALTER TABLE … ADD COLUMN` in dieselbe Migration.

Nummern und Ablauf: `migrations/AGENTS.md`.

### Backend: ein Ort statt einer Einsatzkennung

- `Anlass` bekommt statt `einsatz_id: i64` einen Ort, etwa
  `enum Ort { Einsatz(i64), Adapter { org_id: i64, adapter_id: String } }`, mit
  `Anlass::neu(einsatz_id, …)` unverändert für alle bisherigen Aufrufer und
  `Anlass::adapter(org_id, adapter_id, art, bezug)` für den neuen. Die Namensgebung ist Sache des
  Plans; die Regel ist: kein bisheriger Aufrufer ändert sich.
- Neuer `Adressat::OrgAdmins`: aktive Konten mit System-Rolle Admin und `org_id` des Adapters,
  ohne Gerätekonten (`aufloesung::org_nutzer` + `ist_admin`). Systemadmins anderer Orgs nicht:
  sie können den Adapter über die Routen nicht ändern.
- `aufloesung::empfaenger` verzweigt nach dem Ort. Für `Adapter`: nur `OrgAdmins` ist zulässig
  (andere Adressaten liefern niemanden), Ausschlüsse Auslöser, inaktiv, Gerätekonto und die
  abgeschaltete Art (still) gelten; Einsatzrecht, Modul und Vorgabe je Funktion entfallen.
- `Leserecht` beim Lesen (`routes::benachrichtigung::liste`, `lesen`, `quittieren`): eine
  Adapter-Zeile darf lesen, wer weiterhin System-Admin der Org des Adapters ist und dessen
  Adapter noch besteht; sonst 404 wie bisher.
- `melden` überspringt für den Ort `Adapter` Hub-Vormerken und `konten_am_hub`;
  `zustellen` geht für Org-Arten wie heute über `publiziere_org_benachrichtigung` mit der
  `org_id` aus dem Ort. Web Push wie heute aus `ausliefern`.
- `erledigen` und `quittiert_zustellen` bekommen den Ort ebenso (Adapter: alle offenen Zeilen der
  Art(en) mit dieser `adapter_id`, Org aus dem Ort).
- Wire: `BenachrichtigungEreignis.einsatz_id` und `BenachrichtigungAnzeige.einsatz_id` werden
  `Option<i64>` (immer serialisiert, `null` beim Adapter). Keine Adapter-ID auf dem Wire: den
  Sprung trägt `pfad` aus `GET /api/benachrichtigungen/{id}`. Typ-Codegen
  (`scripts/check-typ-codegen.sh`) und beide generierten Dateien mitcommitten.
- `text::bilden` für den Bezug `adapter`: Detailzeile „{Name} · {Fehler}“, gelesen beim Lesen aus
  der Adapterzeile (`angehalten_grund` bzw. `letzter_fehler_art` und `letzter_fehler_status`);
  bei der Entwarnung nur „{Name}“. Den Fehler zeigt eine kurze deutsche Bezeichnung je
  `AdapterFehler` (dieselben Wörter wie die Seite „Anbindungen“), bei `status` mit der Zahl
  („Antwort 503“). Pfad `/admin/einstellungen/anbindungen/adapter/{adapter_id}`. Der Guard
  `detail_liest_nur_retain_spalten` muss die Adapterspalten kennen.

### Lauf

- `lauf::start` und `lauf::durchgang` bekommen den `LiveHub` (Aufrufer: `main.rs`, die Tests);
  ohne ihn gibt es kein `melden`.
- `record_failure` und der Erfolgszweig von `run_one` entscheiden in ihrer Transaktion über den
  Merker (s. Tabelle) und melden nach dem Commit. Ein Fehler beim Melden lässt den Lauf weiterlaufen
  (geloggt, wie überall bei `melden`).
- Die Admin-Routen `resume`, `halt`, `update` (wenn wirksam), `set_geheimnis`/`delete_geheimnis`
  (wenn sie einen Lauf-Stopp aufheben) und `delete` räumen Merker und offene Meldungen ab
  (eine Repo-Funktion, die den Merker in der Transaktion der Route löscht und sagt, ob er gesetzt
  war; danach `erledigen`).

### Frontend

Die Toasts kommen ohne neuen Code an: `OrgBenachrichtigungen` hängt im `AppLayout` (auch unter
`/admin/*`), der Org-Strom hört auf `org_benachrichtigung`, Nachreichen holt
`GET /api/benachrichtigungen?offen=true` ohne Einsatzfilter, der Service Worker holt Titel,
Detail und `pfad` vom Server. Org-Arten gehen in die Alarmzone, nicht ins Eingangsband
(`istEingang`), und erscheinen nie im Verlauf eines Einsatzes; das bleibt so.

Zu ändern (Stellen aus der Erkundung vom 22.11.2026, Pfade unter `frontend/`):

- `src/alarm/benachrichtigungKatalog.ts`: die drei Arten in `BENACHRICHTIGUNG_ARTEN` (`org: true`),
  `adapter` in `BEZUG_ZIEL`, ein neues Ziel `anbindungen` in `AlarmZiel`/`ZIEL_SPRUENGE`/
  `zielPfad` vor dessen `einsatzId == null`-Abzweig, `zielVon` für die drei Arten auf dieses Ziel,
  `ersatzPfad` ohne Einsatz auf die Seite „Anbindungen“ (`adapterAnzeige.ts`/
  `anbindungAnzeige.ts`), nie `/einsaetze/null`.
- `src/alarm/useBenachrichtigungen.ts`: `ersatzAnzeige` und der Desktop-Tag in `eintragVon`
  (`${einsatz_id}-b-<id>`) mit `null`; der Tag muss dem des Service Workers gleichen, deshalb
  sendet der Server `einsatz_id: null` immer ausdrücklich.
- `src/alarm/hinweisInhalt.ts`, `meldungInhalt.ts`, `erinnerungInhalt.ts`, `useEingangshinweis.tsx`:
  nur Typen enger fassen (die Lader laufen nur für Einsatz-Arten).
- `public/alarm-sw.js`: Rückfallpfad ohne Einsatz auf die Seite „Anbindungen“ statt
  `/einsaetze/null`; Tag wie oben. `src/alarm/alarmSw.test.ts` mitziehen.
- `src/alarm/benachrichtigungKatalog.test.ts` („Org-Arten sind Aufnahme und neuer Einsatz“) und
  `src/benachrichtigung/tests.rs` (`org_arten_sind_…`) um die drei Arten ergänzen.
- Einstellungen „Benachrichtigungen“ (`pages/BenachrichtigungenPage.tsx`,
  `alarm/useBenachrichtigungsEinstellungen.ts`): die drei Schalter erscheinen nur für Admins.
- Kein neues Bauteil, keine neue Seite.

### Doku

- `src/AGENTS.md`, „Benachrichtigungen“: der zweite Ort (Adapter), `Adressat::OrgAdmins`,
  Leserecht ohne Einsatz, „reist nicht zum Hub“; „Adapter“: Meldung über den Merker.
- Anwenderkapitel `docs/anwender/kapitel/anbindungen.md`: wann Admins benachrichtigt werden und
  wie man es abschaltet (Mitänderungsregel `docs/anwender/AGENTS.md`).
- Mitänderungsregel der Architekturdoku prüfen (`docs/architektur/AGENTS.md`).

## Tests

In `tests/adapter_lauf.rs` mit der Test-Art und `durchgang` zu gesetzten Zeitpunkten:

- Anhalten durch den Lauf erzeugt genau eine `adapter_eingriff` je Admin der Org; ein weiterer
  Durchgang erzeugt keine zweite; ein Admin einer fremden Org und eine Führungskraft bekommen
  nichts.
- Vorübergehende Fehler unter 30 Minuten seit `fehler_seit` erzeugen keine Meldung, der erste
  Durchgang ab 30 Minuten genau eine `adapter_gestoert`, weitere keine.
- Gestört gemeldet, dann Anhalten: eine `adapter_eingriff`, die Störungsmeldung ist erledigt.
- Erfolg nach Meldung: offene erledigt, eine `adapter_wieder_ok`; Erfolg ohne Meldung: nichts.
- Fortsetzen durch einen Admin: offene erledigt, keine Entwarnung; Löschen: keine Zeilen mehr.
- Ein veralteter Abruf (Admin hat währenddessen geändert) meldet nichts.
- Die Meldung (Liste und `GET /api/benachrichtigungen/{id}`) enthält kein Geheimnis und keine URL
  der Einstellungen.

Dazu Einheitentests der reinen Entscheidung in `zustand.rs`, Katalog-Guards
(`check_listen_entsprechen_dem_katalog`, Enum-Wire-Kontrakt) und die Frontend-Tests der
geänderten Stellen.

## Dem Bauenden überlassen

- Namen von `Ort`, Konstruktoren und Repo-Funktionen.
- Ob die reine Entscheidungsfunktion eine Struktur oder ein Tupel liefert.
- Reihenfolge der Commits.
