//! Verteiler an Befehl und Lagebericht (LLH-1172, Spec `dokument-verteiler`, Herleitung
//! `openspec/changes/kz5udbog-verteiler-vorlagendokument/design.md`).
//!
//! Der Verteiler nennt, an wen ein Dokument geht: eine geordnete Liste aus Einsatzabschnitten,
//! Einheiten, Führungsfunktionen und externen Stellen, eine Zeile je Empfänger in einer Tabelle je
//! Dokumentart ([`VerteilerTabelle`], Migration `0183_dokument_verteiler.sql`). Prüfung und
//! Anzeigename kommen von den Auftragsempfängern (`auftrag::eingabe::validate_verteiler`,
//! `auftrag::repo::snap_anzeige_fuer`). Der Anzeigename entsteht beim Speichern und bleibt; die
//! Freigabe schreibt ihn ins ETB ([`build_an`], [`render_abschnitt`]), das Fortschreiben kopiert die
//! Zeilen in die neue Fassung ([`copy_tx`]). Je Fassung eigene Zeilen: eine spätere Quittung
//! je Empfänger (LLH-1173) hängt so an genau einer Fassung.

use super::Dokumentart;
use crate::auftrag::repo::{snap_anzeige_fuer, EmpfaengerEingabe};
use crate::auftrag::EmpfaengerTyp;
use crate::error::AppError;
use crate::kommunikation::AdressatKategorie;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;
use utoipa::ToSchema;

/// Höchstzahl der Einträge eines Verteilers im Request, gezählt vor dem Zusammenführen. Dieselbe
/// Grenze wie bei den Auftragsempfängern, unter eigenem Namen für den Spiegel im Frontend.
pub const VERTEILER_MAX: usize = crate::auftrag::EMPFAENGER_MAX;
/// Höchstlänge der Bezeichnung einer externen Stelle im Verteiler.
pub const VERTEILER_BEZEICHNUNG_MAX: usize = crate::auftrag::EXTERN_BEZEICHNUNG_MAX;

/// Verteiler-Tabelle einer Dokumentart. Spalten: `id, einsatz_id, <dokument_spalte>,
/// reihenfolge, empfaenger_typ, abschnitt_id, einheit_id, funktion, funktion_text,
/// extern_kategorie, extern_bezeichnung, snap_anzeige`.
#[derive(Debug, PartialEq, Eq)]
pub struct VerteilerTabelle {
    /// Tabellenname, z. B. `befehl_verteiler`.
    pub tabelle: &'static str,
    /// Spalte, die auf das Dokument zeigt, z. B. `befehl_id`.
    pub dokument_spalte: &'static str,
}

/// Ein Eintrag des Verteilers auf dem Wire, in Verteiler-Reihenfolge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VerteilerEintragAnzeige {
    pub id: i64,
    /// `abschnitt`, `einheit`, `funktion` oder `extern`; Person und Fahrzeug kommen nicht vor.
    pub empfaenger_typ: EmpfaengerTyp,
    /// Fehlt auch, wenn der Abschnitt inzwischen gelöscht ist; `snap_anzeige` bleibt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    /// Katalogcode; fehlt bei Freitext und anderen Empfängertypen.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::fuehrung::Fuehrungsfunktion>)]
    pub funktion: Option<String>,
    /// Freitext, oder die Bezeichnung bei Führungshilfspersonal und Fachberater.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funktion_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extern_kategorie: Option<AdressatKategorie>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extern_bezeichnung: Option<String>,
    /// Anzeigename zum Zeitpunkt des Speicherns, nie mit dem Namen einer besetzenden Person.
    pub snap_anzeige: String,
}

/// Ein Eintrag, wie ihn [`json_column`] aus SQLite liefert; die Enums prüft [`from_json`].
#[derive(Deserialize)]
struct Raw {
    id: i64,
    empfaenger_typ: String,
    abschnitt_id: Option<i64>,
    einheit_id: Option<i64>,
    funktion: Option<String>,
    funktion_text: Option<String>,
    extern_kategorie: Option<String>,
    extern_bezeichnung: Option<String>,
    snap_anzeige: String,
}

/// Unterabfrage, die den Verteiler des Dokuments `<alias>.id` als JSON-Array liefert, für die
/// Spaltenliste von `repo::select`. So bleibt das Laden eines Dokuments EINE Abfrage auf jedem
/// Executor, auch innerhalb einer Transaktion. Ohne Haken ein leeres Array.
pub(super) fn json_column<T: Dokumentart>(alias: &str) -> String {
    let Some(t) = T::VERTEILER else {
        return "'[]'".into();
    };
    format!(
        "(SELECT json_group_array(json_object(\
            'id', v.id, 'empfaenger_typ', v.empfaenger_typ, 'abschnitt_id', v.abschnitt_id, \
            'einheit_id', v.einheit_id, 'funktion', v.funktion, 'funktion_text', v.funktion_text, \
            'extern_kategorie', v.extern_kategorie, 'extern_bezeichnung', v.extern_bezeichnung, \
            'snap_anzeige', v.snap_anzeige) ORDER BY v.reihenfolge) \
         FROM {tab} v WHERE v.{d} = {alias}.id)",
        tab = t.tabelle,
        d = t.dokument_spalte,
    )
}

/// Liest die Spalte aus [`json_column`]. Ein unbekannter Typ oder eine unbekannte Kategorie
/// ist ein Datenfehler (500), kein Eingabefehler: der CHECK der Tabelle lässt beides nicht zu.
pub(super) fn from_json(json: &str) -> Result<Vec<VerteilerEintragAnzeige>, AppError> {
    let roh: Vec<Raw> = serde_json::from_str(json)
        .map_err(|e| AppError::Internal(format!("Verteiler-JSON defekt: {e}")))?;
    roh.into_iter()
        .map(|r| {
            let empfaenger_typ = EmpfaengerTyp::parse(&r.empfaenger_typ).ok_or_else(|| {
                AppError::Internal(format!("Unbekannter Verteiler-Typ «{}»", r.empfaenger_typ))
            })?;
            let extern_kategorie = match r.extern_kategorie.as_deref() {
                Some(k) => Some(AdressatKategorie::parse(k).ok_or_else(|| {
                    AppError::Internal(format!("Unbekannte externe Kategorie «{k}»"))
                })?),
                None => None,
            };
            Ok(VerteilerEintragAnzeige {
                id: r.id,
                empfaenger_typ,
                abschnitt_id: r.abschnitt_id,
                einheit_id: r.einheit_id,
                funktion: r.funktion,
                funktion_text: r.funktion_text,
                extern_kategorie,
                extern_bezeichnung: r.extern_bezeichnung,
                snap_anzeige: r.snap_anzeige,
            })
        })
        .collect()
}

/// Ersetzt den Verteiler eines Dokuments ganz: löschen, dann je Eintrag in Reihenfolge mit
/// Anzeigenamen einfügen. Läuft in der Transaktion des PATCH, der vorher im selben Zug den
/// Entwurfs-Status per UPDATE gesichert hat. Eine Art ohne Haken → 400.
pub async fn replace_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    dokument_id: i64,
    eintraege: &[EmpfaengerEingabe],
) -> Result<(), AppError> {
    let t = table::<T>()?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM {tab} WHERE einsatz_id = ? AND {d} = ?",
        tab = t.tabelle,
        d = t.dokument_spalte,
    )))
    .bind(einsatz_id)
    .bind(dokument_id)
    .execute(&mut *conn)
    .await?;
    if eintraege.is_empty() {
        return Ok(());
    }
    let karte = crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut *conn, einsatz_id).await?;
    for (reihenfolge, e) in eintraege.iter().enumerate() {
        let snap = snap_anzeige_fuer(&mut *conn, e, &karte).await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {tab} (einsatz_id, {d}, reihenfolge, empfaenger_typ, abschnitt_id, \
                einheit_id, funktion, funktion_text, extern_kategorie, extern_bezeichnung, \
                snap_anzeige) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            tab = t.tabelle,
            d = t.dokument_spalte,
        )))
        .bind(einsatz_id)
        .bind(dokument_id)
        .bind(reihenfolge as i64)
        .bind(&e.empfaenger_typ)
        .bind(e.abschnitt_id)
        .bind(e.einheit_id)
        .bind(e.funktion.map(|f| f.as_str()))
        .bind(e.funktion_text.as_deref())
        .bind(e.extern_kategorie.as_deref())
        .bind(e.extern_bezeichnung.as_deref())
        .bind(&snap)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Kopiert den Verteiler einer Fassung in die neue Fassung (Fortschreiben), samt Reihenfolge,
/// Zielen und Anzeigenamen. Eine Art ohne Haken kopiert nichts.
pub async fn copy_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    von_id: i64,
    nach_id: i64,
) -> Result<(), AppError> {
    let Some(t) = T::VERTEILER else {
        return Ok(());
    };
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {tab} (einsatz_id, {d}, reihenfolge, empfaenger_typ, abschnitt_id, \
            einheit_id, funktion, funktion_text, extern_kategorie, extern_bezeichnung, snap_anzeige) \
         SELECT einsatz_id, ?, reihenfolge, empfaenger_typ, abschnitt_id, einheit_id, funktion, \
            funktion_text, extern_kategorie, extern_bezeichnung, snap_anzeige \
         FROM {tab} WHERE einsatz_id = ? AND {d} = ? ORDER BY reihenfolge",
        tab = t.tabelle,
        d = t.dokument_spalte,
    )))
    .bind(nach_id)
    .bind(einsatz_id)
    .bind(von_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Abschnitt „Verteiler“ für den ETB-Snapshot der Freigabe, nach den Anlagen. Ohne Verteiler
/// leer: der Wortlaut bleibt dann byte-gleich wie vor LLH-1172.
pub fn render_abschnitt(verteiler: &[VerteilerEintragAnzeige]) -> String {
    if verteiler.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n## Verteiler\n");
    for e in verteiler {
        out.push_str(&format!("- {}\n", e.snap_anzeige));
    }
    out
}

/// `an` des ETB-Eintrags der Freigabe: die Anzeigenamen kommagetrennt, gekappt wie bei der
/// Anordnung eines Auftrags. Ohne Verteiler `None`, das ETB setzt dann „System“.
pub fn build_an(verteiler: &[VerteilerEintragAnzeige]) -> Option<String> {
    if verteiler.is_empty() {
        return None;
    }
    let namen: Vec<String> = verteiler.iter().map(|e| e.snap_anzeige.clone()).collect();
    Some(crate::auftrag::kappe_an(&namen))
}

/// Die Verteiler-Tabelle der Art; eine Art ohne Verteiler (Pressemitteilung) → 400.
pub fn table<T: Dokumentart>() -> Result<&'static VerteilerTabelle, AppError> {
    T::VERTEILER.ok_or_else(|| {
        AppError::Validation(format!("{} trägt keinen Verteiler", T::NOMEN_MIT_ARTIKEL))
    })
}

#[cfg(test)]
#[path = "verteiler_tests.rs"]
mod tests;
