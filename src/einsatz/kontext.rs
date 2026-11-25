//! Zentraler Einsatz-Zugriffs-Extractor (LFH-121).
//!
//! Bündelt das in ~200 Handlern von Hand wiederholte Gate-Vorspiel
//! (Einsatz laden → Rolle bestimmen → Org-Zugehörigkeit prüfen) in einen
//! wiederverwendbaren Axum-Extractor. Ein Handler zieht `EinsatzKontext` deklarativ
//! in die Signatur und ruft danach nur noch das fachlich passende Gate
//! (`fordere_lesezugriff`/`fordere_schreibrecht`/…) auf `self`.
//!
//! Der **Org-Isolations-Floor** ([`berechtigung::fordere_org_zugehoerigkeit`]) läuft
//! dabei IMMER im Extractor — damit die Cross-Org-Lücke (LFH-115) für neue Sub-Routen
//! strukturell nicht mehr „vergessen" werden kann (der Guard-Test
//! `tests/einsatz_kontext_guard.rs` erzwingt, dass jede `/api/incidents/{id}/…`-Route
//! den Extractor zieht).
//!
//! Bewusst zieht der Extractor NICHT die volle Lese-Policy (`fordere_lesezugriff`):
//! deren DSGVO-Hard-Blocks (Aufbewahrungsfrist/Tombstone) sperren auch höhere
//! Berechtigungen und würden `aufbewahrungsfrist_setzen` (Admin/Einsatzleitung
//! verlängert reaktiv die Frist eines abgelaufenen Einsatzes) aussperren. Das
//! Read-/Write-/Aktiv-/Modul-Gate bleibt darum explizit im Handler — jetzt aber
//! deklarativ über die Helfer-Methoden, ohne wiederholtes Laden/Rolle-Bestimmen.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::auth::Benutzer;
use crate::einsatz::modul::{ModulMarker, OhneModul};
use crate::einsatz::{berechtigung, repo as einsatz_repo, Einsatz, EinsatzRolle};
use crate::error::AppError;
use crate::geraet::GeraetKontext;
use axum::extract::{FromRequestParts, Path};
use axum::http::request::Parts;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::ops::Deref;

/// Der zugriffs-geprüfte Kontext eines einsatz-gebundenen Handlers: der geladene
/// Einsatz, die Rolle des aufrufenden Benutzers darin (`None` = kein Mitglied) und
/// der Benutzer selbst. Bei erfolgreicher Extraktion ist der **Org-Floor** bereits
/// bestanden (Mitglied ODER fremdeinsatz-leseberechtigt).
pub struct EinsatzKontext {
    pub einsatz: Einsatz,
    pub rolle: Option<EinsatzRolle>,
    pub benutzer: Benutzer,
    /// Gerätesitzung (LFH-892): Kopplung, Ansicht und Stelle. `None` bei einer Person. Die
    /// Routenschranke hat `CurrentUser` schon geprüft; Handler mit Stellenbindung lesen hier die
    /// UHS der Kopplung.
    pub geraet: Option<GeraetKontext>,
}

impl FromRequestParts<AppState> for EinsatzKontext {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser(benutzer) = CurrentUser::from_request_parts(parts, state).await?;

        // Alle einsatz-gebundenen Routen tragen den Einsatz als `{id}` (einheitlich
        // über alle 162 Routen, per app.rs verifiziert). Keyed-Extraktion statt
        // positionell, damit verschachtelte Pfade (`{id}/…/{child_id}`) egal sind.
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::NotFound)?;
        let einsatz_id: i64 = params
            .get("id")
            .and_then(|s| s.parse().ok())
            .ok_or(AppError::NotFound)?;

        // Den Einsatz eines Geräts hat `CurrentUser` schon gegen die Kopplung geprüft (sonst 404).
        let geraet = parts.extensions.get::<GeraetKontext>().cloned();
        Self::load(&state.pool, einsatz_id, benutzer, geraet).await
    }
}

impl EinsatzKontext {
    /// Baut den Kontext wie der Extractor, ohne Anfrage: Einsatz laden, Rolle bestimmen,
    /// Org-Floor. Für Wege, die für einen bestimmten Benutzer prüfen, was eine Route ihm
    /// antworten würde (iOS-Push, LLH-2040: Absender und Wortlaut nur mit Leserecht).
    pub async fn load(
        pool: &SqlitePool,
        einsatz_id: i64,
        benutzer: Benutzer,
        geraet: Option<GeraetKontext>,
    ) -> Result<Self, AppError> {
        let einsatz = einsatz_repo::laden(pool, einsatz_id).await?;
        // Ein Gerät ist nie Mitglied: seine Rolle kommt aus der Ansicht (design.md D5).
        let rolle = match &geraet {
            Some(g) => Some(g.ansicht.rolle()),
            None => einsatz_repo::rolle_von(pool, einsatz_id, benutzer.id).await?,
        };
        berechtigung::fordere_org_zugehoerigkeit(&benutzer, einsatz.org_id, rolle)?;
        Ok(EinsatzKontext {
            einsatz,
            rolle,
            benutzer,
            geraet,
        })
    }

    /// Lese-Gate inkl. DSGVO-Zeit-Policy (Nachlauffrist/Aufbewahrungsfrist/Tombstone).
    pub fn fordere_lesezugriff(&self) -> Result<(), AppError> {
        berechtigung::fordere_lesezugriff(&self.benutzer, &self.einsatz, self.rolle)
    }

    /// Schreib-Gate: Einsatzleitung oder Führungspersonal.
    pub fn fordere_schreibrecht(&self) -> Result<(), AppError> {
        berechtigung::fordere_schreibrecht(self.rolle)
    }

    /// Erfassungs-Gate: Einsatzleitung, Führungspersonal oder Mitarbeit (LLH-1817).
    pub fn fordere_erfassungsrecht(&self) -> Result<(), AppError> {
        berechtigung::fordere_erfassungsrecht(self.rolle)
    }

    /// Schreib-Gate ODER System-Admin der Einsatz-Org (Kopfdaten, Einstellungen, Führungsstelle).
    pub fn fordere_schreibrecht_oder_admin(&self) -> Result<(), AppError> {
        berechtigung::fordere_schreibrecht_oder_admin(
            &self.benutzer,
            self.einsatz.org_id,
            self.rolle,
        )
    }

    /// Nur-Einsatzleitung-Gate.
    pub fn fordere_einsatzleitung(&self) -> Result<(), AppError> {
        berechtigung::fordere_einsatzleitung(self.rolle)
    }

    /// Schreib-Freeze: der Einsatz muss noch aktiv (beschreibbar) sein.
    pub fn fordere_aktiv(&self) -> Result<(), AppError> {
        berechtigung::fordere_aktiv(&self.einsatz)
    }

    /// Die Einsatzrolle, mit der die Modulfreigabe rechnet (LFH-1150, design.md D4): bei einem
    /// gekoppelten Gerät keine, denn seine Ansichtsrolle ist ein Schreibrecht an einer Stelle und
    /// keine Person in Führung; sonst die Rolle der Mitgliedschaft.
    pub fn modul_rolle(&self) -> Option<EinsatzRolle> {
        if self.geraet.is_some() {
            None
        } else {
            self.rolle
        }
    }

    /// Modul-Sichtbarkeit/-Rolle (LFH-132) für `modul_key` prüfen (lädt Override-Maps).
    pub async fn fordere_modul_zugriff(
        &self,
        pool: &SqlitePool,
        modul_key: &str,
    ) -> Result<(), AppError> {
        berechtigung::fordere_modul_zugriff_laden(
            pool,
            self.einsatz.id,
            self.einsatz.org_id,
            modul_key,
            &self.benutzer,
            self.modul_rolle(),
        )
        .await
    }

    /// Modulfreigabe des Moduls, in das ein Weg aus einem anderen Modul heraus schreibt
    /// (Spec `modul-freigabe`; LFH-904 Chat, LFH-1051 ETB und Meldungen). Der Extractor prüft
    /// nur das Quellmodul; das Zielmodul kommt als Marker, damit kein Key als Literal driftet.
    pub async fn fordere_zielmodul<Z: ModulMarker>(
        &self,
        pool: &SqlitePool,
    ) -> Result<(), AppError> {
        let key = Z::KEY.expect("Zielmodul ist an ein Modul gebunden");
        self.fordere_modul_zugriff(pool, key).await
    }

    /// Wie [`Self::fordere_zielmodul`], als Antwort statt Fehler: für die Rücknahme eines
    /// Entlassens, die einen Teil ohne Recht auslässt statt abzulehnen (LLH-1722, LLH-1922).
    pub async fn darf_zielmodul<Z: ModulMarker>(
        &self,
        pool: &SqlitePool,
    ) -> Result<bool, AppError> {
        match self.fordere_zielmodul::<Z>(pool).await {
            Ok(()) => Ok(true),
            Err(AppError::Forbidden | AppError::ForbiddenMit(_) | AppError::KeinLesezugriff(_)) => {
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }
}

/// Lese-Gate-Extractor (LFH-230): Org-Floor (via [`EinsatzKontext`]) + `fordere_lesezugriff`
/// (+ Modul-Gate `M`, falls `M::KEY` gesetzt). Der Typ ERZWINGT das Gate — ein Handler
/// unter dieser Signatur kann die Lese-Prüfung nicht mehr „vergessen". Über `Deref`
/// bleibt `ctx.einsatz`/`ctx.benutzer`/`ctx.rolle` unverändert erreichbar.
///
/// Präzedenz-Hinweis: Das Gate läuft in `from_request_parts`, also VOR den nachfolgenden
/// `Query`/`Json`-Extractoren des Handlers (früher lief es im Rumpf, nach dem Body-Parse).
/// Kein Gate liest den Body → keine Allow/Deny-Änderung; nur ein Request, der GLEICHZEITIG
/// unberechtigt UND body-/query-kaputt ist, antwortet jetzt 403 statt 400/422 (bewusst:
/// nicht autorisiert → keine Verarbeitung untrusted Eingaben).
pub struct EinsatzLesezugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzLesezugriff<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_lesezugriff()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzLesezugriff<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Schreib-Gate-Extractor (LFH-230): Org-Floor + `fordere_schreibrecht`
/// (+ Modul-Gate `M`) + `fordere_aktiv` — in genau dieser Reihenfolge (Status-Code-
/// Präzedenz UNTER den Gates erhalten). Ownership-/Objekt-Prüfungen (gehört das Kind-Objekt
/// zum Einsatz?) bleiben bewusst im Handler.
///
/// Präzedenz-Hinweis (wie bei [`EinsatzLesezugriff`]): Die Gates laufen in
/// `from_request_parts`, also VOR den nachfolgenden `Query`/`Json`-Extractoren. Kein Gate
/// liest den Body → keine Allow/Deny-Änderung; nur ein Request, der GLEICHZEITIG
/// unberechtigt/nicht-aktiv UND body-kaputt ist, antwortet jetzt 403/409 statt 400/422.
pub struct EinsatzSchreibzugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzSchreibzugriff<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_schreibrecht()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        ctx.fordere_aktiv()?;
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzSchreibzugriff<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Schreibfreigabe ohne vorgezogene Aktiv-Prüfung. Dieser eng begrenzte Gate-Typ ist für
/// idempotente POST-Routen gedacht, die einen bereits committeten Replay auch nach
/// Einsatzabschluss zurückgeben müssen. Org-Floor, Schreibrecht und Modul-Gate laufen wie bei
/// [`EinsatzSchreibzugriff`] strukturell im Extractor; der Handler muss `fordere_aktiv` direkt
/// nach seinem einsatzgebundenen Replay-Lookup und vor jedem echten Insert aufrufen.
///
/// Dazu zieht der Typ die volle Lese-Policy (`fordere_lesezugriff`, LFH-769): ein Replay gibt
/// einen gespeicherten Datensatz heraus und ist damit ein Lesezugriff. Nach der Nachlauffrist
/// (außer für die Einsatzleitung), nach Fristablauf, Vormerkung oder Schwärzung ist er 403 ohne
/// Inhalt, wie jede Leseroute dort (Totalsperre, `src/AGENTS.md`, „Aufbewahrung“). Die Sperre
/// fragt nicht, ob es den Schlüssel gibt, sonst verriete der Statuscode ihn. Am aktiven Einsatz
/// liest jedes Mitglied, dort ändert sich nichts.
pub struct EinsatzSchreibfreigabe<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzSchreibfreigabe<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_schreibrecht()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        ctx.fordere_lesezugriff()?;
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzSchreibfreigabe<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Erfassungs-Gate-Extractor (LLH-1817): wie [`EinsatzSchreibzugriff`], nur mit
/// `fordere_erfassungsrecht` statt `fordere_schreibrecht`: Org-Floor → Erfassungsrecht →
/// Modul-Gate `M` → `fordere_aktiv`. Lässt zusätzlich die Rolle Mitarbeit durch, die erfassen,
/// aber nichts ändern darf. Nur an Handlern der Positivliste, siehe `src/AGENTS.md`,
/// „Erfassungs-Gate (LLH-1817)“.
pub struct EinsatzErfassungszugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzErfassungszugriff<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_erfassungsrecht()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        ctx.fordere_aktiv()?;
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzErfassungszugriff<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Wie [`EinsatzSchreibfreigabe`] (idempotenter Replay ohne vorgezogene Aktiv-Prüfung, mit
/// voller Lese-Policy), nur mit `fordere_erfassungsrecht`: Org-Floor → Erfassungsrecht →
/// Modul-Gate `M` → `fordere_lesezugriff`. Der Handler ruft `fordere_aktiv` nach seinem
/// Replay-Lookup und vor jedem echten Insert selbst auf.
pub struct EinsatzErfassungsfreigabe<M: ModulMarker = OhneModul>(
    pub EinsatzKontext,
    PhantomData<M>,
);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzErfassungsfreigabe<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_erfassungsrecht()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        ctx.fordere_lesezugriff()?;
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzErfassungsfreigabe<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Wie [`EinsatzSchreibzugriff`], nur mit `fordere_einsatzleitung` statt
/// `fordere_schreibrecht`: Org-Floor → Einsatzleitung → Modul-Gate `M` → `fordere_aktiv`.
/// Für Aktionen, die allein der Einsatzleitung zustehen und einen aktiven Einsatz verlangen.
/// Ein eigener Typ statt Schreibzugriff plus Prüfung im Rumpf, weil sonst Führungspersonal an
/// einem abgeschlossenen Einsatz 409 statt 403 bekäme.
pub struct EinsatzLeitungszugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzLeitungszugriff<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_einsatzleitung()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        ctx.fordere_aktiv()?;
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzLeitungszugriff<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Gate der Kopfdaten-, Einstellungs- und Führungsstellen-Routen: Org-Floor →
/// `fordere_schreibrecht_oder_admin` → `fordere_aktiv`. Anders als [`EinsatzSchreibzugriff`] darf
/// hier auch der System-Admin der Einsatz-Org ohne Mitgliedschaft schreiben (der einer fremden
/// Org nicht, LFH-1066); ein Modul-Gate gibt es nicht.
pub struct EinsatzVerwaltungszugriff(pub EinsatzKontext);

impl FromRequestParts<AppState> for EinsatzVerwaltungszugriff {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_schreibrecht_oder_admin()?;
        ctx.fordere_aktiv()?;
        Ok(Self(ctx))
    }
}

impl Deref for EinsatzVerwaltungszugriff {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Gate der Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`, design.md D5): Schalter (sonst
/// 404) → Org-Floor → Einsatzleitung oder System-Admin der Einsatz-Org → Lese-Policy. Bewusst
/// **ohne** `fordere_aktiv`: die Führung wird auch bedient, wenn eine andere Instanz führt oder
/// der Einsatz abgeschlossen ist (Übergabe zur Verwahrung). Ein gekoppeltes Gerät bedient sie nie.
pub struct EinsatzFuehrungszugriff(pub EinsatzKontext);

impl FromRequestParts<AppState> for EinsatzFuehrungszugriff {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        crate::instanz::fuehrung::fordere_enabled(&state.pool).await?;
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        if ctx.geraet.is_some() {
            return Err(AppError::Forbidden);
        }
        let admin = ctx.benutzer.ist_admin() && ctx.benutzer.org_id == ctx.einsatz.org_id;
        if !admin {
            ctx.fordere_einsatzleitung()?;
        }
        ctx.fordere_lesezugriff()?;
        Ok(Self(ctx))
    }
}

impl Deref for EinsatzFuehrungszugriff {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Gate des Wiederöffnens (LLH-1814, Spec `einsatz-abschluss`, design.md D4): Org-Floor → kein
/// Gerät (403) → Einsatzleitung oder System-Admin der Einsatz-Org (sonst 403) → Lese-Policy. Bewusst
/// **ohne** `fordere_aktiv`: es wirkt gerade am abgeschlossenen Einsatz. Frist, Zustand und
/// Spiegel prüft der Repo-Vorgang `repo::wiedereroeffnen` in seiner Transaktion.
pub struct EinsatzWiedereroeffnungszugriff(pub EinsatzKontext);

impl FromRequestParts<AppState> for EinsatzWiedereroeffnungszugriff {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        Self::check(&ctx)?;
        Ok(Self(ctx))
    }
}

impl EinsatzWiedereroeffnungszugriff {
    /// Die Entscheidung des Gates auf einem schon extrahierten Kontext. Eigene Funktion, damit ein
    /// Test sie mit einem Gerät prüfen kann, das sonst durchkäme: Über HTTP hält schon die
    /// Routenschranke der Gerätesitzung jedes Gerät auf (`tests/einsatz_abschluss.rs`,
    /// `ein_geraet_bekommt_403`).
    pub fn check(ctx: &EinsatzKontext) -> Result<(), AppError> {
        if ctx.geraet.is_some() {
            return Err(AppError::Forbidden);
        }
        let admin = ctx.benutzer.ist_admin() && ctx.benutzer.org_id == ctx.einsatz.org_id;
        if !admin {
            ctx.fordere_einsatzleitung()?;
        }
        ctx.fordere_lesezugriff()
    }
}

impl Deref for EinsatzWiedereroeffnungszugriff {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}
