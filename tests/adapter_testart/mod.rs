//! Eine Adapterart nur für Tests (LLH-2017): ruft nicht ins Netz, sondern spielt ein Skript von
//! Ergebnissen ab und merkt sich, was sie gesehen hat.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use lifeline_hub::adapter::art::{
    AdapterArt, Fehlschlag, Feld, FeldTyp, Platz, Uebernahme, Verzeichnis,
};
use lifeline_hub::adapter::geheimnis::{GeheimnisSchluessel, Geheimnisspeicher};
use lifeline_hub::adapter::repo::Adapter;
use lifeline_hub::adapter::ziel::AbrufKontext;
use lifeline_hub::adapter::Rahmen;
use lifeline_hub::error::AppError;
use sqlx::SqliteConnection;

use age::secrecy::ExposeSecret;

/// Was die Art bei einem Abruf sah.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gesehen {
    pub token: Option<String>,
    pub is_probe: bool,
}

#[derive(Default)]
pub struct TestArt {
    /// Ergebnisse der nächsten Abrufe; leer heißt Erfolg mit einem Eintrag.
    pub skript: Mutex<VecDeque<Result<i64, Fehlschlag>>>,
    pub gesehen: Mutex<Vec<Gesehen>>,
    /// Wie oft die zweite Phase (Übernahme) lief.
    pub uebernommen: Arc<AtomicUsize>,
    /// Die nächste Übernahme scheitert in der Datenbank.
    pub uebernahme_scheitert: Arc<AtomicBool>,
    /// SQL, das während des nächsten Abrufs läuft (ein Admin ändert inzwischen etwas).
    pub waehrenddessen: Mutex<Option<(sqlx::SqlitePool, String)>>,
}

/// Übernahme der Test-Art: zählt nur, oder scheitert auf Wunsch.
struct ZaehlendeUebernahme {
    anzahl: i64,
    zaehler: Arc<AtomicUsize>,
    scheitert: bool,
}

impl Uebernahme for ZaehlendeUebernahme {
    fn anzahl(&self) -> i64 {
        self.anzahl
    }

    fn uebernehmen<'a>(
        &'a self,
        _conn: &'a mut SqliteConnection,
        _adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            if self.scheitert {
                return Err(AppError::Internal("Übernahme gescheitert (Test)".into()));
            }
            self.zaehler.fetch_add(1, Ordering::SeqCst);
            Ok(self.anzahl)
        })
    }
}

impl TestArt {
    pub fn plane(&self, ergebnis: Result<i64, Fehlschlag>) {
        self.skript.lock().unwrap().push_back(ergebnis);
    }

    pub fn gesehen(&self) -> Vec<Gesehen> {
        self.gesehen.lock().unwrap().clone()
    }

    pub fn uebernommen(&self) -> usize {
        self.uebernommen.load(Ordering::SeqCst)
    }
}

impl AdapterArt for TestArt {
    fn code(&self) -> &'static str {
        "test"
    }
    fn bezeichnung(&self) -> &'static str {
        "Testquelle"
    }
    fn plaetze(&self) -> &'static [Platz] {
        &[Platz {
            name: "token",
            bezeichnung: "Token",
            pflicht: true,
        }]
    }
    fn felder(&self) -> &'static [Feld] {
        &[
            Feld {
                name: "adresse",
                bezeichnung: "Adresse",
                typ: FeldTyp::Url,
                pflicht: false,
                max: 500,
            },
            Feld {
                name: "gruppe",
                bezeichnung: "Gruppe",
                typ: FeldTyp::Text,
                pflicht: false,
                max: 40,
            },
            Feld {
                name: "server",
                bezeichnung: "Server",
                typ: FeldTyp::Host,
                pflicht: false,
                max: 100,
            },
        ]
    }
    fn intervall_min_s(&self) -> i64 {
        30
    }
    fn intervall_vorschlag_s(&self) -> i64 {
        60
    }
    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            self.gesehen.lock().unwrap().push(Gesehen {
                token: kontext
                    .geheimnis("token")
                    .map(|t| t.expose_secret().to_string()),
                is_probe: kontext.is_probe,
            });
            let waehrend = self.waehrenddessen.lock().unwrap().take();
            if let Some((pool, sql)) = waehrend {
                sqlx::query(sqlx::AssertSqlSafe(sql))
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            let ergebnis = self.skript.lock().unwrap().pop_front().unwrap_or(Ok(1));
            ergebnis.map(|n| {
                Box::new(ZaehlendeUebernahme {
                    anzahl: n,
                    zaehler: self.uebernommen.clone(),
                    scheitert: self.uebernahme_scheitert.swap(false, Ordering::SeqCst),
                }) as Box<dyn Uebernahme>
            })
        })
    }
}

/// Ein Rahmen mit Schlüssel und der Test-Art.
pub fn rahmen() -> (Rahmen, Arc<TestArt>, GeheimnisSchluessel) {
    let schluessel = GeheimnisSchluessel::generate();
    let art = Arc::new(TestArt::default());
    let rahmen = Rahmen::new(
        Geheimnisspeicher::new(Some(schluessel.clone())),
        Verzeichnis::new(vec![art.clone()]),
    );
    (rahmen, art, schluessel)
}

/// Derselbe Rahmen ohne Schlüssel bzw. mit einem anderen (Neustart mit fehlendem oder
/// getauschtem Schlüssel).
pub fn rahmen_mit(art: &Arc<TestArt>, schluessel: Option<GeheimnisSchluessel>) -> Rahmen {
    Rahmen::new(
        Geheimnisspeicher::new(schluessel),
        Verzeichnis::new(vec![art.clone()]),
    )
}
