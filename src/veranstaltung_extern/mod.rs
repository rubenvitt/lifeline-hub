//! Veranstaltungen aus einer Fremdanwendung (LLH-2097, Design-Doc
//! `docs/superpowers/specs/2026-11-25-w36lkuqp-veranstaltungen-abruf-design.md`): geplante Dienste
//! (Sanitätsdienst, Betreuung, Übung), die ein Adapter über den neutralen Vertrag
//! „Veranstaltungen-Abruf v1“ abruft ([`vertrag`], [`art`]) und je Adapter ablegt ([`repo`]).
//! Benannt nach dem Fachbegriff, nicht nach einer liefernden Anwendung: jede, die den Vertrag
//! anbietet, ist anbindbar.

pub mod art;
pub mod repo;
pub mod vertrag;

#[cfg(test)]
mod tests {
    /// Kein Name einer liefernden Anwendung im Code (Leitplanke G4 des Konzepts
    /// `docs/konzepte/2026-11-10-schnittstellen-ausbau.md`).
    #[test]
    fn code_nennt_keine_liefernde_anwendung() {
        let verboten = [["iu", "k"].concat(), ["sui", "te"].concat()];
        for (datei, quelle) in [
            ("mod.rs", include_str!("mod.rs")),
            ("art.rs", include_str!("art.rs")),
            ("repo.rs", include_str!("repo.rs")),
            ("vertrag.rs", include_str!("vertrag.rs")),
        ] {
            let klein = quelle.to_lowercase();
            for wort in &verboten {
                assert!(!klein.contains(wort.as_str()), "{datei} nennt „{wort}“");
            }
        }
    }
}
