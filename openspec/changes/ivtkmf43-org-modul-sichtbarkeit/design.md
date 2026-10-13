# Design

## Context

Den Anlass nennt `proposal.md`. Den fachlichen Weg hat LLH-1116 entschieden
(`openspec/changes/archive/2026-10-12-wgnb0am2-stab-abwaehlbar/design.md`, D1 und D2). Diese Change
legt nur fest, wie er gebaut wird. Den folgenden Ist-Zustand habe ich am 13.10.2026 auf `alpha`
bei Migration `0184` erhoben.

- **Auflösung:** `modul_freigabe` (`src/einsatz/berechtigung.rs`) liest `sichtbar` allein aus
  dem Einsatz-Override (`is_none_or(|o| o.sichtbar)`). Die Rolle löst `effektive_modul_rolle`
  (`src/einsatz/effektiv.rs`) als Einsatz ?? Organisation auf. Beide Eingaben lädt
  `lade_modul_regeln` ungecacht, und alle Gates, Zähler, der Live-Filter und
  `GET …/modul-freigaben` laufen über diese eine Funktion.
- **Speicherung:**
  - `einsatz_modul_override.sichtbar INTEGER NOT NULL DEFAULT 1` (`0065`). Die Tabelle ist ein
    Blatt: Kein Fremdschlüssel, Trigger oder View zeigt auf sie.
  - `org_modul_einstellung` (`0070`) trägt nur `benoetigte_rolle`.
  - `0184` (Lagebesprechung) hat Override-Zeilen mit `sichtbar = 1` und einer Rolle angelegt.
- **Wire:**
  - `GET /api/org-modul-einstellungen` liefert eine dünne Map `modul_key → rolle | null`. Der Typ
    ist im Frontend handgeschrieben (`OrgModulEinstellungen`), es gibt kein Schema.
  - `PUT …/{modul_key}` nimmt `{ benoetigte_rolle }`, nur für den System-Admin (`AdminUser`).
    Lesen dürfen System-Admin und Führungskraft der Organisation (`darf_admin_bereich`).
  - `PUT /api/einsaetze/{id}/modul-overrides/{key}` ist Vollersatz mit `sichtbar: bool`. Der
    Editor schickt beim Rollenwechsel die bisherige Sichtbarkeit mit.
- **Oberflächen:**
  - `ModulEinstellungsListe` kann eine Sichtbar-Spalte (`sichtbarSpalte`) und einen Hinweis unter
    der Rollenauswahl (`hinweisVon`).
  - Der Einsatz-Editor nutzt beides, die Verwaltung nur die Rollenspalte.
  - Die Einsatzleitung ohne Org-Rolle kann die Org-Vorgaben nicht lesen (403). Ihr fehlt deshalb
    schon heute der Rollen-Hinweis, und der Editor lädt die Vorgaben „nicht-blockierend“.

## Goals / Non-Goals

**Goals:**

- Eine Auflösungsstelle für `sichtbar`, wie für die Rolle. Kein Gate rechnet die Rangfolge selbst.
- Der Schalter im Einsatz zeigt immer den wirksamen Wert, auch für eine Einsatzleitung, die die
  Org-Vorgaben nicht lesen darf.
- Keine Ausblendung geht durch die Migration verloren, und keine Rollenänderung legt die
  Sichtbarkeit nebenbei fest.

**Non-Goals:**

- Eine systemweite Vorgabe über den Organisationen (Herleitung, Non-Goals).
- Ein Live-Ereignis für Overrides oder Org-Vorgaben. Andere Personen sehen eine Änderung beim
  nächsten Abruf der Freigaben, wie heute bei der Rolle. Das 403 der Gates bleibt das Netz.
- Leserecht der Einsatzleitung auf die Org-Vorgaben. Das bleibt eine eigene Frage, siehe Risiken.
- Einsatzvorlagen (Herleitung, D1 Option B).

## Decisions

### D1 — Speicherung: Org-Spalte nullbar, Override-Spalte nullbar per Neubau

- **`org_modul_einstellung`:** `ALTER TABLE … ADD COLUMN sichtbar INTEGER`. `NULL` = sichtbar,
  `0` = ausgeblendet. Geschrieben wird nur `0` oder `NULL`, also nie `1`. Eine Vorgabe „sichtbar“
  ist dasselbe wie keine Vorgabe, denn über der Organisation liegt nur der feste Rückfall
  „sichtbar“. Ein Wert, zwei Schreibweisen, das wäre eine Quelle für Abweichungen.
- **`einsatz_modul_override`:** Die Spalte `sichtbar` wird nullbar (`NULL` = erbt). SQLite kann
  `NOT NULL` nicht lösen, deshalb kommt ein Neubau nach dem Muster von `0176`:
  `-- no-transaction`, `PRAGMA foreign_keys = OFF`, neue Tabelle, Daten übernehmen mit
  `CASE sichtbar WHEN 0 THEN 0 ELSE NULL END`, alte Tabelle löschen, umbenennen,
  `foreign_key_check`, `PRAGMA foreign_keys = ON`. Weil die Tabelle ein Blatt ist, braucht es
  keine Nachzüge. Die Spalte verliert ihr `DEFAULT 1`.
- **Eine Migration `0185`** für beide Tabellen (`scripts/check-migrationen.sh` prüft die Nummer
  gegen `origin/alpha`).

Erwogen und verworfen:

- **`sichtbar` bleibt `NOT NULL`, und eine eigene Spalte `sichtbar_eigen` zeigt, ob der Wert
  gilt.** Das spart den Neubau, aber dann tragen zwei Spalten eine Aussage, und `1` mit
  `eigen = 0` wäre ein Widerspruch, den jede Abfrage kennen müsste.
- **`1` stehen lassen statt auf `NULL` setzen.** Dann würde jede bestehende Override-Zeile die
  neue Org-Vorgabe übergehen, auch jede, die nur wegen einer Rolle existiert, etwa jede aus
  `0184`. Das ist genau der Fehler, den die Herleitung (D2) ausschließt.

### D2 — Auflösung: eine reine Funktion neben `effektive_modul_rolle`

- `effektiv_sichtbar(einsatz: Option<bool>, org: Option<bool>) -> bool` in `effektiv.rs`,
  `einsatz.or(org).unwrap_or(true)`, mit eigenen Tests wie die Rolle.
- `org_modul_einstellung::laden_alle` liefert statt `Option<String>` je Key eine Zeile
  `OrgModulVorgabe { benoetigte_rolle, sichtbar: Option<bool> }`. Damit ändert sich die Signatur
  von `modul_freigabe`, `fordere_modul_zugriff`, `lade_modul_regeln` und `gesperrt_fuer_geraet`
  mechanisch.
- `modul_freigabe` rechnet `sichtbar` über `effektiv_sichtbar`, der Rest bleibt in seiner
  Reihenfolge. Der Admin-Durchgriff und die nicht ausblendbaren Module bleiben vorne, eine
  Vorgabe auf `einsatzdaten` wird also ignoriert.

Erwogen: die Rangfolge in SQL auflösen (`COALESCE` im Join). Verworfen, weil die Rolle in Rust
aufgelöst wird und zwei Orte für dieselbe Regel genau die Abweichung erzeugen, die
`modul_freigabe` verhindern soll.

### D3 — Wire: Objekt je Modul, Sichtbarkeit beim Schreiben dreiwertig

- **`GET /api/org-modul-einstellungen`:** `{ <modul_key>: { benoetigte_rolle, sichtbar } }`,
  weiter dünn, also nur Keys mit Zeile. `sichtbar` ist ein `bool`, aufgelöst aus `NULL` →
  `true`, denn der Client braucht nur „blendet die Organisation aus?“.
  - Der Typ bekommt ein Schema (`OrgModulEinstellung`, `ToSchema`), damit der Codegen ihn trägt
    und der handgeschriebene Frontend-Typ entfällt.
  - **BREAKING (intern):** Einziger Abnehmer ist das eigene Frontend. Es ist ins Binary
    eingebettet und kommt im selben Release.
- **`PUT /api/org-modul-einstellungen/{modul_key}`:** `{ benoetigte_rolle, sichtbar? }`.
  - `benoetigte_rolle` bleibt wie heute: Fehlt der Wert, ist das Modul frei.
  - `sichtbar` fehlt → die gespeicherte Sichtbarkeit bleibt unverändert. `true` → `NULL`,
    `false` → `0`.
  - Ein Nicht-Boolean wird mit 400 abgewiesen (`JsonBody` → `AppError::Validation`), und es
    wird nichts gespeichert.
  - `false` auf einem nicht ausblendbaren Modul → 400.
  - Fehlt das Feld, bleibt der Wert unverändert, damit ein Aufrufer, der nur die Rolle setzt
    (Bestand in Tests und e2e), eine Ausblendung nicht still aufhebt.
- **`PUT …/modul-overrides/{key}`:** `sichtbar: Option<bool>`, `null` (oder fehlend) = erbt. Es
  bleibt Vollersatz. `EinsatzModulOverride.sichtbar` wird `Option<bool>`, das ändert den Codegen.

Erwogen und verworfen:

- **Ein eigener Endpunkt für die Sichtbarkeit** (`…/sichtbarkeit`): Das wären zwei Abrufe und zwei
  Cache-Schlüssel für eine Zeile, und der Editor bräuchte beide.
- **`sichtbar` im Org-PUT als Pflichtfeld:** Das ist sauberer Vollersatz, aber jeder Aufruf nur
  mit Rolle bräche mit 400. Der dreiwertige Weg ist ebenso eindeutig und bricht nichts.
- **Die Antwort als `sichtbar: bool | null` (roh):** Dann müsste der Client wissen, dass `null`
  „sichtbar“ heißt. Die Auflösung gehört auf den Server.

### D4 — Einsatz-Editor: wirksamer Wert aus den Freigaben, Herkunft aus der Vorgabe

- **Schalter:** eigener Wert ?? `modulFreigaben[key].sichtbar` ?? Org-Vorgabe ?? `true`. Die
  Freigaben sind vom Server aufgelöst und für jede Person mit Lesezugriff abrufbar. Damit stimmt
  der Schalter auch für eine Einsatzleitung, die die Org-Vorgaben nicht lesen darf. Der Editor
  lädt die Freigaben über denselben Query-Key wie die Navigation, also ohne zusätzliche Anfrage.
- **Hinweis „Vorgabe der Organisation: ausgeblendet“** (`orgVorgabe('ausgeblendet')`, LFH-944):
  steht, wenn die Org-Vorgabe `sichtbar: false` meldet. Fehlt die Vorgabe (403), steht er auch,
  wenn der Einsatz keinen eigenen Wert hat und die Freigabe `sichtbar: false` meldet, denn dann
  kann nur die Organisation ausgeblendet haben.
- **„Vorgabe übernehmen“** steht, sobald der Einsatz einen eigenen Wert trägt. Es speichert
  `sichtbar: null` und lässt die Rolle stehen. Es steht auch bei einem eigenen „sichtbar“ ohne
  Org-Vorgabe, denn genau dann hält der eigene Wert das Modul fest, falls die Organisation es
  später ausblendet.
- **Ort:** Hinweis und „Vorgabe übernehmen“ stehen in der Modulspalte unter dem Namen. Die
  Schalter-Spalte ist schmal (`auto`), und unter der Rollenauswahl steht schon der
  Rollen-Hinweis. Die Beschriftung bleibt `<label htmlFor>` des Schalters, Hinweis und Knopf
  stehen daneben und nicht darin, denn ein Knopf in einem Label leitet seinen Klick an den
  Schalter weiter.
- **Rollenwechsel** schickt den eigenen Wert mit (`overrides[key]?.sichtbar ?? null`), nicht den
  wirksamen. So bleibt eine geerbte Ausblendung geerbt.
- Nach jedem Speichern invalidiert der Editor Overrides und Freigaben, wie heute.

Erwogen: den Schalter allein aus Override und Org-Vorgabe rechnen, wie den Rollen-Hinweis. Für
die Einsatzleitung ohne Org-Rolle zeigte er dann „sichtbar“, obwohl die Organisation ausblendet,
und ein Klick „aus“ hätte keine sichtbare Wirkung. Verworfen.

### D5 — Verwaltung: ein Paneel, zwei Spalten

- Paneel „Module für alle Einsätze“ auf `ModulEinstellungsListe` mit `sichtbarSpalte`
  (Titel „Sichtbar“) und der Rollenspalte „Benötigte Rolle (Vorgabe)“.
- Darüber steht gedämpft: „Wirkt auf alle Einsätze ohne eigene Einstellung, auch auf laufende.“
- Ein Schalterklick schickt `{ benoetigte_rolle, sichtbar }` mit dem Bestand der anderen Spalte,
  ein Rollenwechsel ebenso. Der Client schickt also immer beide Felder, das Weglassen aus D3 ist
  nur das Netz für fremde Aufrufer.
- Die Mutation invalidiert wie heute die Vorgaben und alle Freigaben (`modulFreigabenAlle`). Die
  Meldung bleibt „Modul-Vorgabe gespeichert“.
- Bedienen darf nur der System-Admin (`istAdmin`). Die Führungskraft liest mit dem Sperrwort
  `NUR_ADMIN`.

## Risks / Trade-offs

- [Eine Organisation blendet ein Modul während eines laufenden Einsatzes aus, und es verschwindet
  dort] → Das ist gewollt (Herleitung D2). Der Hinweis am Paneel sagt es vorher, der Einsatz kann
  überstimmen, und der System-Admin erreicht das Modul weiter.
- [Der Neubau von `einsatz_modul_override` scheitert halb] → `-- no-transaction` ist nötig für
  `PRAGMA foreign_keys`. Das Muster aus `0176` ist im Betrieb erprobt. Ein Migrationstest in
  `src/db.rs` belegt die Umdeutung (`1` → `NULL`, `0` bleibt, Rolle bleibt), dazu das
  Schema-Abbild (`test_pool_gleicht_einer_frisch_migrierten_db`).
- [Die Einsatzleitung ohne Org-Rolle sieht nicht, ob die Organisation ausblendet, wenn ihr
  Einsatz einen eigenen Wert trägt] → Der Schalter stimmt trotzdem (D4). Der Hinweis fehlt nur in
  diesem Fall, wie heute der Rollen-Hinweis. Ein Leserecht auf die Vorgaben für die
  Einsatzleitung wäre eine eigene Entscheidung. Ich lege dafür ein Folgeticket an.
- [Ein fremder Aufrufer sendet beim Override-PUT kein `sichtbar` und deutet das als „sichtbar“]
  → Das ergibt jetzt „erbt“. Ohne Org-Vorgabe ist das dasselbe. Mit Org-Vorgabe ist es die
  gewollte Semantik. Einen fremden Aufrufer gibt es nicht.

## Migration Plan

- `0185` läuft beim Start. Die Umdeutung ist verlustfrei (D1). Einen Rückweg gibt es nicht, wie
  bei jeder Migration hier: Ein älteres Binary liest `sichtbar` als `bool` und scheitert an
  `NULL`. Zurück geht es nur über die Sicherung von vor dem Update.
- Bis die erste Organisation eine Vorgabe setzt, verhält sich jeder Einsatz wie vorher.

## Freigabe

Ruben hat am 13.10.2026 freigegeben, wie empfohlen:

- Fehlt im Org-PUT das Feld `sichtbar`, bleibt die gespeicherte Sichtbarkeit unverändert (D3).
- Der Schalter im Einsatz zeigt den wirksamen Wert aus den Freigaben des Servers (D4).
- „Vorgabe übernehmen“ erscheint bei jedem eigenen Wert des Einsatzes (D4).
