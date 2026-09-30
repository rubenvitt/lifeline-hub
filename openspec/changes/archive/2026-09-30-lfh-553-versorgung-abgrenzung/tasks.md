# Tasks

## 1. Beleg des spezifizierten Bestands

- [x] 1.1 Die bestehenden Belege aus `design.md` („Belege je Szenario“) laufen grün. Serverseitig
  mit `cargo test --test modul_override --test einsatz_material --test verpflegung --test betreuung
  --test verbleib_betreuungsstelle --test nachforderung`, im Frontend mit Vitest über
  `stab/sachgebiete.test.ts` und `pages/VerpflegungPage.test.tsx`. Nachweis: beide Läufe ohne
  Fehler.
- [x] 1.2 In `tests/nachforderung.rs` den Charakterisierungstest
  `betriebsstoff_ist_eine_nachforderung_mit_freier_art` ergänzen. Er setzt eine Nachforderung mit
  der Art „Kraftstoff Diesel“, der Anzahl 2 und der Bezeichnung „2 × 200 l für Pumpen EA Süd“ ab
  und prüft 201, Status `angefordert`, die unveränderte Art und den ETB-Verweis. Im Dateikopf bzw.
  am Test steht LFH-553 mit dem Grund: Eine feste Artenliste ist eine neue Entscheidung. Nachweis:
  Der Test ist grün. Die Mutationsprobe macht ihn rot: In `routes/nachforderung.rs` wird
  vorübergehend jede Art außer „RTW“ abgelehnt, danach wird die Probe zurückgenommen.

## 2. Verankerung

- [x] 2.1 In `CLAUDE.md` unter „Betreuung und Verpflegung“ einen Punkt „Versorgung S4 (LFH-553)“
  einfügen. Er nennt die Träger (Verpflegung, Nachforderung mit freier Art, Material-Status), die
  eine Mengenwahrheit, die Kräfte-Unterkunft als Lücke mit dem Grund der Doppelzählung und den
  Wiedervorlage-Auslöser. Er verweist auf diese `design.md` unter ihrem Archivpfad. Nachweis:
  Jeder darin genannte Pfad existiert (`ls` je Pfad nach dem Archivieren).
- [x] 2.2 `openspec validate lfh-553-versorgung-abgrenzung --strict` läuft ohne Fehler durch.
  Nachweis: Exit-Code 0.

## 3. Abschluss

- [x] 3.1 `./scripts/check-fmt.sh` bleibt grün (Rust-Test und Markdown). Nachweis: Exit-Code 0.
- [x] 3.2 LFH-553 in ClickUp mit Verweis auf die Entscheidung kommentieren und die überholte
  Beschreibung („0 Treffer für Verpflegung“) im Kommentar richtigstellen. Kein Folge-Task ohne
  Feldbefund. Nachweis: Der Kommentar steht am Task.
