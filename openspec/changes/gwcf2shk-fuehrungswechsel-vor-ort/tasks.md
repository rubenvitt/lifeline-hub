# Tasks

Jede Aufgabe entsteht per TDD: zuerst ein Test, der rot wird, dann der Code (AGENTS.md, „Planung und
Ausführung“).

## 1. Protokoll 4 und Wechselregel (D1, D7)

- [x] 1.1 Protokoll anheben und Wechselregel einführen
  - `PROTOKOLL = 4` und `PROTOKOLL_FUEHRUNG_VOR_ORT = 4` setzen.
  - `Wechselregel` mit `wechselregel(art, gegenueber_protokoll)` anlegen, dazu Zugriffe an
    `KopplungZeile` und `FuehrungGegenueber`.
  - Den Doc-Kommentar von `Fluss::Fuehrungswechsel` auf „nach Richtung“ ändern.
  - Belegt durch einen Unit-Test über alle Kombinationen (`standard`; `vor_ort` mit 3, 4 und ohne
    Protokoll).
  - `cargo test instanz::` ist grün; die Tests zum Protokollfenster sind auf 4 nachgezogen.
- [x] 1.2 `FuehrungGegenueber` liefert `wechsel` und den Grund bei `gesperrt`
  - Typ-Codegen nachziehen (`scripts/check-typ-codegen.sh`), beide generierten Dateien
    mitcommitten.
- [x] 1.3 Wächter `jeder_fluss_hat_seine_pruefstellen` umstellen
  - Er zählt `wechselregel(` in `dienst.rs` und `austausch.rs`.
  - Probe: wird eine Stelle entfernt, wird der Test rot.

## 2. Bedienung vor Ort (D1, `dienst.rs`, Routen)

- [x] 2.1 `fordere_wechsel` und die Prüfungen auf die Richtung folgen der Wechselregel
  - `code_abgeben`, `anfragen` und `build_erklaerung_gegen_meldende` sind bei `Gleichrangig` in
    beide Richtungen erlaubt.
  - `notuebernahme_gegen_erreichte` antwortet bei `Gleichrangig` mit 422, bei `Gesperrt` mit 409
    und dem Update-Hinweis.
  - Belegt durch Tests in `tests/instanz_vor_ort.rs`: je Bedienung einmal erlaubt (Protokoll 4)
    und einmal gesperrt (Protokoll 3).
- [x] 2.2 `repo::list_hubs` zählt gleichrangige Gegenstellen mit
  - Gemeint sind die Gegenüber, deren Übernahme hier ein Mensch entscheidet.
  - Damit gilt eine offene Übernahme vor Ort an der erreichten Seite nicht als Konflikt:
    `bestaetigen`, `widersprechen` und `anzeige` behandeln sie wie gegen den Hub.
  - Belegt durch einen Test „Bestätigen und Widersprechen an der erreichten Seite einer
    Direktkopplung“.

## 3. Annahmeregel vor Ort (D2, D3)

- [x] 3.1 `entscheide_vor_ort` als reine Funktion mit Regel, `bewiesen` und `antwort`
  - Ergebnisse: Annehmen, Antwort annehmen, OffenHalten, Verwerfen, NurAnzeige.
  - Die Tabelle aus D2 ist als Test über alle Zellen festgehalten
    (`annahmeregel_vor_ort_ueber_alle_zellen` erweitern).
- [x] 3.2 `apply_eingang` umbauen
  - Der Zweig für vor Ort läuft vor den Zweigen, die von der Richtung abhängen; der Block
    „dritter führt“ der meldenden Seite greift für `vor_ort` nicht mehr.
  - Die Prüfung des Beweises nutzt `check_unterschrift` und `check_code`.
  - Code bei gleicher Epoche, „Bestätigt nachtragen“ und `check_offene` gelten bei `Gleichrangig`
    an beiden Seiten.
  - Belegt durch Integrationstests in `tests/instanz_vor_ort.rs`:
    - Notübernahme mit Unterschrift von der einlösenden und von der ausstellenden Seite, jeweils
      offen und dann bestätigt;
    - mit Code;
    - ohne gültigen Beweis: verworfen mit Alarm und Spur;
    - Gegenstelle mit Protokoll 3: wie bisher verworfen.
- [x] 3.3 Antwort auf die eigene Übernahme (D3)
  - Widerspruch und Verwerfen werden an der übernehmenden Seite mit Alarm, Spur und Hinweis
    angenommen.
  - Eine spätere Akte, mit der der Sender die Führung beansprucht, ohne Beweis, wird verworfen.
  - Belegt durch einen Test „kein Hin und Her“ über zwei Runden.

## 4. Anfrage vor Ort (D4)

- [x] 4.1 Migration für `einsatz_fuehrung.anfrage_abgelehnt`
  - Zusammen mit `unterschrift_schluessel.weiter_stand` und
    `instanz_kopplung_org.unterschrift_grundstock_bis` in einer Migration mit der nächsten freien
    Nummer.
  - `scripts/check-migrationen.sh` gegen `origin/alpha` ist grün.
- [x] 4.2 Austausch der Anfrage
  - `AkteMeldung.anfrage_abgelehnt` ist optional und `serde(default)`.
  - Am Führer setzt eine Anfrage `anfrage_von`; nur ein neu gesetztes `anfrage_von` löst
    `Folge::Anfrage` aus.
  - `erfuelle_anfrage` und `erfuelle_wartende` gelten nur `NachRichtung`.
  - Der Anfragende nimmt die Ablehnung an.
  - Belegt durch Integrationstests:
    - die Anfrage bleibt offen und erzeugt genau eine Benachrichtigung über drei Meldungen;
    - Übergeben auf Anfrage;
    - Ablehnen, danach zeigt die anfragende Seite „Anfrage abgelehnt“;
    - eine neue Anfrage nach der Ablehnung wird wieder angezeigt;
    - eine Hub-Anfrage bleibt automatisch.
- [x] 4.3 Route und Anzeige
  - Neue Route `POST …/fuehrung/anfrage/ablehnen` an beiden Orten (lokaler Einsatz, Akte des
    Gegenübers), Recht wie bei der Übergabe.
  - `FuehrungAnzeige.anfrage_eingang` und `anfrage_abgelehnt` liefern, mit Typ-Codegen.
  - Belegt durch Tests für 403, 409 (keine Anfrage) und 200.
- [x] 4.4 Benachrichtigungsart `fuehrung_angefragt`
  - Variante, Titel, Stufe Hinweis, Pfad zum Paneel „Führung“ anlegen.
  - Migration zum Neubau von `benachrichtigung` nach Muster 0316; `check_listen_entsprechen_dem_katalog`
    ist grün.
  - `tests/enum_wire_kontrakt.rs` nachziehen.
  - Belegt durch einen Test „Einsatzleitung bekommt ‚Führung angefragt‘“.

## 5. Nachziehen am Hub (D5)

- [x] 5.1 `check_unterschrift` auf den bisherigen Führer `gegen` verallgemeinern
  - Die vorhandenen Tests bleiben grün.
- [x] 5.2 Regeln (a) Zeuge und (b) Unterschrift in `apply_eingang` (`WirdGemeldet`, Standardkopplung)
  - Belegt durch Integrationstests mit Hub, ELW 1 und ELW 2:
    - ELW 1 bestätigt, der Hub folgt;
    - ELW 1 bleibt aus, Unterschrift: der Hub folgt mit Spur;
    - nur Code: der Hub lehnt mit Hinweis ab;
    - ELW 1 widerspricht nach (b): alle drei landen bei ELW 1;
    - ein ELW ohne Zeugen und ohne Unterschrift beansprucht weiter vergeblich (Schutz aus PR #1243).

## 6. Unterschriftsschlüssel über die Direktkopplung (D6)

- [x] 6.1 `weiter_stand` und Widerruf je Credential-ID
  - `weiter_stand` wird beim Gültigwerden und beim Widerruf einer übernommenen Zeile vergeben;
    `next_stand` nimmt das Maximum beider Stände.
  - Ein Widerruf gilt je Credential-ID in `accept_lieferungen`, `widerrufen`,
    `alle_des_benutzers_widerrufen` und `fremde_der_zuordnung_widerrufen`.
  - Die Prüfung „schon widerrufen oder abgelehnt“ gilt org-weit.
  - Belegt durch Unit-Tests in `auth::unterschrift::repo`.
- [x] 6.2 Grundstock und Nachlieferung über `vor_ort`
  - Inhalt: `lokal` und `gegenueber`, ohne die Zeilen derselben Zuordnung; dazu `aufnahme_org`.
  - `check_gegenzeichnung` liest `aufnahme_org`.
  - Belegt durch Tests:
    - ein Schlüssel des Hubs erreicht ELW 2 über ELW 1 im Grundstock;
    - ein später gegengezeichneter erreicht ELW 2 als wartend;
    - kein Kreislauf zurück über dieselbe Zuordnung.
- [x] 6.4 Schlüssel vom ELW zum Hub (Nachtrag 13.11.2026, mit Ruben abgestimmt)
  - Die meldende Seite einer Standardkopplung liefert ihre lokalen Schlüssel ohne
    Gegenzeichnung; am Hub wartet jeder auf die Bestätigung eines Admins
    (`GegenzeichnungPflicht::NurBestaetigung`).
  - Belegt durch `der_hub_folgt_einer_notuebernahme_vor_ort_mit_bestaetigtem_schluessel` (wartet,
    erst nach der Bestätigung folgt der Hub).
- [x] 6.3 Schlüssel von der meldenden zur erreichten Seite
  - Nur über `vor_ort`: `MeldenAnfrage.orgs[].unterschrift` mit `grundstock_bis` und Byte-Budget;
    Quittung in der `MeldenAntwort`.
  - Die erreichte Seite übernimmt bis zu `unterschrift_grundstock_bis` als Grundstock.
  - Belegt durch Tests:
    - Grundstock gilt sofort;
    - ein späterer Neuzugang wartet;
    - eine spätere andere Angabe von `grundstock_bis` wird überlesen;
    - die größte Anfrage passt in 64 KiB (`melden::tests`).
  - Spec `org-admin-unterschrift`, Szenario „Notübernahme, die Admin A an ELW 1 unterschreibt, …
    als bewiesen“, als Integrationstest.

## 7. Oberfläche (D8)

- [x] 7.1 `fuehrungText.fuehrungMoeglich` liest `wechsel` statt `art` und `richtung`
  - Der Text „kommt später“ entfällt; neu sind der Update-Hinweis und „Anfrage abgelehnt“.
  - Belegt durch Tests in `fuehrungText.test.ts` je Regel.
- [x] 7.2 `FuehrungPaneel`
  - Block „<Name> bittet um die Führung“ mit „Übergeben“ und „Ablehnen“ (`api/fuehrung.ts`, neue
    Mutation).
  - Der Notübernahme-Dialog verlangt vor Ort einen Beweis.
  - Belegt durch Tests in `FuehrungPaneel.test.tsx`.
- [x] 7.3 Kopplungskarte und Benachrichtigung
  - Die Kopplungskarte zeigt bei `gesperrt` den Update-Hinweis (`instanzText.ts`); der Tooltip
    `VOR_ORT_ERKLAERUNG` ist angepasst.
  - Katalogeintrag `fuehrung_angefragt` in `alarm/benachrichtigungKatalog.ts` mit Sprung.
  - Belegt durch Tests, `mise exec -- pnpm -C frontend lint`, Typprüfung und Prettier.

## 8. Doku und Regeln (D9)

- [x] 8.1 Anwenderdoku `docs/anwender/kapitel/instanzkopplung.md`
  - Führungswechsel vor Ort: Übergabe, Code, Anfrage mit Übergeben/Ablehnen, Notübernahme mit
    Beweis, Widerspruch, Hub zieht nach, Update-Hinweis.
  - Bilder und Wächter nach `docs/anwender/AGENTS.md`; der Doku-Wächter ist grün.
- [x] 8.2 ADR „Über eine Direktkopplung gibt keine Seite ohne Beweis und ohne ihre Einsatzleitung ab“
  - Nächste freie Nummer nach `git fetch origin alpha`, mit Prüfzeilen.
  - Verweis in ADR-0033 und arc42 Kapitel 8.
  - `scripts/adr-fuer.sh src/instanz/fuehrung/austausch.rs` nennt sie; die ADR-Prüfungen sind grün.
- [x] 8.3 `src/AGENTS.md` anpassen
  - Abschnitte „Führung je Einsatz“ (Tabellen von `v6hj7xl2`/`faq7l7m4` um diese Change ergänzt,
    Nachziehen am Hub) und „Direktkopplung vor Ort“ (Wechselregel statt `traegt`).
  - Die Verweise sind gegrept.
- [x] 8.4 Versionshinweis
  - Protokoll 4: erst alle Instanzen auf Protokoll 3, Protokoll 2 fällt aus dem Fenster.
  - Neuer Führungswechsel vor Ort.
  - Ablage nach der Regel unter `openspec/changes/neuigkeiten-versionshinweise` bzw. der Ablage der
    Versionshinweise.

## 9. Integration

- [x] 9.1 Gesamtlauf über Hub, ELW 1 und ELW 2 auf Loopback in `tests/instanz_vor_ort.rs`
  - ELW 1 führt, fällt aus; ELW 2 übernimmt mit Unterschrift; der Hub folgt; ELW 1 kommt zurück
    und bestätigt.
  - Alle drei zeigen ELW 2, die Spiegel folgen.
- [ ] 9.2 `./scripts/check-all.sh` ist grün
  - Abhaken mit Verweis auf den CI-Lauf des PRs, falls lokal nicht vollständig.

## Workflow follow-up

- Review vor dem PR (Skelett „Review-find-verify“, Backend und Frontend).
- `/opsx:archive gwcf2shk-fuehrungswechsel-vor-ort` im selben Branch vor dem PR, Verweise nachziehen.
- Bilder der Änderung (Paneel „Führung“ mit Anfrage, Notübernahme-Dialog vor Ort, Kopplungskarte
  mit Update-Hinweis) in PR und Meldung.
