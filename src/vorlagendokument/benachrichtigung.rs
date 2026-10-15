//! Benachrichtigung bei der Freigabe von Befehl und Lagebericht (LLH-1213, Change
//! `kcjecn9e-benachrichtigungskonzept`, Spec `benachrichtigungen`, „Befehl oder Lagebericht im
//! Verteiler“).
//!
//! Die Freigabe-Route ruft [`freigegeben`] nach dem Commit, nur wenn die Freigabe gelungen ist:
//! eine zweite Freigabe derselben Fassung scheitert vorher (422), meldet also nicht doppelt. Eine
//! Fortschreibung ist eine neue Fassung mit eigener id und meldet erst mit ihrer eigenen Freigabe.
//! Hier steht nur, wer als Adressat gemeint ist; wer etwas bekommt (Modulrecht am Bezug, ohne
//! Freigebenden, …), entscheidet [`crate::benachrichtigung::melden`] (`src/AGENTS.md`,
//! Benachrichtigungen).

use super::verteiler::VerteilerEintragAnzeige;
use crate::auftrag::EmpfaengerTyp;
use crate::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::fuehrung::Fuehrungsfunktion;
use crate::live::LiveHub;
use sqlx::SqlitePool;

/// Art und Bezugstyp der Benachrichtigung einer Dokumentart
/// ([`super::Dokumentart::BENACHRICHTIGUNG`]). Der Bezugstyp bestimmt das Modul, das ein
/// Empfänger sehen muss (`BenachrichtigungBezugTyp::modul`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FreigabeHinweis {
    pub art: BenachrichtigungArt,
    pub bezug_typ: BenachrichtigungBezugTyp,
}

/// Die Adressaten eines Verteilers: jede Katalogfunktion. Einheit, Abschnitt, extern und eine
/// Funktion als Freitext haben keinen Nutzer und benachrichtigen niemanden.
pub fn adressaten(verteiler: &[VerteilerEintragAnzeige]) -> Vec<Adressat> {
    verteiler
        .iter()
        .filter(|e| e.empfaenger_typ == EmpfaengerTyp::Funktion)
        .filter_map(|e| e.funktion.as_deref().and_then(Fuehrungsfunktion::parse))
        .map(Adressat::Funktion)
        .collect()
}

/// Ein Dokument wurde freigegeben: die Funktionen seines Verteilers bekommen den Hinweis, der
/// Freigebende nicht. Ohne Funktion im Verteiler nichts.
pub async fn freigegeben(
    pool: &SqlitePool,
    live: &LiveHub,
    hinweis: FreigabeHinweis,
    einsatz_id: i64,
    dokument_id: i64,
    freigeber_id: i64,
    verteiler: &[VerteilerEintragAnzeige],
) {
    let adressaten = adressaten(verteiler);
    if adressaten.is_empty() {
        return;
    }
    let anlass = adressaten.into_iter().fold(
        Anlass::neu(
            einsatz_id,
            hinweis.art,
            Bezug::neu(hinweis.bezug_typ, dokument_id),
        )
        .von(freigeber_id),
        Anlass::an,
    );
    melden(pool, live, anlass).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::befehl::Befehl;
    use crate::lagebericht::Lagebericht;
    use crate::presse::mitteilung::Pressemitteilung;
    use crate::vorlagendokument::Dokumentart;

    fn eintrag(
        typ: EmpfaengerTyp,
        funktion: Option<&str>,
        text: Option<&str>,
    ) -> VerteilerEintragAnzeige {
        VerteilerEintragAnzeige {
            id: 1,
            empfaenger_typ: typ,
            abschnitt_id: None,
            einheit_id: None,
            funktion: funktion.map(str::to_string),
            funktion_text: text.map(str::to_string),
            extern_kategorie: None,
            extern_bezeichnung: None,
            snap_anzeige: "x".into(),
            quittiert_at: None,
            quittiert_von_id: None,
        }
    }

    #[test]
    fn nur_katalogfunktionen_werden_adressiert() {
        let verteiler = [
            eintrag(EmpfaengerTyp::Funktion, Some("s3"), None),
            eintrag(EmpfaengerTyp::Einheit, None, None),
            eintrag(EmpfaengerTyp::Abschnitt, None, None),
            eintrag(EmpfaengerTyp::Extern, None, None),
            eintrag(EmpfaengerTyp::Funktion, None, Some("S4")),
            eintrag(EmpfaengerTyp::Funktion, Some("el"), None),
        ];
        assert_eq!(
            adressaten(&verteiler),
            vec![
                Adressat::Funktion(Fuehrungsfunktion::S3),
                Adressat::Funktion(Fuehrungsfunktion::El),
            ]
        );
    }

    /// Befehle gehören zum Modul Aufträge, Lageberichte zu Lageberichte (die `MODUL_KEY` ihrer
    /// Routen); die Pressemitteilung hat keinen Verteiler und benachrichtigt nicht.
    #[test]
    fn bezug_jeder_art_zeigt_auf_ihr_modul() {
        let befehl = Befehl::BENACHRICHTIGUNG.expect("Befehl meldet");
        assert_eq!(befehl.art, BenachrichtigungArt::Befehl);
        assert_eq!(befehl.bezug_typ.modul(), Some("auftraege"));
        let bericht = Lagebericht::BENACHRICHTIGUNG.expect("Lagebericht meldet");
        assert_eq!(bericht.art, BenachrichtigungArt::Lagebericht);
        assert_eq!(bericht.bezug_typ.modul(), Some("lageberichte"));
        assert_eq!(Pressemitteilung::BENACHRICHTIGUNG, None);
        assert!(Befehl::VERTEILER.is_some() && Lagebericht::VERTEILER.is_some());
    }
}
