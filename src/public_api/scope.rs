//! Scopes und Ablehnungsgründe eines Maschinenzugangs (Spec `maschinenzugang`, design.md D6).

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

wire_enum! {
    /// Was ein Maschinenzugang darf (Konzept D2). Wire-Werte nach LFH-1312: Fachbegriff deutsch,
    /// Zugriffsart englisch. Neue Werte kommen nur hinzu (Stabilitätszusage v1).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ToSchema)]
    pub enum Scope {
        LageRead => "lage:read",
        EinsaetzeRead => "einsaetze:read",
        EventsRead => "events:read",
        AlarmmeldungenWrite => "alarmmeldungen:write",
        PositionenWrite => "positionen:write",
        RechnerUse => "rechner:use",
    }
}

impl Scope {
    /// Lese-Scope mit Einsatzbezug: Er sieht nur den Einsatz, den die Einsatzleitung für den
    /// Zugang freigegeben hat (`super::freigabe`, ADR-0035). Ein neuer solcher Scope kommt hier
    /// dazu, sobald seine Route steht; vorher zeigte das Paneel „Anbindungen“ einen Schalter
    /// ohne Wirkung.
    pub fn has_einsatzbezug(self) -> bool {
        matches!(self, Scope::LageRead)
    }
}

wire_enum! {
    /// Zustand eines Maschinenzugangs. „Abgelaufen“ ist kein Zustand, sondern ergibt sich aus
    /// `gueltig_bis` (design.md D2).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum ZugangZustand {
        /// Angelegt, noch kein Schlüssel gebunden.
        Wartet => "wartet",
        Aktiv => "aktiv",
        Widerrufen => "widerrufen",
    }
}

wire_enum! {
    /// Warum die letzte Anfrage eines bekannten Zugangs scheiterte. Steht nur am Zugang (Seite
    /// „Anbindungen“); das Fremdsystem bekommt nur 401.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum AblehnungGrund {
        /// Uhr des Fremdsystems weicht ab, oder das Token lebt länger als erlaubt.
        Uhr => "uhr",
        Signatur => "signatur",
        /// Body passt nicht zu `bh`.
        Body => "body",
        /// `htu` passt nicht zum Pfad.
        Pfad => "pfad",
        Methode => "methode",
        /// `iss` oder `aud` passen nicht (Anfrage für eine andere Instanz).
        Ziel => "ziel",
        /// Token unlesbar, anderer Algorithmus oder Typ.
        Form => "form",
        /// Dieselbe `jti` ein zweites Mal.
        Wiederholung => "wiederholung",
        Abgelaufen => "abgelaufen",
        Widerrufen => "widerrufen",
        /// Noch kein Schlüssel gebunden (Code nicht eingelöst).
        KeinSchluessel => "kein_schluessel",
        /// Die Instanz meldet sich für die Org bei einem Hub (design.md D10).
        InstanzGekoppelt => "instanz_gekoppelt",
    }
}

impl AblehnungGrund {
    /// Bildet einen Fehler der Signaturprüfung auf den Grund am Zugang ab.
    pub fn aus_signatur(fehler: &crate::instanz::signatur::SignaturError) -> Self {
        use crate::instanz::signatur::SignaturError as E;
        match fehler {
            E::Form | E::Algorithmus | E::Bezug | E::Status => AblehnungGrund::Form,
            E::Signatur => AblehnungGrund::Signatur,
            E::Ziel => AblehnungGrund::Ziel,
            E::Methode => AblehnungGrund::Methode,
            E::Pfad => AblehnungGrund::Pfad,
            E::Body => AblehnungGrund::Body,
            E::Zeit => AblehnungGrund::Uhr,
        }
    }
}

/// Liest Scopes aus Wire-Werten: sortiert, ohne Dopplung. Ein unbekannter Wert ist ein Fehler mit
/// diesem Wert.
pub fn parse_scopes<'a>(roh: impl IntoIterator<Item = &'a str>) -> Result<Vec<Scope>, String> {
    let mut scopes = roh
        .into_iter()
        .map(|s| Scope::parse(s).ok_or_else(|| s.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    scopes.sort();
    scopes.dedup();
    Ok(scopes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_werden_sortiert_und_entdoppelt() {
        assert_eq!(
            parse_scopes(["rechner:use", "lage:read", "lage:read"]),
            Ok(vec![Scope::LageRead, Scope::RechnerUse])
        );
    }

    #[test]
    fn unbekannter_scope_ist_ein_fehler() {
        assert_eq!(Scope::parse("alles:write"), None);
        assert_eq!(
            parse_scopes(["lage:read", "alles:write"]),
            Err("alles:write".to_string())
        );
    }

    #[test]
    fn nur_lage_lesen_hat_einsatzbezug() {
        let mit: Vec<&str> = Scope::ALLE
            .iter()
            .filter(|s| s.has_einsatzbezug())
            .map(|s| s.as_str())
            .collect();
        assert_eq!(mit, ["lage:read"]);
    }

    #[test]
    fn zeitfehler_ist_die_uhr() {
        assert_eq!(
            AblehnungGrund::aus_signatur(&crate::instanz::signatur::SignaturError::Zeit),
            AblehnungGrund::Uhr
        );
    }
}
