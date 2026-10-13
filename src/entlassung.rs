//! Lebenszustand einer Kraft im Einsatz (LLH-1079, Spec `kraefte-entlassung`).
//!
//! Eine Dispositionszeile wird nicht mehr gelöscht. Sie endet mit `beendet_at`, `beendet_von`
//! und `beendet_als`: **entlassen** ist der Normalweg (die Kraft bleibt im Nachweis),
//! **storniert** korrigiert eine Fehldisposition kurz nach dem Disponieren (die Kraft erscheint
//! in keinem Nachweis, ihre Ereignisse aus der Disposition sind gestrichen). Aktiv heißt
//! `beendet_at IS NULL`; jede Liste, Auswahl und Zahl liest nur aktive Kräfte (Wächter
//! `jede_abfrage_der_kraeftetabellen_prueft_den_zustand`). Eine Einheit wird aufgelöst
//! (`aufgeloest_at`) oder, ohne jede Spur, echt gelöscht.
//!
//! Herleitung: Change `k0s07wsn-kraefte-entlassen`, design.md D2/D3.

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Wie eine Kraft den Einsatz verließ. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BeendetAls {
        /// Aus dem Einsatz entlassen; bleibt im Nachweis.
        Entlassen => "entlassen",
        /// Fehldisposition storniert; in keinem Nachweis.
        Storniert => "storniert",
    }
    try_from = |s| format!("Ungültiger Endzustand: {s}");
}

/// So lange nach der Disposition lässt sich eine Kraft stornieren (design.md D3, Regel 4).
pub const STORNO_FRIST_MINUTEN: i64 = 15;

/// Streichgrund der Ereignisse einer stornierten Kraft.
pub const GRUND_STORNO: &str = "Fehldisposition storniert";

/// Satz der 422, wenn die Storno-Frist abgelaufen ist.
pub fn storno_frist_text() -> String {
    format!(
        "Stornieren geht nur in den ersten {STORNO_FRIST_MINUTEN} Minuten nach der Disposition; \
         die Kraft lässt sich entlassen"
    )
}

/// Liegt `disponiert_at` höchstens [`STORNO_FRIST_MINUTEN`] vor `jetzt`? Beide im kanonischen
/// Format (`crate::zeit::FORMAT`); ein unlesbarer Zeitpunkt gilt als abgelaufen.
pub fn is_in_storno_frist(disponiert_at: &str, jetzt: &str) -> bool {
    match crate::zeit::plus_minuten(disponiert_at, STORNO_FRIST_MINUTEN) {
        Some(grenze) => jetzt <= grenze.as_str(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frist_endet_nach_fuenfzehn_minuten() {
        let d = "2026-10-13 10:00:00";
        assert!(is_in_storno_frist(d, "2026-10-13 10:05:00"));
        assert!(is_in_storno_frist(d, "2026-10-13 10:15:00"));
        assert!(!is_in_storno_frist(d, "2026-10-13 10:15:01"));
        assert!(!is_in_storno_frist(d, "2026-10-13 10:20:00"));
        assert!(!is_in_storno_frist("kaputt", "2026-10-13 10:00:00"));
        assert!(storno_frist_text().contains("nur in den ersten 15 Minuten nach der Disposition"));
    }

    #[test]
    fn endzustand_parse_rund() {
        for a in BeendetAls::ALLE {
            assert_eq!(BeendetAls::parse(a.as_str()), Some(a));
        }
        assert_eq!(BeendetAls::parse("geloescht"), None);
    }

    /// Erlaubte ungefilterte Lesestellen: Datei, Anzahl, Grund. Alles andere liest nur aktive
    /// Kräfte (`beendet_at IS NULL`, `aufgeloest_at IS NULL`) oder eine Zeile per Primärschlüssel.
    const ALLOWLIST: &[(&str, usize, &str)] = &[
        (
            "src/aufbewahrung/suche.rs",
            1,
            "Auskunft und Schwärzung finden jede Kraft des Einsatzes, auch beendete",
        ),
        (
            "src/einheit/repo.rs",
            1,
            "Spurprüfung vor dem echten Löschen zählt jede Personalzeile der Einheit",
        ),
        (
            "src/personal/disposition_repo.rs",
            1,
            "Disponieren einer Stamm-Person sucht ihre Zeile auch beendet, um sie wieder aufzunehmen",
        ),
    ];

    /// Wächter (design.md D6): Jede SQL-Zeichenkette im Produktivcode, die `einsatz_personal` oder
    /// `einsatz_einheit` per `FROM`/`JOIN` liest, prüft den Lebenszustand der Zeile oder greift
    /// per Primärschlüssel auf genau eine Zeile zu (Namensauflösung eines Bezugs). Ausnahmen
    /// stehen mit Grund in [`ALLOWLIST`]; die Zahl muss genau stimmen, damit eine neue Stelle
    /// in einer gelisteten Datei auffällt und eine erledigte Ausnahme verschwindet.
    #[test]
    fn jede_abfrage_der_kraeftetabellen_prueft_den_zustand() {
        let wurzel = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut dateien = Vec::new();
        collect_rs(&wurzel.join("src"), &mut dateien);
        let mut fehler = Vec::new();
        let gezaehlt = scan(&dateien);
        for (datei, stellen) in &gezaehlt {
            let erlaubt = ALLOWLIST
                .iter()
                .find(|(d, _, _)| datei.ends_with(d))
                .map_or(0, |(_, n, _)| *n);
            if stellen.len() != erlaubt {
                fehler.push(format!(
                    "{datei}: {} ungefilterte Lesestelle(n), gelistet {erlaubt}:\n    {}",
                    stellen.len(),
                    stellen.join("\n    ")
                ));
            }
        }
        for (datei, n, _) in ALLOWLIST {
            if !gezaehlt.keys().any(|k| k.ends_with(datei)) {
                fehler.push(format!(
                    "{datei}: gelistet {n}, gefunden 0 — Eintrag entfernen"
                ));
            }
        }
        assert!(
            fehler.is_empty(),
            "Lesestellen ohne Zustandsfilter (`beendet_at IS NULL` / `aufgeloest_at IS NULL`, \
             sonst Primärschlüssel oder Eintrag in ALLOWLIST mit Grund):\n{}",
            fehler.join("\n")
        );
    }

    #[test]
    fn waechter_erkennt_filter_primaerschluessel_und_luecke() {
        let pruefe = |sql: &str| find_unfiltered_reads(sql);
        assert_eq!(
            pruefe("SELECT id FROM einsatz_personal WHERE einsatz_id = ?"),
            ["einsatz_personal"]
        );
        assert!(pruefe(
            "SELECT id FROM einsatz_personal WHERE einsatz_id = ? AND beendet_at IS NULL"
        )
        .is_empty());
        assert!(pruefe("SELECT name FROM einsatz_personal WHERE id = ?1").is_empty());
        assert!(
            pruefe("SELECT ep.name FROM x JOIN einsatz_personal ep ON ep.id = x.personal_id")
                .is_empty()
        );
        assert!(pruefe("SELECT e.name FROM einsatz_einheit AS e WHERE e.id IN (1)").is_empty());
        assert_eq!(
            pruefe(
                "SELECT 1 FROM einsatz_einheit e JOIN einsatz_personal ep ON ep.einheit_id = e.id \
                    WHERE e.aufgeloest_at IS NULL"
            ),
            ["einsatz_personal"]
        );
        assert_eq!(
            pruefe(
                "SELECT id FROM einsatz WHERE id = ?1 UNION ALL SELECT id FROM einsatz_einheit \
                 WHERE einsatz_id = ?1"
            ),
            ["einsatz_einheit"]
        );
        assert_eq!(
            pruefe("select count(*) from einsatz_einheit\n where einsatz_id = ?"),
            ["einsatz_einheit"]
        );
        // Die Spalte nur zu nennen, filtert nicht: verlangt ist ein Prädikat.
        assert_eq!(
            pruefe(
                "SELECT ep.beendet_at, ep.name FROM einsatz_personal ep WHERE ep.einsatz_id = ?"
            ),
            ["einsatz_personal"]
        );
        assert_eq!(
            pruefe("SELECT e.aufgeloest_at AS ende FROM einsatz_einheit e WHERE e.einsatz_id = ?"),
            ["einsatz_einheit"]
        );
        assert!(
            pruefe("SELECT ep.id FROM einsatz_personal ep WHERE ep.beendet_als = 'entlassen'")
                .is_empty()
        );
        assert!(pruefe(
            "SELECT e.id FROM einsatz_einheit e WHERE e.einsatz_id = ? AND e.aufgeloest_at IS NOT NULL"
        )
        .is_empty());
        // `{KONST}` in einem format!-Literal wird aufgelöst; die Konstante allein ist Bruchstück.
        let datei = |text: &str| vec![("src/x.rs".to_string(), text.to_string())];
        let sel = "const SEL: &str = \"SELECT ep.beendet_at FROM einsatz_personal ep\";\n";
        assert_eq!(
            scan(&datei(&format!(
                "{sel}fn a() {{ format!(\"{{SEL}} WHERE ep.einsatz_id = ?\"); }}"
            )))
            .into_values()
            .flatten()
            .collect::<Vec<_>>(),
            ["src/x.rs:2 (einsatz_personal)"]
        );
        assert!(scan(&datei(&format!(
            "{sel}fn a() {{ format!(\"{{SEL}} WHERE ep.einsatz_id = ? AND ep.beendet_at IS NULL\"); }}"
        )))
        .is_empty());
        // Direkt benutzt, wird die Konstante selbst geprüft.
        assert_eq!(
            scan(&datei(&format!("{sel}fn a() {{ sqlx::query(SEL); }}")))
                .into_values()
                .flatten()
                .collect::<Vec<_>>(),
            ["src/x.rs:1 (einsatz_personal)"]
        );
        let quelle = "let a = 'x'; let b = r#\"SELECT 1 FROM einsatz_einheit\"#; // \"FROM einsatz_personal\"\nlet c = \"a\\\"b\";";
        let l = literals(quelle);
        assert_eq!(l.len(), 2, "{l:?}");
        assert_eq!(l[0], (1, "SELECT 1 FROM einsatz_einheit".to_string()));
    }

    /// Ungefilterte Lesestellen je Datei (`pfad:zeile (tabelle)`) im Produktivcode, also vor
    /// `#[cfg(test)]`.
    fn scan(dateien: &[(String, String)]) -> std::collections::BTreeMap<String, Vec<String>> {
        let produktiv: Vec<(&String, &str)> = dateien
            .iter()
            .map(|(p, q)| (p, q.split("#[cfg(test)]").next().unwrap_or("")))
            .collect();
        // `const NAME: &str = "…"` der Datei (sonst des Crates); als `{NAME}` eingesetzt ist sie
        // ein Bruchstück und wird erst im zusammengesetzten Literal geprüft.
        let mut crate_weit = std::collections::BTreeMap::new();
        for (_, quelle) in &produktiv {
            crate_weit.extend(str_consts(quelle));
        }
        let mut gezaehlt: std::collections::BTreeMap<String, Vec<String>> = Default::default();
        for (pfad, quelle) in produktiv {
            let eigene = str_consts(quelle);
            let mut konstanten = crate_weit.clone();
            konstanten.extend(eigene.iter().cloned());
            // Nur eingesetzt: außer Definition und `{NAME}` keine direkte Verwendung in der Datei.
            let nur_eingesetzt = |name: &str| {
                let eingesetzt = quelle.matches(&format!("{{{name}}}")).count();
                let wort = quelle
                    .match_indices(name)
                    .filter(|(i, _)| {
                        let vor = quelle[..*i].chars().next_back();
                        let nach = quelle[i + name.len()..].chars().next();
                        !vor.is_some_and(|c| c.is_alphanumeric() || c == '_')
                            && !nach.is_some_and(|c| c.is_alphanumeric() || c == '_')
                    })
                    .count();
                eingesetzt > 0 && wort == 1 + eingesetzt
            };
            for (zeile, roh) in literals(quelle) {
                if eigene.iter().any(|(n, v)| *v == roh && nur_eingesetzt(n)) {
                    continue;
                }
                let mut literal = roh;
                for _ in 0..3 {
                    for (name, wert) in &konstanten {
                        literal = literal.replace(&format!("{{{name}}}"), wert);
                    }
                }
                for tabelle in find_unfiltered_reads(&literal) {
                    gezaehlt
                        .entry(pfad.clone())
                        .or_default()
                        .push(format!("{pfad}:{zeile} ({tabelle})"));
                }
            }
        }
        gezaehlt
    }

    /// Tabellen, die `sql` per `FROM`/`JOIN` ohne Zustandsfilter und ohne Primärschlüssel liest.
    fn find_unfiltered_reads(sql: &str) -> Vec<&'static str> {
        const TABLES: &[(&str, &str)] = &[
            ("einsatz_personal", "beendet_at"),
            ("einsatz_einheit", "aufgeloest_at"),
        ];
        const NO_ALIAS: &[&str] = &[
            "where",
            "on",
            "join",
            "left",
            "inner",
            "cross",
            "set",
            "order",
            "group",
            "limit",
            "union",
            "and",
            "or",
            "using",
            "having",
            "returning",
            "values",
        ];
        let klein = sql.to_lowercase();
        let tokens: Vec<String> = klein
            .replace(['(', ')', ',', ';'], " ")
            .replace('=', " = ")
            .split_whitespace()
            .map(str::to_string)
            .collect();
        let mut treffer = Vec::new();
        for i in 0..tokens.len().saturating_sub(1) {
            if tokens[i] != "from" && tokens[i] != "join" {
                continue;
            }
            let Some((tabelle, spalte)) = TABLES.iter().find(|(t, _)| tokens[i + 1] == *t) else {
                continue;
            };
            let mut alias = tokens.get(i + 2).map(String::as_str);
            if alias == Some("as") {
                alias = tokens.get(i + 3).map(String::as_str);
            }
            let alias = match alias {
                Some(a)
                    if !NO_ALIAS.contains(&a)
                        && a.chars().all(|c| c.is_alphanumeric() || c == '_') =>
                {
                    a
                }
                _ => tabelle,
            };
            // Ein Prädikat auf den Lebenszustand, nicht bloß die Spalte in der Auswahl.
            let spalte_qualifiziert = format!("{alias}.{spalte}");
            let gefiltert = (0..tokens.len()).any(|j| {
                let t = tokens[j].as_str();
                let nach = tokens.get(j + 1).map(String::as_str);
                let nach2 = tokens.get(j + 2).map(String::as_str);
                let ist_null_test =
                    nach == Some("is") && matches!(nach2, Some("null") | Some("not"));
                let zustand = (t == *spalte || t == spalte_qualifiziert) && ist_null_test;
                let als = *tabelle == "einsatz_personal"
                    && (t == "beendet_als" || t == format!("{alias}.beendet_als"))
                    && matches!(nach, Some("=") | Some("<>") | Some("in") | Some("is"));
                zustand || als
            });
            if gefiltert {
                continue;
            }
            let qualifiziert = format!("{alias}.id");
            // Ein unqualifiziertes `id` gehört zur Tabelle nur bis zur nächsten Quelle.
            let abschnitt_ende = (i + 2..tokens.len())
                .find(|&k| matches!(tokens[k].as_str(), "from" | "join" | "union"))
                .unwrap_or(tokens.len());
            let per_schluessel = (0..tokens.len()).any(|j| {
                let t = tokens[j].as_str();
                let vor = j.checked_sub(1).map(|k| tokens[k].as_str());
                let nach = tokens.get(j + 1).map(String::as_str);
                let vergleich = matches!(nach, Some("=") | Some("in")) || vor == Some("=");
                (t == qualifiziert && vergleich)
                    || (t == "id"
                        && j > i + 1
                        && j < abschnitt_ende
                        && matches!(vor, Some("where") | Some("and"))
                        && vergleich)
            });
            if !per_schluessel {
                treffer.push(*tabelle);
            }
        }
        treffer
    }

    /// `const NAME: &str = "…";` (auch `&'static str`) einer Quelle: Name und Literal.
    fn str_consts(quelle: &str) -> Vec<(String, String)> {
        let mut aus = Vec::new();
        for (i, _) in quelle.match_indices("const ") {
            let rest = &quelle[i + 6..];
            let Some(doppelpunkt) = rest.find(':') else {
                continue;
            };
            let name = rest[..doppelpunkt].trim();
            if name.is_empty()
                || !name
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            {
                continue;
            }
            let typ_und_wert = &rest[doppelpunkt + 1..];
            let Some(gleich) = typ_und_wert.find('=') else {
                continue;
            };
            let typ = typ_und_wert[..gleich].replace(' ', "");
            if typ != "&str" && typ != "&'staticstr" {
                continue;
            }
            if let Some((_, wert)) = literals(&typ_und_wert[gleich + 1..]).into_iter().next() {
                aus.push((name.to_string(), wert));
            }
        }
        aus
    }

    /// Stringliterale (normal und roh) einer Rust-Quelle mit Zeilennummer, Kommentare
    /// übersprungen. Fortsetzungszeilen (`\` am Zeilenende) und Leerraum sind zusammengezogen.
    fn literals(quelle: &str) -> Vec<(usize, String)> {
        let b = quelle.as_bytes();
        let mut aus = Vec::new();
        let mut i = 0;
        let mut zeile = 1;
        let zaehle = |von: usize, bis: usize| b[von..bis].iter().filter(|&&c| c == b'\n').count();
        while i < b.len() {
            match b[i] {
                b'\n' => {
                    zeile += 1;
                    i += 1;
                }
                b'/' if b.get(i + 1) == Some(&b'/') => {
                    while i < b.len() && b[i] != b'\n' {
                        i += 1;
                    }
                }
                b'/' if b.get(i + 1) == Some(&b'*') => {
                    let ende = quelle[i + 2..]
                        .find("*/")
                        .map_or(b.len(), |e| i + 2 + e + 2);
                    zeile += zaehle(i, ende);
                    i = ende;
                }
                b'\'' => {
                    // Zeichenliteral ('x', '\n', '"') oder Lebensdauer ('a).
                    if b.get(i + 1) == Some(&b'\\') {
                        i += 2;
                        while i < b.len() && b[i] != b'\'' {
                            i += 1;
                        }
                        i += 1;
                    } else if b.get(i + 2) == Some(&b'\'') {
                        i += 3;
                    } else {
                        i += 1;
                    }
                }
                b'r' if (b.get(i + 1) == Some(&b'"') || b.get(i + 1) == Some(&b'#'))
                    && (i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_')) =>
                {
                    let mut j = i + 1;
                    while b.get(j) == Some(&b'#') {
                        j += 1;
                    }
                    if b.get(j) != Some(&b'"') {
                        i += 1;
                        continue;
                    }
                    let schluss = format!("\"{}", "#".repeat(j - i - 1));
                    let start = j + 1;
                    let ende = quelle[start..]
                        .find(&schluss)
                        .map_or(b.len(), |e| start + e);
                    aus.push((zeile, normalize(&quelle[start..ende])));
                    zeile += zaehle(i, ende);
                    i = (ende + schluss.len()).min(b.len());
                }
                b'"' => {
                    let start = i + 1;
                    let mut j = start;
                    while j < b.len() && b[j] != b'"' {
                        j += if b[j] == b'\\' { 2 } else { 1 };
                    }
                    let ende = j.min(b.len());
                    aus.push((zeile, normalize(&quelle[start..ende])));
                    zeile += zaehle(i, ende);
                    i = ende + 1;
                }
                _ => i += 1,
            }
        }
        aus
    }

    fn normalize(s: &str) -> String {
        s.replace("\\\n", " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn collect_rs(dir: &std::path::Path, funde: &mut Vec<(String, String)>) {
        for eintrag in std::fs::read_dir(dir).unwrap() {
            let pfad = eintrag.unwrap().path();
            if pfad.is_dir() {
                collect_rs(&pfad, funde);
            } else if pfad.extension().is_some_and(|e| e == "rs")
                && pfad
                    .file_name()
                    .is_some_and(|n| !n.to_string_lossy().ends_with("tests.rs"))
            {
                let text = std::fs::read_to_string(&pfad).unwrap();
                let rel = pfad
                    .strip_prefix(env!("CARGO_MANIFEST_DIR"))
                    .unwrap_or(&pfad)
                    .to_string_lossy()
                    .replace('\\', "/");
                funde.push((rel.trim_start_matches('/').to_string(), text));
            }
        }
    }
}
