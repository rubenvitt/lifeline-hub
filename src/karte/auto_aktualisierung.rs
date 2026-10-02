//! Automatische Aktualisierung der Offline-Karten (LFH-993).
//!
//! Ein Wächter prüft den Katalog im eingestellten Abstand und lädt für jede heruntergeladene Karte
//! einen neueren Stand per In-Place-Tausch (die alte Datei bleibt bis zum Tausch ausgeliefert).
//! „Jetzt aktualisieren“ stößt bei Bedarf einen Neubau im karten-service an; der Wächter lädt das
//! Ergebnis danach selbst. Herleitung:
//! `openspec/changes/lfh-993-offline-karten-auto-aktualisierung/design.md` (D1–D10).
//!
//! Der Laufzustand (letzte Prüfung, ausstehende Bauten, Fehler) liegt nur im Speicher; gespeichert
//! wird allein die Einstellung (`karte_auto_aktualisierung`, D10).

use crate::app::AppState;
use crate::config::OfflineKatalogEintrag;
use crate::error::AppError;
use crate::karte::registry::repo::{self, OfflineKarte};
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use karten_katalog::{BuildJob, JobStatus};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

/// Wartezeit nach dem Serverstart bis zur ersten Prüfung (Start und erste Anfragen sollen nicht
/// mit einem Mehr-GB-Download konkurrieren).
pub const START_VERZOEGERUNG: Duration = Duration::from_secs(60);

/// Takt, solange ein Neubau aussteht oder weitere Karten auf ihren Download warten (D1).
pub const KURZER_TAKT: Duration = Duration::from_secs(30);

/// So lange darf der Katalog nach einem fertigen Neubau den neuen Stand schuldig bleiben
/// (CDN-Cache des Manifests), bevor ein Fehler an der Karte steht (D2.4).
pub const KATALOG_FRIST: Duration = Duration::from_secs(15 * 60);

/// Erlaubter Prüfabstand in Stunden (1 Stunde bis 7 Tage).
pub const INTERVALL_STUNDEN_MIN: u64 = 1;
pub const INTERVALL_STUNDEN_MAX: u64 = 168;

/// Effektive Einstellung der Automatik: gespeichert oder, solange nichts gespeichert ist, die
/// Vorgabe aus der Server-Konfiguration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Einstellung {
    pub automatisch: bool,
    pub intervall_stunden: u64,
}

impl Default for Einstellung {
    fn default() -> Self {
        Self {
            automatisch: true,
            intervall_stunden: 6,
        }
    }
}

/// Liegt ein Prüfabstand im erlaubten Bereich?
pub fn intervall_ist_gueltig(stunden: u64) -> bool {
    (INTERVALL_STUNDEN_MIN..=INTERVALL_STUNDEN_MAX).contains(&stunden)
}

/// Phase eines vom Hub angestoßenen Neubaus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BauStand {
    /// Im karten-service eingereiht.
    Wartet,
    /// Wird gebaut, hochgeladen oder veröffentlicht.
    Baut,
    /// Fertig gebaut, der Katalog zeigt den neuen Stand noch nicht (D2.4).
    WartetAufKatalog { seit: DateTime<Utc> },
}

/// Ein Neubau, den „Jetzt aktualisieren“ angestoßen hat und dessen Ergebnis der Wächter lädt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AusstehenderBau {
    pub slug: String,
    pub job_id: u64,
    pub stand: BauStand,
}

/// Laufzustand des Wächters (nur im Speicher).
#[derive(Debug, Default)]
pub struct WaechterZustand {
    /// Gesetzt, sobald der Wächter-Task läuft — Grundlage der ersten „nächsten Prüfung“.
    pub gestartet_at: Option<DateTime<Utc>>,
    pub letzte_pruefung_at: Option<DateTime<Utc>>,
    pub ausstehende_bauten: HashMap<i64, AusstehenderBau>,
    /// Letzter Fehler je Karte; ein späterer Erfolg löscht ihn.
    pub fehler: HashMap<i64, String>,
    /// (URL, Pin), deren Download an der Prüfsumme scheiterte oder abgebrochen wurde: der Wächter
    /// lädt diese Kombination nicht erneut, bis der Katalog etwas anderes führt oder ein Admin
    /// „Jetzt aktualisieren“ wählt (D4).
    pub gesperrt: HashMap<i64, (String, Option<String>)>,
    /// Karte, deren automatischer Download gerade läuft — höchstens einer zur Zeit (D2.3).
    pub auto_laeuft: Option<i64>,
    /// Weitere Karten warten auf ihren Download: nach dem laufenden nicht erst bis zur nächsten
    /// regulären Prüfung warten.
    pub nachholen: bool,
}

/// Wie ein Download ausging, aus Sicht des Wächters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LadeFehler {
    pub text: String,
    /// Prüfsummenfehler oder Abbruch: dieselbe (URL, Pin)-Kombination nicht erneut laden.
    pub sperren: bool,
}

/// Quelle des Offline-Katalogs. In Produktion das Manifest (frisch geholt), in Tests ein fester
/// Katalog — der prozessweite Manifest-Cache ließe sich nicht je Test befüllen.
pub trait KatalogQuelle: Send + Sync {
    fn frisch(&self) -> BoxFuture<'_, Vec<OfflineKatalogEintrag>>;
}

/// Startet den Download eines neueren Stands. In Produktion der In-Place-Tausch; in Tests ein
/// aufzeichnender Lader, weil der SSRF-Guard Loopback-Downloads verwehrt.
pub trait Lader: Send + Sync {
    fn starte<'a>(
        &'a self,
        state: &'a AppState,
        karte: &'a OfflineKarte,
        eintrag: &'a OfflineKatalogEintrag,
    ) -> BoxFuture<'a, Result<(), AppError>>;
}

/// Produktiv-Katalog: TTL-freier Manifest-Abruf, gemergt mit dem einkompilierten Default.
pub struct ManifestKatalog {
    client: reqwest::Client,
}

impl KatalogQuelle for ManifestKatalog {
    fn frisch(&self) -> BoxFuture<'_, Vec<OfflineKatalogEintrag>> {
        Box::pin(crate::karte::katalog::effektiver_katalog_frisch(
            &self.client,
        ))
    }
}

/// Produktiv-Lader: URL prüfen, dann der gemeinsame In-Place-Start (D3).
pub struct InPlaceLader;

impl Lader for InPlaceLader {
    fn starte<'a>(
        &'a self,
        state: &'a AppState,
        karte: &'a OfflineKarte,
        eintrag: &'a OfflineKatalogEintrag,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            let url = crate::karte::download::validiere_download_url(&eintrag.url)
                .map_err(AppError::Validation)?;
            crate::routes::karte::starte_in_place_reload(
                state,
                karte,
                url,
                eintrag.sha256.clone(),
                Some(eintrag.groesse),
            )
            .await
        })
    }
}

/// Geteilter Zugang zur Automatik im `AppState`: Vorgabe, Laufzustand, Wecker, Katalog, Lader.
#[derive(Clone)]
pub struct AutoAktualisierung {
    pub vorgabe: Einstellung,
    zustand: Arc<Mutex<WaechterZustand>>,
    wecker: Arc<Notify>,
    katalog: Arc<dyn KatalogQuelle>,
    lader: Arc<dyn Lader>,
}

impl AutoAktualisierung {
    /// Produktiv: Manifest-Katalog über `client` (kurz getimeboxt), In-Place-Lader.
    pub fn neu(vorgabe: Einstellung, client: reqwest::Client) -> Self {
        Self::mit(
            vorgabe,
            Arc::new(ManifestKatalog { client }),
            Arc::new(InPlaceLader),
        )
    }

    /// Mit eigener Katalogquelle und eigenem Lader (Tests).
    pub fn mit(
        vorgabe: Einstellung,
        katalog: Arc<dyn KatalogQuelle>,
        lader: Arc<dyn Lader>,
    ) -> Self {
        Self {
            vorgabe,
            zustand: Arc::new(Mutex::new(WaechterZustand::default())),
            wecker: Arc::new(Notify::new()),
            katalog,
            lader,
        }
    }

    /// Kurzer, synchroner Zugriff auf den Laufzustand (nie über ein `await` halten).
    pub fn zustand(&self) -> std::sync::MutexGuard<'_, WaechterZustand> {
        self.zustand.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Weckt den Wächter sofort (neuer Bau, geänderte Einstellung).
    pub fn wecken(&self) {
        self.wecker.notify_one();
    }

    pub(crate) fn wecker(&self) -> Arc<Notify> {
        self.wecker.clone()
    }

    /// Frischer Katalog aus der konfigurierten Quelle.
    pub async fn katalog_frisch(&self) -> Vec<OfflineKatalogEintrag> {
        self.katalog.frisch().await
    }

    /// Startet den Download eines neueren Stands über den konfigurierten Lader.
    pub async fn lade(
        &self,
        state: &AppState,
        karte: &OfflineKarte,
        eintrag: &OfflineKatalogEintrag,
    ) -> Result<(), AppError> {
        self.lader.starte(state, karte, eintrag).await
    }

    /// Meldet das Ende eines In-Place-Downloads: Erfolg löscht Fehler und Sperre, ein Fehler
    /// steht an der Karte. Gibt in jedem Fall den Platz für den nächsten automatischen Download
    /// frei.
    pub fn melde_ergebnis(
        &self,
        id: i64,
        url: &str,
        sha256: Option<&str>,
        ergebnis: Result<(), LadeFehler>,
    ) {
        let mut z = self.zustand();
        if z.auto_laeuft == Some(id) {
            z.auto_laeuft = None;
        }
        match ergebnis {
            Ok(()) => {
                z.fehler.remove(&id);
                z.gesperrt.remove(&id);
            }
            Err(f) => {
                if f.sperren {
                    z.gesperrt
                        .insert(id, (url.to_string(), sha256.map(str::to_string)));
                }
                z.fehler.insert(id, f.text);
            }
        }
    }
}

impl AutoAktualisierung {
    /// Effektive Einstellung: gespeichert, sonst die Vorgabe (D10). Ein Lesefehler fällt auf die
    /// Vorgabe zurück — der Wächter soll an einer gestörten DB nicht stehen bleiben.
    pub async fn einstellung(&self, pool: &sqlx::SqlitePool) -> Einstellung {
        match repo::lade_auto_aktualisierung(pool).await {
            Ok(Some((automatisch, intervall_stunden))) => Einstellung {
                automatisch,
                intervall_stunden,
            },
            Ok(None) => self.vorgabe,
            Err(e) => {
                tracing::warn!("Einstellung der Offline-Karten-Automatik nicht lesbar: {e}");
                self.vorgabe
            }
        }
    }

    /// Nächste reguläre Prüfung für die Anzeige; `None`, wenn die Automatik aus ist oder der
    /// Wächter (noch) nicht läuft. Eine schon fällige Prüfung steht auf „jetzt“.
    pub fn naechste_pruefung(
        &self,
        einst: Einstellung,
        jetzt: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        if !einst.automatisch {
            return None;
        }
        let z = self.zustand();
        let faellig = match z.letzte_pruefung_at {
            Some(l) => l + intervall(einst),
            None => z.gestartet_at? + START_VERZOEGERUNG,
        };
        Some(faellig.max(jetzt))
    }
}

fn intervall(einst: Einstellung) -> chrono::Duration {
    chrono::Duration::hours(einst.intervall_stunden as i64)
}

/// Ist die reguläre Prüfung fällig? Ohne bisherige Prüfung immer.
pub fn ist_faellig(
    letzte: Option<DateTime<Utc>>,
    einst: Einstellung,
    jetzt: DateTime<Utc>,
) -> bool {
    letzte.is_none_or(|l| jetzt >= l + intervall(einst))
}

/// Was ein Tick getan hat — für den Takt des Wächters und für Tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct TickBericht {
    /// Der Katalog wurde frisch geholt.
    pub geprueft: bool,
    /// Karte, deren automatischer Download in diesem Tick startete.
    pub gestartet: Option<i64>,
    /// Ein Neubau steht aus oder weitere Karten warten: bald wieder prüfen (D1).
    pub kurzer_takt: bool,
}

/// Ein Schritt des Wächters (D2): ausstehende Bauten auflösen, bei Bedarf den Katalog frisch
/// holen und höchstens einen automatischen Download starten. Ohne laufenden Task testbar.
pub async fn tick_einmal(state: &AppState, jetzt: DateTime<Utc>) -> TickBericht {
    let auto = &state.auto_aktualisierung;
    let einst = auto.einstellung(&state.pool).await;
    let mut bericht = TickBericht::default();

    // Selbstheilung: Ein automatischer Download ohne belegten Fortschritts-Slot ist vorbei.
    {
        let laufend = crate::karte::download::lies_fortschritt(&state.download_fortschritt)
            .keys()
            .copied()
            .collect::<Vec<_>>();
        let mut z = auto.zustand();
        if z.auto_laeuft.is_some_and(|id| !laufend.contains(&id)) {
            z.auto_laeuft = None;
        }
    }

    // 1. Ausstehende Bauten auflösen.
    let erzwingen = loese_bauten_auf(state, jetzt).await;

    // 2. Katalog prüfen — regulär fällig oder durch einen fertigen Bau erzwungen. Läuft noch ein
    //    automatischer Download, wartet die nächste Karte ohnehin; dann kein Abruf.
    let regulaer =
        einst.automatisch && ist_faellig(auto.zustand().letzte_pruefung_at, einst, jetzt);
    let nachholen = auto.zustand().nachholen;
    let laeuft = auto.zustand().auto_laeuft.is_some();
    if !(regulaer || erzwingen || nachholen) || (laeuft && !erzwingen) {
        let z = auto.zustand();
        bericht.kurzer_takt = z.nachholen || !z.ausstehende_bauten.is_empty();
        return bericht;
    }
    let katalog = auto.katalog_frisch().await;
    bericht.geprueft = true;
    auto.zustand().letzte_pruefung_at = Some(jetzt);

    // 3. Fällige Karten bestimmen (sortier, id) und höchstens eine laden.
    let karten = match repo::liste_offline_karten(&state.pool).await {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("Offline-Karten nicht lesbar: {e}");
            return bericht;
        }
    };
    let belegt: Vec<i64> = crate::karte::download::lies_fortschritt(&state.download_fortschritt)
        .keys()
        .copied()
        .collect();
    let mut faellige = Vec::new();
    for k in &karten {
        if k.status != "bereit" || !crate::routes::karte::ist_gemanagt(k) {
            continue;
        }
        let eintrag = crate::routes::karte::finde_update_eintrag(
            &k.name,
            k.quell_url.as_deref(),
            k.sha256.as_deref(),
            &katalog,
        );
        let mut z = auto.zustand();
        let nach_bau = matches!(
            z.ausstehende_bauten.get(&k.id).map(|b| &b.stand),
            Some(BauStand::WartetAufKatalog { .. })
        );
        match eintrag {
            Some(e) => {
                let gesperrt = z.gesperrt.get(&k.id) == Some(&(e.url.clone(), e.sha256.clone()));
                if (einst.automatisch || nach_bau) && !gesperrt && !belegt.contains(&k.id) {
                    faellige.push((k, e.clone()));
                }
            }
            None => {
                // D2.4: Nach einem fertigen Bau zeigt der Katalog noch nichts Neueres.
                if let Some(BauStand::WartetAufKatalog { seit }) =
                    z.ausstehende_bauten.get(&k.id).map(|b| b.stand.clone())
                {
                    if jetzt - seit >= chrono::Duration::from_std(KATALOG_FRIST).unwrap() {
                        z.ausstehende_bauten.remove(&k.id);
                        z.fehler.insert(
                            k.id,
                            "Neubau fertig, der Katalog zeigt noch keinen neuen Stand".into(),
                        );
                    }
                }
            }
        }
    }

    let mut gestartet = None;
    if !laeuft {
        for (k, e) in &faellige {
            match auto.lade(state, k, e).await {
                Ok(()) => {
                    let mut z = auto.zustand();
                    z.auto_laeuft = Some(k.id);
                    z.ausstehende_bauten.remove(&k.id);
                    gestartet = Some(k.id);
                    tracing::info!(
                        "Offline-Karte {}: automatische Aktualisierung von {}",
                        k.id,
                        e.url
                    );
                    break;
                }
                Err(err) => {
                    tracing::warn!(
                        "Automatische Aktualisierung der Karte {} scheitert: {err}",
                        k.id
                    );
                    auto.zustand().fehler.insert(k.id, fehlertext(&err));
                }
            }
        }
    }
    bericht.gestartet = gestartet;
    let weitere = faellige.len() > usize::from(gestartet.is_some());
    let mut z = auto.zustand();
    z.nachholen = weitere;
    bericht.kurzer_takt = weitere || !z.ausstehende_bauten.is_empty();
    bericht
}

/// Fehlertext für die Anzeige an der Karte.
fn fehlertext(e: &AppError) -> String {
    match e {
        AppError::Validation(t) | AppError::UnprocessableEntity(t) | AppError::BadGateway(t) => {
            t.clone()
        }
        anders => anders.to_string(),
    }
}

/// Schritt 1 (D2.1): Job-Stände der ausstehenden Bauten nachziehen. `true`, wenn ein Bau fertig
/// ist und der Katalog frisch geprüft werden muss.
async fn loese_bauten_auf(state: &AppState, jetzt: DateTime<Utc>) -> bool {
    let auto = &state.auto_aktualisierung;
    let ausstehend: Vec<(i64, AusstehenderBau)> = auto
        .zustand()
        .ausstehende_bauten
        .iter()
        .map(|(id, b)| (*id, b.clone()))
        .collect();
    if ausstehend.is_empty() {
        return false;
    }
    // Wer schon auf den Katalog wartet, braucht keinen Job-Abruf mehr.
    let mut erzwingen = ausstehend
        .iter()
        .any(|(_, b)| matches!(b.stand, BauStand::WartetAufKatalog { .. }));
    if ausstehend
        .iter()
        .all(|(_, b)| matches!(b.stand, BauStand::WartetAufKatalog { .. }))
    {
        return erzwingen;
    }
    let jobs: Vec<BuildJob> =
        match crate::routes::karte::service_get_liste::<BuildJob>(state, "/builds").await {
            Ok(j) => j,
            Err(e) => {
                // Dienst kurz weg: ausstehend lassen, der nächste kurze Takt fragt erneut.
                tracing::warn!("Bau-Status nicht abrufbar: {e}");
                return erzwingen;
            }
        };
    let mut z = auto.zustand();
    for (id, bau) in ausstehend {
        if matches!(bau.stand, BauStand::WartetAufKatalog { .. }) {
            continue;
        }
        let Some(eintrag) = z.ausstehende_bauten.get_mut(&id) else {
            continue;
        };
        match jobs.iter().find(|j| j.id == bau.job_id).map(|j| &j.status) {
            Some(JobStatus::Queued) => eintrag.stand = BauStand::Wartet,
            Some(JobStatus::Building | JobStatus::Uploading | JobStatus::Publishing) => {
                eintrag.stand = BauStand::Baut
            }
            Some(JobStatus::Done) => {
                eintrag.stand = BauStand::WartetAufKatalog { seit: jetzt };
                erzwingen = true;
            }
            Some(JobStatus::Failed(f)) => {
                z.ausstehende_bauten.remove(&id);
                z.fehler.insert(id, format!("Neubau fehlgeschlagen: {f}"));
            }
            None => {
                z.ausstehende_bauten.remove(&id);
                z.fehler.insert(
                    id,
                    "Bau-Auftrag beim Kartenbau-Dienst nicht mehr bekannt".into(),
                );
            }
        }
    }
    erzwingen
}

/// Startet den Wächter-Task (D1): erste Prüfung nach [`START_VERZOEGERUNG`], danach im
/// eingestellten Abstand, bei ausstehenden Bauten im [`KURZER_TAKT`]; `wecken` bricht jede
/// Wartezeit ab.
pub fn starte_waechter(state: AppState) {
    tokio::spawn(async move {
        let auto = state.auto_aktualisierung.clone();
        auto.zustand().gestartet_at = Some(Utc::now());
        let wecker = auto.wecker();
        tokio::select! {
            _ = tokio::time::sleep(START_VERZOEGERUNG) => {}
            _ = wecker.notified() => {}
        }
        loop {
            let bericht = tick_einmal(&state, Utc::now()).await;
            let warte = if bericht.kurzer_takt {
                KURZER_TAKT
            } else {
                let einst = auto.einstellung(&state.pool).await;
                // Bis zur nächsten Fälligkeit; ist die Automatik aus, weckt erst eine Änderung
                // der Einstellung oder ein Bau (die Stunde ist nur ein Rückfall).
                match auto.naechste_pruefung(einst, Utc::now()) {
                    Some(t) => (t - Utc::now())
                        .to_std()
                        .unwrap_or(KURZER_TAKT)
                        .max(KURZER_TAKT),
                    None => Duration::from_secs(3600),
                }
            };
            tokio::select! {
                _ = tokio::time::sleep(warte) => {}
                _ = wecker.notified() => {}
            }
        }
    });
}

/// Testhilfen für Integrationstests (`tests/`): fester Katalog und aufzeichnender Lader.
pub mod testhilfen {
    use super::*;

    /// Fester, je Test setzbarer Katalog.
    #[derive(Default)]
    pub struct FesterKatalog(pub Mutex<Vec<OfflineKatalogEintrag>>);

    impl FesterKatalog {
        pub fn setze(&self, eintraege: Vec<OfflineKatalogEintrag>) {
            *self.0.lock().unwrap() = eintraege;
        }
    }

    impl KatalogQuelle for FesterKatalog {
        fn frisch(&self) -> BoxFuture<'_, Vec<OfflineKatalogEintrag>> {
            let k = self.0.lock().unwrap().clone();
            Box::pin(async move { k })
        }
    }

    /// Zeichnet jeden Start auf (Karten-id, URL) und belegt den Fortschritts-Slot der Karte, als
    /// liefe ein Download — so sieht der Rest des Systems „lädt“. `beende` gibt ihn wieder frei.
    #[derive(Default)]
    pub struct AufzeichnenderLader(pub Mutex<Vec<(i64, String)>>);

    impl AufzeichnenderLader {
        pub fn starts(&self) -> Vec<(i64, String)> {
            self.0.lock().unwrap().clone()
        }
    }

    impl Lader for AufzeichnenderLader {
        fn starte<'a>(
            &'a self,
            state: &'a AppState,
            karte: &'a OfflineKarte,
            eintrag: &'a OfflineKatalogEintrag,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async move {
                let f = Arc::new(crate::karte::download::Fortschritt::default());
                if !crate::karte::download::reserviere_fortschritt(
                    &state.download_fortschritt,
                    karte.id,
                    f,
                ) {
                    return Err(AppError::UnprocessableEntity(
                        "Für diese Karte läuft bereits ein Download".into(),
                    ));
                }
                self.0.lock().unwrap().push((karte.id, eintrag.url.clone()));
                Ok(())
            })
        }
    }

    /// Beendet einen aufgezeichneten Download wie der echte Spawn: bei Erfolg trägt die Zeile den
    /// neuen Stand (Prüfsumme, Quell-URL), dann Slot frei und Ergebnis melden.
    pub async fn beende(
        state: &AppState,
        id: i64,
        eintrag: &OfflineKatalogEintrag,
        ergebnis: Result<(), LadeFehler>,
    ) {
        if ergebnis.is_ok() {
            let pfad = format!("karte-{id}.mbtiles");
            let sha = eintrag.sha256.clone().unwrap_or_default();
            repo::markiere_bereit(&state.pool, id, &pfad, eintrag.groesse, &sha)
                .await
                .unwrap();
            repo::aktualisiere_quell_url(&state.pool, id, &eintrag.url)
                .await
                .unwrap();
        }
        crate::karte::download::schreibe_fortschritt(&state.download_fortschritt).remove(&id);
        state.auto_aktualisierung.melde_ergebnis(
            id,
            &eintrag.url,
            eintrag.sha256.as_deref(),
            ergebnis,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::testhilfen::{beende, AufzeichnenderLader, FesterKatalog};
    use super::*;
    use crate::live::LiveHub;

    const SHA_ALT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SHA_NEU: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    struct Umgebung {
        state: AppState,
        katalog: Arc<FesterKatalog>,
        lader: Arc<AufzeichnenderLader>,
        _tmp: tempfile::TempDir,
    }

    async fn umgebung() -> Umgebung {
        let katalog = Arc::new(FesterKatalog::default());
        let lader = Arc::new(AufzeichnenderLader::default());
        let auto = AutoAktualisierung::mit(Einstellung::default(), katalog.clone(), lader.clone());
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(crate::db::test_pool().await, tmp.path().into(), auto);
        Umgebung {
            state,
            katalog,
            lader,
            _tmp: tmp,
        }
    }

    fn test_state(
        pool: sqlx::SqlitePool,
        karten_dir: std::path::PathBuf,
        auto: AutoAktualisierung,
    ) -> AppState {
        AppState {
            pool,
            live: LiveHub::new(),
            fachebenen: crate::karte::FachebenenState::neu(),
            karten_dir,
            download_client: crate::karte::download::download_client(),
            download_fortschritt: crate::karte::download::neue_fortschritt_map(),
            karten_service_url: None,
            karten_service_token: None,
            auto_aktualisierung: auto,
        }
    }

    async fn karte(pool: &sqlx::SqlitePool, name: &str, sortier: i64) -> i64 {
        let k = repo::neue_download_karte(
            pool,
            &repo::OfflineDownloadEingabe {
                name: name.into(),
                quell_url: format!("https://cdn.example/maps/{name}.20260701.shortbread.mbtiles"),
                lizenz: "© OSM (ODbL)".into(),
                kachel_schema: "shortbread".into(),
                format: "pbf".into(),
                sortier,
            },
        )
        .await
        .unwrap();
        repo::markiere_bereit(pool, k.id, &format!("karte-{}.mbtiles", k.id), 10, SHA_ALT)
            .await
            .unwrap();
        k.id
    }

    fn eintrag(name: &str, sha: &str) -> OfflineKatalogEintrag {
        OfflineKatalogEintrag {
            name: name.into(),
            url: format!("https://cdn.example/maps/{name}.20261001.shortbread.mbtiles"),
            region: "DE".into(),
            groesse: 10,
            lizenz: "© OSM (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            quelle: "t".into(),
            sha256: Some(sha.into()),
            gruppe: None,
        }
    }

    /// Mini-karten-service: `GET /builds` liefert die gesetzten Jobs.
    async fn karten_service(jobs: Vec<BuildJob>) -> String {
        use axum::{routing::get, Json, Router};
        let app = Router::new().route("/builds", get(move || async move { Json(jobs.clone()) }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://127.0.0.1:{}", addr.port())
    }

    fn job(id: u64, status: JobStatus) -> BuildJob {
        BuildJob {
            id,
            slug: "bremen".into(),
            status,
            gestartet: "2026-10-02T10:00:00Z".into(),
            beendet: None,
        }
    }

    fn jetzt() -> DateTime<Utc> {
        Utc::now()
    }

    // 4.1b: gespeichert gewinnt, sonst gilt die Vorgabe.
    #[tokio::test]
    async fn einstellung_gespeichert_sonst_vorgabe() {
        let pool = crate::db::test_pool().await;
        let vorgabe = Einstellung {
            automatisch: false,
            intervall_stunden: 24,
        };
        let auto = AutoAktualisierung::mit(
            vorgabe,
            Arc::new(FesterKatalog::default()),
            Arc::new(AufzeichnenderLader::default()),
        );
        assert_eq!(auto.einstellung(&pool).await, vorgabe);
        repo::speichere_auto_aktualisierung(&pool, true, 3, None)
            .await
            .unwrap();
        assert_eq!(
            auto.einstellung(&pool).await,
            Einstellung {
                automatisch: true,
                intervall_stunden: 3
            }
        );
    }

    // (a) Ein neuerer Stand startet genau einen Download.
    #[tokio::test]
    async fn neuerer_stand_startet_genau_einen_download() {
        let u = umgebung().await;
        let id = karte(&u.state.pool, "bremen", 0).await;
        u.katalog.setze(vec![eintrag("bremen", SHA_NEU)]);

        let b = tick_einmal(&u.state, jetzt()).await;

        assert!(b.geprueft);
        assert_eq!(b.gestartet, Some(id));
        assert_eq!(u.lader.starts().len(), 1);
        assert!(u
            .state
            .auto_aktualisierung
            .zustand()
            .letzte_pruefung_at
            .is_some());
    }

    // (b) Zwei fällige Karten: ein Download je Tick, der zweite nach dem Ende des ersten.
    #[tokio::test]
    async fn zwei_faellige_karten_nacheinander() {
        let u = umgebung().await;
        let a = karte(&u.state.pool, "bremen", 0).await;
        let b = karte(&u.state.pool, "hamburg", 1).await;
        let ea = eintrag("bremen", SHA_NEU);
        u.katalog
            .setze(vec![ea.clone(), eintrag("hamburg", SHA_NEU)]);

        let t = jetzt();
        let erst = tick_einmal(&u.state, t).await;
        assert_eq!(erst.gestartet, Some(a));
        assert!(erst.kurzer_takt, "die zweite Karte wartet");
        let waehrend = tick_einmal(&u.state, t).await;
        assert_eq!(waehrend.gestartet, None, "nur einer zur Zeit");

        beende(&u.state, a, &ea, Ok(())).await;
        let danach = tick_einmal(&u.state, t).await;
        assert_eq!(danach.gestartet, Some(b), "danach ohne neues Intervall");
        assert_eq!(u.lader.starts().len(), 2);
    }

    // (c) Eine registrierte Karte wird nie angefasst.
    #[tokio::test]
    async fn registrierte_karte_bleibt_unberuehrt() {
        let u = umgebung().await;
        repo::registriere_offline_karte(
            &u.state.pool,
            &repo::OfflineKarteEingabe {
                name: "bremen".into(),
                pfad: "eigen.mbtiles".into(),
                quell_url: Some(
                    "https://cdn.example/maps/bremen.20260701.shortbread.mbtiles".into(),
                ),
                lizenz: Some("© OSM".into()),
                kachel_schema: "shortbread".into(),
                format: "pbf".into(),
                sortier: 0,
            },
        )
        .await
        .unwrap();
        u.katalog.setze(vec![eintrag("bremen", SHA_NEU)]);

        let b = tick_einmal(&u.state, jetzt()).await;

        assert!(b.geprueft);
        assert_eq!(b.gestartet, None);
        assert!(u.lader.starts().is_empty());
    }

    // (d) Automatik aus (gespeichert): kein Download, keine nächste Prüfung.
    #[tokio::test]
    async fn automatik_aus_laedt_nichts() {
        let u = umgebung().await;
        karte(&u.state.pool, "bremen", 0).await;
        u.katalog.setze(vec![eintrag("bremen", SHA_NEU)]);
        repo::speichere_auto_aktualisierung(&u.state.pool, false, 6, None)
            .await
            .unwrap();
        u.state.auto_aktualisierung.zustand().gestartet_at = Some(jetzt());

        let b = tick_einmal(&u.state, jetzt()).await;

        assert_eq!(b, TickBericht::default());
        assert!(u.lader.starts().is_empty());
        let einst = u.state.auto_aktualisierung.einstellung(&u.state.pool).await;
        assert_eq!(
            u.state
                .auto_aktualisierung
                .naechste_pruefung(einst, jetzt()),
            None
        );
    }

    // (d2) Ein verkürzter Prüfabstand macht die Prüfung ohne Neustart fällig.
    #[tokio::test]
    async fn verkuerzter_abstand_macht_pruefung_sofort_faellig() {
        let u = umgebung().await;
        let t = jetzt();
        u.state.auto_aktualisierung.zustand().letzte_pruefung_at =
            Some(t - chrono::Duration::hours(2));
        assert!(
            !tick_einmal(&u.state, t).await.geprueft,
            "6 h noch nicht um"
        );

        repo::speichere_auto_aktualisierung(&u.state.pool, true, 1, None)
            .await
            .unwrap();
        assert!(tick_einmal(&u.state, t).await.geprueft, "1 h ist um");
    }

    // (e) Bau fertig → Katalog frisch und Download, auch bei ausgeschalteter Automatik.
    #[tokio::test]
    async fn fertiger_bau_erzwingt_katalog_und_download() {
        let mut u = umgebung().await;
        let id = karte(&u.state.pool, "bremen", 0).await;
        repo::speichere_auto_aktualisierung(&u.state.pool, false, 6, None)
            .await
            .unwrap();
        u.state.karten_service_url = Some(karten_service(vec![job(7, JobStatus::Done)]).await);
        u.state.karten_service_token = Some("t".into());
        u.state
            .auto_aktualisierung
            .zustand()
            .ausstehende_bauten
            .insert(
                id,
                AusstehenderBau {
                    slug: "bremen".into(),
                    job_id: 7,
                    stand: BauStand::Baut,
                },
            );
        u.katalog.setze(vec![eintrag("bremen", SHA_NEU)]);

        let b = tick_einmal(&u.state, jetzt()).await;

        assert!(b.geprueft);
        assert_eq!(b.gestartet, Some(id));
        assert!(u
            .state
            .auto_aktualisierung
            .zustand()
            .ausstehende_bauten
            .is_empty());
    }

    // (f) Bau gescheitert oder Job unbekannt → Fehler an der Karte.
    #[tokio::test]
    async fn gescheiterter_oder_unbekannter_bau_ist_fehler() {
        let mut u = umgebung().await;
        let a = karte(&u.state.pool, "bremen", 0).await;
        let b = karte(&u.state.pool, "hamburg", 1).await;
        u.state.karten_service_url =
            Some(karten_service(vec![job(7, JobStatus::Failed("planetiler".into()))]).await);
        u.state.karten_service_token = Some("t".into());
        {
            let mut z = u.state.auto_aktualisierung.zustand();
            for (id, job_id) in [(a, 7), (b, 99)] {
                z.ausstehende_bauten.insert(
                    id,
                    AusstehenderBau {
                        slug: "x".into(),
                        job_id,
                        stand: BauStand::Wartet,
                    },
                );
            }
        }

        tick_einmal(&u.state, jetzt()).await;

        let z = u.state.auto_aktualisierung.zustand();
        assert!(z.ausstehende_bauten.is_empty());
        assert_eq!(z.fehler[&a], "Neubau fehlgeschlagen: planetiler");
        assert_eq!(
            z.fehler[&b],
            "Bau-Auftrag beim Kartenbau-Dienst nicht mehr bekannt"
        );
    }

    // (g) Nach 15 Minuten ohne neuen Katalogstand steht ein Fehler an der Karte.
    #[tokio::test]
    async fn katalog_frist_nach_bau_laeuft_ab() {
        let u = umgebung().await;
        let id = karte(&u.state.pool, "bremen", 0).await;
        let t = jetzt();
        u.state
            .auto_aktualisierung
            .zustand()
            .ausstehende_bauten
            .insert(
                id,
                AusstehenderBau {
                    slug: "bremen".into(),
                    job_id: 7,
                    stand: BauStand::WartetAufKatalog {
                        seit: t - chrono::Duration::minutes(10),
                    },
                },
            );

        let b = tick_einmal(&u.state, t).await;
        assert!(b.kurzer_takt, "innerhalb der Frist weiter warten");
        assert!(u.state.auto_aktualisierung.zustand().fehler.is_empty());

        tick_einmal(&u.state, t + chrono::Duration::minutes(6)).await;
        let z = u.state.auto_aktualisierung.zustand();
        assert!(z.ausstehende_bauten.is_empty());
        assert_eq!(
            z.fehler[&id],
            "Neubau fertig, der Katalog zeigt noch keinen neuen Stand"
        );
    }

    // (h) Ein Prüfsummenfehler sperrt dieselbe (URL, Pin)-Kombination; ein anderer Pin nicht.
    #[tokio::test]
    async fn pruefsummenfehler_sperrt_kombination() {
        let u = umgebung().await;
        let id = karte(&u.state.pool, "bremen", 0).await;
        let e = eintrag("bremen", SHA_NEU);
        u.katalog.setze(vec![e.clone()]);
        let t = jetzt();
        assert_eq!(tick_einmal(&u.state, t).await.gestartet, Some(id));
        beende(
            &u.state,
            id,
            &e,
            Err(LadeFehler {
                text: "SHA256 stimmt nicht".into(),
                sperren: true,
            }),
        )
        .await;

        let spaeter = t + chrono::Duration::hours(7);
        assert_eq!(
            tick_einmal(&u.state, spaeter).await.gestartet,
            None,
            "gesperrt"
        );
        assert_eq!(
            u.state.auto_aktualisierung.zustand().fehler[&id],
            "SHA256 stimmt nicht"
        );

        let anders = "c".repeat(64);
        u.katalog.setze(vec![eintrag("bremen", &anders)]);
        let noch_spaeter = spaeter + chrono::Duration::hours(7);
        assert_eq!(
            tick_einmal(&u.state, noch_spaeter).await.gestartet,
            Some(id),
            "ein anderer Pin hebt die Sperre auf"
        );
    }

    // (i) Ein Erfolg löscht den Fehler.
    #[tokio::test]
    async fn erfolg_loescht_fehler() {
        let u = umgebung().await;
        let id = karte(&u.state.pool, "bremen", 0).await;
        let e = eintrag("bremen", SHA_NEU);
        u.katalog.setze(vec![e.clone()]);
        u.state
            .auto_aktualisierung
            .zustand()
            .fehler
            .insert(id, "alt".into());

        tick_einmal(&u.state, jetzt()).await;
        beende(&u.state, id, &e, Ok(())).await;

        let z = u.state.auto_aktualisierung.zustand();
        assert!(z.fehler.is_empty());
        assert_eq!(z.auto_laeuft, None);
    }

    /// Lader wie [`InPlaceLader`], aber ohne SSRF-Prüfung — für den Loopback-Fixture-Server.
    struct LoopbackLader;

    impl Lader for LoopbackLader {
        fn starte<'a>(
            &'a self,
            state: &'a AppState,
            karte: &'a OfflineKarte,
            eintrag: &'a OfflineKatalogEintrag,
        ) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async move {
                let url = reqwest::Url::parse(&eintrag.url).unwrap();
                crate::routes::karte::starte_in_place_reload(
                    state,
                    karte,
                    url,
                    eintrag.sha256.clone(),
                    Some(eintrag.groesse),
                )
                .await
            })
        }
    }

    // 4.3: Ein neuerer Katalogstand landet ohne Request auf dem Gerät — echter Download,
    // echter Tausch derselben Zeile, Meldung an den Wächter.
    #[tokio::test]
    async fn neuerer_stand_landet_ohne_request_auf_dem_geraet() {
        use sha2::{Digest, Sha256};
        let neu = b"NEUE-KARTE".repeat(20);
        let sha: String = Sha256::digest(&neu)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let app = {
            let neu = neu.clone();
            axum::Router::new().route(
                "/bremen.20261001.shortbread.mbtiles",
                axum::routing::get(move || {
                    let n = neu.clone();
                    async move { n }
                }),
            )
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let katalog = Arc::new(FesterKatalog::default());
        let auto = AutoAktualisierung::mit(
            Einstellung::default(),
            katalog.clone(),
            Arc::new(LoopbackLader),
        );
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(crate::db::test_pool().await, tmp.path().into(), auto);
        let id = karte(&state.pool, "bremen", 0).await;
        std::fs::write(tmp.path().join(format!("karte-{id}.mbtiles")), b"ALT").unwrap();
        katalog.setze(vec![OfflineKatalogEintrag {
            url: format!("http://127.0.0.1:{port}/bremen.20261001.shortbread.mbtiles"),
            groesse: neu.len() as i64,
            ..eintrag("bremen", &sha)
        }]);

        assert_eq!(tick_einmal(&state, jetzt()).await.gestartet, Some(id));

        let mut getauscht = false;
        for _ in 0..100 {
            if state.auto_aktualisierung.zustand().auto_laeuft.is_none() {
                getauscht = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(getauscht, "Download endet");
        assert_eq!(
            std::fs::read(tmp.path().join(format!("karte-{id}.mbtiles"))).unwrap(),
            neu,
            "Datei getauscht"
        );
        let zeile = repo::finde_offline_karte(&state.pool, id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(zeile.sha256.as_deref(), Some(sha.as_str()));
        assert!(zeile.quell_url.unwrap().contains("20261001"));
        assert!(state.auto_aktualisierung.zustand().fehler.is_empty());
    }
}
