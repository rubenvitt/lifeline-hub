# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der Test, der ohne die
Änderung rot ist.

## 1. Schlüssel: Bestand und Widerruf (D1, D2)

- [x] 1.1 `unterschrift::load_bestand(conn, org_id) -> Option<Vec<i64>>`: ids der lokalen
  Schlüssel mit `zustand = 'gueltig'`, über `BESTAND_MAX` (1024) `None`. Die Grenze gilt je Antwort
  über alle Orgs (1.3). Unit-Test in
  `src/auth/unterschrift/repo/tests.rs`: wartende und widerrufene fehlen, fremde (`herkunft =
  'gegenueber'`) fehlen, über der Grenze `None`. Prüfen: `cargo test auth::unterschrift::repo`.
- [x] 1.2 `unterschrift::revoke_fehlende(conn, kopplung_org_id, &[i64], jetzt)` in einer Anweisung
  mit `json_each`. Gibt Name und Fingerabdruck der widerrufenen zurück. Unit-Test: gültige und
  wartende Schlüssel der Zuordnung ohne id in der Liste werden widerrufen, `abgelehnt` und Schlüssel
  anderer Zuordnungen bleiben, `stand` bleibt, eine leere Liste widerruft alle gültigen und
  wartenden. Prüfen: wie 1.1.
- [x] 1.3 Leitung: `MeldenOrgAntwort.unterschrift_bestand: Option<Vec<i64>>` (`serde(default)`),
  gesetzt in `handle_meldung` für jede aktive Org, solange die Antwort unter `BESTAND_MAX` ids
  bleibt, die Bytes gehen vom Budget der Stammdaten ab. `check_antwort` lehnt mehr als `BESTAND_MAX`
  ids je Antwort ab. Unit-Tests in `melden.rs`: eine Antwort ohne das Feld ist lesbar und ergibt
  `None`, eine über der Grenze wird abgelehnt, `groesste_antwort_passt_in_die_lesegrenze` rechnet
  den vollen Bestand mit. Prüfen: `cargo test instanz::melden`.
- [x] 1.4 `melden_einmal_mit`: nach `accept_lieferungen` `revoke_fehlende`, wenn ein Bestand kam,
  dazu je widerrufenem Schlüssel `UnterschriftWiderrufen` ohne Akteur mit Grund und ein Hinweis an
  der Kopplung. Integrationstest `zurueckgespielt_hub_verlorener_schluessel_gilt_am_elw_nicht_mehr`
  in `tests/instanz_kopplung.rs`: Hub legt einen Schlüssel an, er wird gegengezeichnet und
  geliefert. Danach löscht der Hub ihn (nachgestelltes Zurückspielen), der ELW meldet sich. Am ELW
  ist er widerrufen, die Admin-Spur trägt den Eintrag, die Kopplung den Hinweis. Ohne 1.4 rot.
  Prüfen: `cargo test --test instanz_kopplung zurueckgespielt`.
- [x] 1.5 Integrationstest: Ein am ELW wartender Schlüssel, den der Hub verliert, wird widerrufen
  und lässt sich danach nicht mehr bestätigen (409 bzw. der bestehende Fehler der Bestätigung). Ein
  am ELW zurückgewiesener bleibt `abgelehnt`. Prüfen: wie 1.4.

## 2. Stammdaten: Bestand und Prüfsumme (D3, D4)

- [x] 2.1 Neues Modul `src/instanz/stammdaten/bestand.rs` mit `checksum(&[(String, String)])`
  (erste 128 Bit von SHA-256, hex, über sortierte `art \x1f schluessel \n`). Unit-Tests: die Reihenfolge der Eingabe
  ändert nichts, ein anderer Schlüssel oder eine andere Art ändert die Summe, die leere Menge hat
  eine feste Summe. Prüfen: `cargo test instanz::stammdaten::bestand`.
- [x] 2.2 `bestand::load_herkunft(conn, kopplung_org_id)`: die Paare `(art, fremder_schluessel)`
  der Zuordnung. `bestand::load(conn, org_id, arten)`: Bestand je Art nach D4 (Bereich,
  Stellvertreter, Archiv, Gerätekonten, geschnitten mit dem Log). Unit-Test über eine Org mit den
  Demo-Daten, Org-Einstellungen, einer Sprechgruppe außerhalb des Bereichs (auch einer, die aus dem
  Katalog in einen Einsatz wandert), einem Stellvertreter-, einem Archiv- und einem Gerätekonto: Ein Schlüssel des Logs steht genau dann im Bestand, wenn `build_lieferung` für ihn
  keine Löschung baut (dafür `build_lieferung` `pub(super)`). Prüfen: wie 2.1.
- [x] 2.3 `liefern::load_hoechster_stand(conn, org_id)` (`MAX(stand)` der Log-Zeilen der Org in den
  Arten der Meldung, 0 ohne). Unit-Test mit zwei Orgs und einer Art, die die Gegenseite nicht kennt. Prüfen: `cargo test instanz::stammdaten::liefern`.

## 3. Stammdaten: Leitung und Sendebremse (D3, D5, D6)

- [x] 3.1 Leitung: `MeldenOrg.stammdaten_checksum: Option<String>`,
  `MeldenOrgAntwort.stammdaten_bestand: Option<Vec<StammdatenBestand>>` (`art`, `schluessel`),
  beide mit `serde(default)` und `skip_serializing_if`. `check_antwort`: höchstens `ARTEN_MAX` Arten
  je Org, höchstens `BESTAND_STAMMDATEN_MAX` Schlüssel je Antwort. Unit-Tests wie 1.3. Prüfen:
  `cargo test instanz::melden`.
- [x] 3.2 Sendebremse in `bestand.rs`: `can_send(kennung, kopplung_org_id, pruefsumme, jetzt)` und
  `mark_sent(…)`, Abstand 10 Minuten. Die Zeit kommt als Parameter. Unit-Tests: erster Aufruf
  ja, gleiche Summe vor 10 Minuten nein, danach ja, andere Summe sofort ja, andere Kennung
  unabhängig. Prüfen: wie 2.1.
- [x] 3.3 `handle_meldung`: Liste nach D5 bilden (Bedingungen 1–5), Restbudget abziehen, gesendete
  Einträge sammeln und nach dem Commit merken. `melden_einmal_mit`: Prüfsumme je Quell-Org aus der
  Herkunft melden. Integrationstests in `tests/instanz_stammdaten.rs`: (a) gleicher Bestand, keine
  Liste; (b) frisch gekoppelt mit mehr Zeilen als eine Antwort trägt, keine Liste, bis alles da ist.
  Ob eine Liste ging, zeigt die Sendebremse (`bestand::last_sent`, nur lesend). Prüfen:
  `cargo test --test instanz_stammdaten -- gleicher_bestand waehrend_der`.

## 4. Stammdaten: Abräumen am ELW (D7)

- [x] 4.1 `melden_einmal_mit`: Trägt die Antwort einen Bestand, die fehlenden Paare der gelisteten
  Arten als Löschungen durch `uebernehmen` schicken, Ergebnis wie bei der Lieferung verbuchen
  (Sitzungen, Ereignis), Hinweis an der Org-Zuordnung. Integrationstest
  `zurueckgespielt_hub_verlorenes_fahrzeug_verschwindet_am_elw`: Hilfe `hub_verliert` (Zeile und
  Log über dem Stand der Sicherung löschen, Zähler zurücksetzen). Am ELW ist das Fahrzeug
  danach weg, und die Zuordnung trägt den Hinweis. Ohne 4.1 rot. Prüfen:
  `cargo test --test instanz_stammdaten zurueckgespielt`.
- [x] 4.2 Integrationstests: Ein verlorenes Material, das am ELW ein Einsatz nutzt, wird
  stillgelegt. Ein
  verlorenes Konto wird deaktiviert, seine Sitzung am ELW endet. Hat der Hub nach dem Zurückspielen
  vor der Meldung ein Fahrzeug angelegt, sind die verlorenen Zeilen trotzdem abgeräumt, und keine
  geführte Zeile fehlt am ELW. Prüfen: wie 4.1.
- [x] 4.3 Integrationstest Sendebremse: Eine bleibende Abweichung (eine Zeile, die der ELW nicht
  übernehmen kann, Muster `gleicher_kontoname_bleibt_draussen_bis_zum_erneuten_abgleich`) schickt bei
  zwei Meldungen hintereinander nur einmal die Liste. Prüfen:
  `cargo test --test instanz_stammdaten bleibende`.

## 5. Doku und Gates

- [x] 5.1 `docs/betrieb/backup-restore.md`, Abschnitt „Gekoppelte Instanz zurückspielen“: Verlorene
  Schlüssel und Stammdaten-Zeilen räumt der ELW selbst ab, mit Hinweis an der Kopplung. Prüfen:
  Abschnitt gelesen, Verweise stimmen.
- [x] 5.2 `docs/anwender/kapitel/instanzkopplung.md`: die beiden neuen Hinweise am ELW und was sie
  bedeuten, nach den Regeln in `docs/anwender/AGENTS.md`. Prüfen: die Wächter aus
  `docs/anwender/AGENTS.md` laufen grün.
- [x] 5.3 `src/AGENTS.md`, Instanzkopplung: eine Zeile zu Stammdaten-Verteilung bzw.
  Unterschriftsschlüsseln. Der Bestand des Hubs (`stammdaten::bestand::load`) muss zu
  `build_lieferung` passen, eine neue Sonderregel dort gehört auch dorthin. Verweis auf diese
  Change. Prüfen: `scripts/check-fmt.sh` grün.
- [x] 5.4 `./scripts/check-all.sh --geaendert`: lokal Schritte 1–3 (Format, Lint, Typ-Drift) grün und
  das Bündel `--nur schnell` vor dem PR. Die volle Rust- und Frontend-Suite passte nicht in den
  Plattenplatz der Cloud-Sitzung; sie belegt die CI des PRs. Lokal grün sind die Unit-Tests der
  geänderten Module und alle `tests/instanz_*.rs`.

## 6. Befunde aus dem Review vor dem PR

- [x] 6.1 Wettlauf zweier Meldungen: `apply_bestaende` räumt nur ab, wenn die Stände der
  Zuordnung vor den Lieferungen noch die gemeldeten sind (`repo::load_staende`). Unit-Tests
  `ueberholte_bestaende_raeumen_nichts_ab`, `aktuelle_bestaende_raeumen_ab`,
  `ohne_quelle_bleiben_die_zeilen`. Prüfen: `cargo test instanz::melden`.
- [x] 6.2 Bestand der Schlüssel nur bei vollständiger Nachlieferung. Integrationstest
  `widerruf_jenseits_der_ersten_seite_gilt_nicht_als_verloren`. Prüfen:
  `cargo test --test instanz_kopplung widerruf_jenseits`.
- [x] 6.3 Hinweise „abgelehnt“ und „nicht mehr geführt“ derselben Meldung in einem Text,
  Hinweise in Einzahl und Mehrzahl. Tests `zurueckgespielt_hub_ablehnung_und_verlust_stehen_beide_an_der_kopplung`,
  `hinweise_zum_abraeumen_in_einzahl_und_mehrzahl`. Prüfen: wie 6.1 und 6.2.
- [x] 6.4 Der Hub hält `BESTAND_STAMMDATEN_MAX` beim Senden ein (`take_bestand`). Unit-Test
  `bestand_der_stammdaten_passt_nach_bytes_und_zahl`. Prüfen: `cargo test instanz::melden`.
- [x] 6.5 Wächter `bestand_ist_was_als_zeile_geliefert_wird` mit einer Zeile jeder Art. Prüfen:
  `cargo test instanz::stammdaten::bestand`.
- [x] 6.6 Betriebsdoku, Anwenderdoku und Delta-Spec zur neu vergebenen id und zu den
  Hinweistexten berichtigt. Prüfen: Abschnitte gelesen, `openspec validate --strict`.

- [x] 6.7 Nachreview des Behebungs-Commits: Hinweis der Führung derselben Meldung kommt in denselben
  Text, `take_bestand` zählt Bytes und Schlüssel über alle Orgs herunter (Unit-Test über zwei
  Orgs), Spec, Kapitel und Betriebsdoku zu „vollständig“ und zur neu vergebenen id. Prüfen:
  `cargo test instanz::melden`, `cargo test --test instanz_kopplung`, `openspec validate --strict`.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive` im selben Branch vor dem PR.
- Nach dem Merge von LLH-1853: `alpha` nachmergen, Konflikte in `handle_meldung` auflösen.
