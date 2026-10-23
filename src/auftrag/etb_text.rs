//! Wortlaut der ETB-Anordnungen beim Aufheben und Berichtigen eines Auftrags (LLH-1098, Spec
//! `auftrag-aufheben-berichtigen`, design.md D5). Rein, damit der Wortlaut ohne Datenbank
//! prüfbar ist. Die Felder des Befehlsschemas erscheinen nur mit Namen: nach dem
//! Schwärzungs-Register gelangen sie nie ins ETB (`einsatz/schwaerzung_registry.rs`).

/// „Auftrag #4“, ohne Nummer (Altbestand vor LFH-133) nur „Auftrag“.
fn kopf(lfd_nr: Option<i64>) -> String {
    match lfd_nr {
        Some(nr) => format!("Auftrag #{nr}"),
        None => "Auftrag".to_string(),
    }
}

/// „Auftrag #4 aufgehoben: <Grund>“.
pub fn aufgehoben(lfd_nr: Option<i64>, grund: &str) -> String {
    format!("{} aufgehoben: {grund}", kopf(lfd_nr))
}

/// Eine geänderte Angabe einer Berichtigung, in der Reihenfolge, in der der Text sie nennt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Aenderung {
    /// Neuer Auftragstext, wörtlich: der Eintrag schreibt die Anordnung fort.
    Text(String),
    /// Empfänger nachher und vorher, je kommagetrennt.
    Empfaenger { neu: String, vorher: String },
    /// Priorität nachher und vorher (Drahtwert, wie ihn die Anordnung sonst nennt).
    Prioritaet { neu: String, vorher: String },
    /// Frist nachher und vorher, schon in Zone und Darstellung des Einsatzes formatiert; `None` = keine.
    Frist {
        neu: Option<String>,
        vorher: Option<String>,
    },
    /// Ein Feld des Befehlsschemas, nur mit Namen.
    Schemafeld(&'static str),
}

fn oder_keine(w: &Option<String>) -> &str {
    w.as_deref().unwrap_or("keine")
}

/// „Auftrag #4 geändert: Priorität sofort (vorher normal), Frist 121600okt26 (vorher
/// 121500okt26).“ Leere Liste gibt es nicht: ohne Änderung entsteht kein Eintrag.
pub fn geaendert(lfd_nr: Option<i64>, aenderungen: &[Aenderung]) -> String {
    let teile: Vec<String> = aenderungen
        .iter()
        .map(|a| match a {
            Aenderung::Text(neu) => format!("Auftragstext „{neu}“"),
            Aenderung::Empfaenger { neu, vorher } => format!("Empfänger {neu} (vorher {vorher})"),
            Aenderung::Prioritaet { neu, vorher } => format!("Priorität {neu} (vorher {vorher})"),
            Aenderung::Frist { neu, vorher } => {
                format!("Frist {} (vorher {})", oder_keine(neu), oder_keine(vorher))
            }
            Aenderung::Schemafeld(name) => (*name).to_string(),
        })
        .collect();
    format!("{} geändert: {}.", kopf(lfd_nr), teile.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aufgehoben_nennt_nummer_und_grund() {
        assert_eq!(
            aufgehoben(Some(4), "Material kommt vom Bauhof"),
            "Auftrag #4 aufgehoben: Material kommt vom Bauhof"
        );
        assert_eq!(aufgehoben(None, "x"), "Auftrag aufgehoben: x");
    }

    #[test]
    fn geaendert_nennt_neu_und_vorher_in_fester_folge() {
        let text = geaendert(
            Some(4),
            &[
                Aenderung::Prioritaet {
                    neu: "sofort".into(),
                    vorher: "normal".into(),
                },
                Aenderung::Frist {
                    neu: Some("121600okt26".into()),
                    vorher: Some("121500okt26".into()),
                },
            ],
        );
        assert_eq!(
            text,
            "Auftrag #4 geändert: Priorität sofort (vorher normal), Frist 121600okt26 (vorher 121500okt26)."
        );
    }

    #[test]
    fn geaendert_schemafeld_nur_mit_namen_und_frist_ohne_wert() {
        assert_eq!(
            geaendert(Some(4), &[Aenderung::Schemafeld("Mittel")]),
            "Auftrag #4 geändert: Mittel."
        );
        assert_eq!(
            geaendert(
                None,
                &[Aenderung::Frist {
                    neu: None,
                    vorher: Some("121500okt26".into())
                }]
            ),
            "Auftrag geändert: Frist keine (vorher 121500okt26)."
        );
    }

    #[test]
    fn geaendert_text_und_empfaenger() {
        assert_eq!(
            geaendert(
                Some(2),
                &[
                    Aenderung::Text("Deich Nord sichern".into()),
                    Aenderung::Empfaenger {
                        neu: "Versorgungszug".into(),
                        vorher: "Logistiktrupp".into()
                    }
                ]
            ),
            "Auftrag #2 geändert: Auftragstext „Deich Nord sichern“, Empfänger Versorgungszug (vorher Logistiktrupp)."
        );
    }
}
