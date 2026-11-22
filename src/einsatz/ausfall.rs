//! Ausfall je Einheit für den Lagemonitor (LLH-1929, Change `t31o93c2-ausfall-am-server`).
//!
//! Dieselbe Regel wie die Tönung des Meldebilds im Browser (`toenungsGruende`, gelesen über
//! `frontend/src/lage/ausfallJeEinheit.ts`). Das Fixture `tests/fixtures/verdichtung/regeln.json`,
//! Abschnitt `ausfall`, bindet beide Seiten: wer die Regel nur hier oder nur dort ändert, macht
//! einen der beiden Tests rot. Jede Einheit zählt nur ihre EIGENEN Mittel (Spec `kraeftebaum`);
//! der Baum ändert die Folge des Meldebilds, nie die Zahl einer Zeile, deshalb braucht der Kern
//! ihn nicht.

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use crate::error::AppError;
use crate::katalog::StatusKategorie;
use crate::material::ort::MaterialOrt;
use crate::material::{is_material_ausfall, MaterialArt, MaterialStatus};

/// Bezeichnung der Mittel ohne bekannte Einheit, wie die Sammelzeile des Meldebilds.
pub const OHNE_EINHEIT: &str = "Ohne Einheit";

/// Eine Einheit mit dem, was die Regel braucht. `status_kategorie` ist die Kategorie des
/// abgeleiteten Einheitenstatus (`einheit::repo::leite_status_ab`), `None` ohne Status.
#[derive(Debug, Clone)]
pub struct EinheitMerkmale {
    pub id: i64,
    pub name: String,
    pub sortier: i64,
    pub aufgeloest: bool,
    pub status_kategorie: Option<StatusKategorie>,
}

/// Personal oder Fahrzeug: Einheit, Statuskategorie und ob die Zeile beendet ist.
#[derive(Debug, Clone)]
pub struct MittelMerkmale {
    pub einheit_id: Option<i64>,
    pub status_kategorie: Option<StatusKategorie>,
    pub beendet: bool,
}

/// Ein Fahrzeug; die `id` braucht die Zuordnung seiner Beladung.
#[derive(Debug, Clone)]
pub struct FahrzeugMerkmale {
    pub id: i64,
    pub mittel: MittelMerkmale,
}

/// Ein Materialposten mit Ort und den Spalten der Ausfall-Regel.
#[derive(Debug, Clone)]
pub struct MaterialMerkmale {
    pub ort: Option<MaterialOrt>,
    pub status: MaterialStatus,
    pub art: MaterialArt,
    pub menge: i64,
    pub ausgegeben: i64,
    pub beendet: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AusfallEingabe {
    pub einheiten: Vec<EinheitMerkmale>,
    pub personal: Vec<MittelMerkmale>,
    pub fahrzeuge: Vec<FahrzeugMerkmale>,
    pub material: Vec<MaterialMerkmale>,
}

/// Die Einheiten mit Ausfall, in der Folge der Einheitenliste (`sortier`, dann `id`),
/// [`OHNE_EINHEIT`] zuletzt (Spec `lage-alarmzeile`, „Quellen in der Alarmrolle“).
///
/// - Mittel: aktives Personal und aktive Fahrzeuge der Einheit in der Kategorie
///   `nicht_verfuegbar`; zählt nicht, wenn die Einheit selbst `nicht_verfuegbar` meldet.
/// - Material: Posten an der Einheit oder als Beladung eines ihrer aktiven Fahrzeuge mit Status
///   der Rolle Alarm oder Achtung oder aufgebraucht ([`is_material_ausfall`]).
/// - Eine unbekannte oder aufgelöste Einheit zählt wie keine: ihre Mittel und Material ohne Ort
///   stehen unter „Ohne Einheit“. Material an UHS oder Bereitstellungsraum und Beladung eines
///   beendeten Fahrzeugs zählen nicht.
pub fn einheiten_mit_ausfall(e: &AusfallEingabe) -> Vec<String> {
    let aktiv: HashSet<i64> = e
        .einheiten
        .iter()
        .filter(|x| !x.aufgeloest)
        .map(|x| x.id)
        .collect();
    let schluessel = |einheit_id: Option<i64>| einheit_id.filter(|id| aktiv.contains(id));
    let ist_ausfall = |m: &MittelMerkmale| {
        !m.beendet && m.status_kategorie == Some(StatusKategorie::NichtVerfuegbar)
    };

    let mut mittel: HashMap<Option<i64>, u32> = HashMap::new();
    let mut material: HashMap<Option<i64>, u32> = HashMap::new();

    for p in e.personal.iter().filter(|p| ist_ausfall(p)) {
        *mittel.entry(schluessel(p.einheit_id)).or_default() += 1;
    }
    // Die Einheit jedes aktiven Fahrzeugs: an ihr hängt auch seine Beladung.
    let mut fahrzeug_einheit: HashMap<i64, Option<i64>> = HashMap::new();
    for f in e.fahrzeuge.iter().filter(|f| !f.mittel.beendet) {
        let k = schluessel(f.mittel.einheit_id);
        fahrzeug_einheit.insert(f.id, k);
        if ist_ausfall(&f.mittel) {
            *mittel.entry(k).or_default() += 1;
        }
    }
    for m in &e.material {
        if m.beendet || !is_material_ausfall(m.status, m.art, m.menge, m.ausgegeben) {
            continue;
        }
        let k = match m.ort {
            None => None,
            Some(MaterialOrt::Einheit(id)) => schluessel(Some(id)),
            Some(MaterialOrt::Fahrzeug(id)) => match fahrzeug_einheit.get(&id) {
                Some(k) => *k,
                None => continue,
            },
            Some(MaterialOrt::Uhs(_)) | Some(MaterialOrt::Bereitstellungsraum(_)) => continue,
        };
        *material.entry(k).or_default() += 1;
    }

    let zahl = |m: &HashMap<Option<i64>, u32>, k: Option<i64>| m.get(&k).copied().unwrap_or(0);
    let mut einheiten: Vec<&EinheitMerkmale> =
        e.einheiten.iter().filter(|x| !x.aufgeloest).collect();
    einheiten.sort_by_key(|x| (x.sortier, x.id));
    let mut namen: Vec<String> = einheiten
        .into_iter()
        .filter(|x| {
            let selbst_aus = x.status_kategorie == Some(StatusKategorie::NichtVerfuegbar);
            let mittel = if selbst_aus {
                0
            } else {
                zahl(&mittel, Some(x.id))
            };
            mittel + zahl(&material, Some(x.id)) > 0
        })
        .map(|x| x.name.clone())
        .collect();
    if zahl(&mittel, None) + zahl(&material, None) > 0 {
        namen.push(OHNE_EINHEIT.to_string());
    }
    namen
}

/// Welche Mittel-Listen der Lader liest (LLH-1964). Eine nicht gelesene Liste geht leer in die
/// Regel, wie eine gesperrte Liste im Browser (`leerWennGesperrt` in `lage/useWasBrennt.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AusfallListen {
    pub personal: bool,
    pub fahrzeuge: bool,
    pub material: bool,
}

impl AusfallListen {
    pub const ALL: Self = Self {
        personal: true,
        fahrzeuge: true,
        material: true,
    };

    /// Die Listen, deren Modul im Einsatz nicht ausgeblendet ist (`aus` aus
    /// `berechtigung::load_ausgeblendete_module`).
    pub fn from_ausgeblendet(aus: &HashSet<&'static str>) -> Self {
        Self {
            personal: !aus.contains("personal"),
            fahrzeuge: !aus.contains("fahrzeuge"),
            material: !aus.contains("material"),
        }
    }
}

/// Die Eingabe aus der Datenbank: aktive Einheiten mit abgeleitetem Status über
/// [`crate::einheit::repo::liste`] (eine Ableitung des Status), dazu Personal, Fahrzeuge und
/// Material mit denselben Filtern wie ihre Listen, soweit `listen` sie nennt. Liest keine Namen
/// von Personen.
pub async fn load_einheiten_mit_ausfall(
    pool: &SqlitePool,
    einsatz_id: i64,
    listen: AusfallListen,
) -> Result<Vec<String>, AppError> {
    let einheiten = crate::einheit::repo::liste(pool, einsatz_id)
        .await?
        .into_iter()
        .map(|x| EinheitMerkmale {
            id: x.id,
            name: x.name,
            sortier: x.sortier,
            aufgeloest: false,
            status_kategorie: x.status.kategorie,
        })
        .collect();

    let personal: Vec<(Option<i64>, Option<StatusKategorie>)> = if listen.personal {
        sqlx::query_as(
            "SELECT ep.einheit_id, s.kategorie FROM einsatz_personal ep \
             LEFT JOIN personal_status s ON s.id = ep.status_id \
             WHERE ep.einsatz_id = ? AND ep.beendet_at IS NULL",
        )
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };

    let fahrzeuge: Vec<(i64, Option<i64>, Option<StatusKategorie>)> = if listen.fahrzeuge {
        sqlx::query_as(
            "SELECT ef.id, ef.einheit_id, s.kategorie FROM einsatz_fahrzeug ef \
             LEFT JOIN fahrzeug_status s ON s.id = ef.status_id \
             WHERE ef.einsatz_id = ? AND ef.beendet_at IS NULL",
        )
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };

    type MaterialZeile = (
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        String,
        String,
        i64,
        i64,
    );
    let material: Vec<MaterialZeile> = if listen.material {
        sqlx::query_as(
            "SELECT einheit_id, einsatz_fahrzeug_id, uhs_id, br_id, status, art, menge, ausgegeben \
             FROM einsatz_material WHERE einsatz_id = ? AND beendet_at IS NULL",
        )
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };

    let mut eingabe = AusfallEingabe {
        einheiten,
        personal: personal
            .into_iter()
            .map(|(einheit_id, status_kategorie)| MittelMerkmale {
                einheit_id,
                status_kategorie,
                beendet: false,
            })
            .collect(),
        fahrzeuge: fahrzeuge
            .into_iter()
            .map(|(id, einheit_id, status_kategorie)| FahrzeugMerkmale {
                id,
                mittel: MittelMerkmale {
                    einheit_id,
                    status_kategorie,
                    beendet: false,
                },
            })
            .collect(),
        material: Vec::with_capacity(material.len()),
    };
    for (einheit_id, fahrzeug_id, uhs_id, br_id, status, art, menge, ausgegeben) in material {
        eingabe.material.push(MaterialMerkmale {
            ort: MaterialOrt::aus_spalten(einheit_id, fahrzeug_id, uhs_id, br_id),
            status: MaterialStatus::parse(&status)
                .ok_or_else(|| AppError::Internal(format!("Materialstatus {status}")))?,
            art: MaterialArt::parse(&art)
                .ok_or_else(|| AppError::Internal(format!("Materialart {art}")))?,
            menge,
            ausgegeben,
            beendet: false,
        });
    }
    Ok(einheiten_mit_ausfall(&eingabe))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn id(pool: &SqlitePool, sql: &str, binds: &[Option<i64>]) -> i64 {
        let mut q = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(sql.to_string()));
        for b in binds {
            q = q.bind(*b);
        }
        q.fetch_one(pool).await.unwrap()
    }

    /// Der Lader liest dieselben Zeilen wie die Listen des Browsers (LLH-1929): aufgelöste
    /// Einheit, beendetes Fahrzeug mit Beladung, Material an einer UHS, Handstatus „nicht
    /// verfügbar“ und die Folge der Einheitenliste.
    #[tokio::test]
    async fn lader_liest_die_zeilen_wie_die_listen() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz_id = id(
            &pool,
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A') RETURNING id",
            &[],
        )
        .await;
        let e = Some(einsatz_id);
        let p_aus = Some(id(&pool, "INSERT INTO personal_status (org_id, label, kategorie) VALUES (1, 'krank', 'nicht_verfuegbar') RETURNING id", &[]).await);
        let f_aus = Some(id(&pool, "INSERT INTO fahrzeug_status (org_id, label, kategorie, sortier) VALUES (1, 'außer Dienst', 'nicht_verfuegbar', 90) RETURNING id", &[]).await);
        let einheit = |name: &'static str, sortier: i64| {
            let pool = pool.clone();
            async move {
                Some(
                    id(
                        &pool,
                        &format!("INSERT INTO einsatz_einheit (einsatz_id, name, sortier) VALUES (?, '{name}', {sortier}) RETURNING id"),
                        &[e],
                    )
                    .await,
                )
            }
        };
        let sanitaet = einheit("Sanitätszug", 2).await;
        let logistik = einheit("Logistiktrupp", 1).await;
        let betreuung = einheit("Betreuungsgruppe", 0).await;
        let aufgeloest = einheit("Aufgelöst", 0).await;
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-11-17 10:00:00' WHERE id = ?",
        )
        .bind(aufgeloest)
        .execute(&pool)
        .await
        .unwrap();
        // Betreuungsgruppe meldet von Hand „nicht verfügbar“: ihr krankes Personal zählt nicht.
        sqlx::query("UPDATE einsatz_einheit SET status_id = ? WHERE id = ?")
            .bind(f_aus)
            .bind(betreuung)
            .execute(&pool)
            .await
            .unwrap();
        let personal = "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id, status_id) VALUES (?, 'Anna Muster', ?, ?) RETURNING id";
        id(&pool, personal, &[e, sanitaet, p_aus]).await;
        id(&pool, personal, &[e, betreuung, p_aus]).await;
        id(&pool, personal, &[e, aufgeloest, p_aus]).await;
        // Führungstrupp: nur entlassenes krankes Personal, also kein Ausfall.
        let fuehrung = einheit("Führungstrupp", 3).await;
        let entlassen = id(&pool, personal, &[e, fuehrung, p_aus]).await;
        sqlx::query("UPDATE einsatz_personal SET beendet_at = '2026-11-17 10:00:00', beendet_als = 'entlassen' WHERE id = ?")
            .bind(entlassen)
            .execute(&pool)
            .await
            .unwrap();
        // Logistiktrupp: einsatzbereites Fahrzeug, aber defekte Beladung. Das beendete Fahrzeug
        // der Betreuungsgruppe mit defekter Beladung zählt nirgends.
        let fahrzeug = "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) VALUES (?, 'Florian', ?) RETURNING id";
        let fz = Some(id(&pool, fahrzeug, &[e, logistik]).await);
        let fz_alt = Some(id(&pool, fahrzeug, &[e, betreuung]).await);
        sqlx::query("UPDATE einsatz_fahrzeug SET beendet_at = '2026-11-17 10:00:00', beendet_als = 'entlassen' WHERE id = ?")
            .bind(fz_alt)
            .execute(&pool)
            .await
            .unwrap();
        let material = "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, status, einsatz_fahrzeug_id, uhs_id) VALUES (?, 'Trage', 'geraet', 1, 'defekt', ?, ?) RETURNING id";
        id(&pool, material, &[e, fz, None]).await;
        id(&pool, material, &[e, fz_alt, None]).await;
        let von = Some(id(&pool, "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1, 'T', 'ausfall-test', 'x') RETURNING id", &[]).await);
        let uhs = Some(id(&pool, "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) VALUES (?, 'behandlungsplatz', 'BHP', ?, ?) RETURNING id", &[e, von, von]).await);
        id(&pool, material, &[e, None, uhs]).await;

        assert_eq!(
            load_einheiten_mit_ausfall(&pool, einsatz_id, AusfallListen::ALL)
                .await
                .unwrap(),
            ["Logistiktrupp", "Sanitätszug", OHNE_EINHEIT]
        );
    }

    /// LLH-1964: eine im Einsatz ausgeblendete Liste liest der Lader nicht; sie geht leer in die
    /// Regel wie im Browser (`leerWennGesperrt`). Die Beladung eines nicht gelesenen Fahrzeugs
    /// zählt dann ebenfalls nicht.
    #[tokio::test]
    async fn lader_liest_ausgeblendete_listen_nicht() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let e = Some(
            id(
                &pool,
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A') RETURNING id",
                &[],
            )
            .await,
        );
        let einsatz_id = e.unwrap();
        let p_aus = Some(id(&pool, "INSERT INTO personal_status (org_id, label, kategorie) VALUES (1, 'krank', 'nicht_verfuegbar') RETURNING id", &[]).await);
        let einheit =
            "INSERT INTO einsatz_einheit (einsatz_id, name, sortier) VALUES (?, ?, ?) RETURNING id";
        let logistik = Some(
            sqlx::query_scalar::<_, i64>(einheit)
                .bind(e)
                .bind("Logistiktrupp")
                .bind(1)
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        let sanitaet = Some(
            sqlx::query_scalar::<_, i64>(einheit)
                .bind(e)
                .bind("Sanitätszug")
                .bind(2)
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        let fuehrung = Some(
            sqlx::query_scalar::<_, i64>(einheit)
                .bind(e)
                .bind("Führungstrupp")
                .bind(3)
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        // Logistiktrupp: defekte Trage direkt an der Einheit.
        id(&pool, "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, status, einheit_id) VALUES (?, 'Trage', 'geraet', 1, 'defekt', ?) RETURNING id", &[e, logistik]).await;
        // Sanitätszug: krankes Personal.
        id(&pool, "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id, status_id) VALUES (?, 'Anna Muster', ?, ?) RETURNING id", &[e, sanitaet, p_aus]).await;
        // Führungstrupp: einsatzbereites Fahrzeug mit defekter Beladung (ein Fahrzeug außer
        // Dienst machte die Einheit selbst „nicht verfügbar“ und zählte deshalb nicht).
        let fz = Some(id(&pool, "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) VALUES (?, 'Florian', ?) RETURNING id", &[e, fuehrung]).await);
        id(&pool, "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, status, einsatz_fahrzeug_id) VALUES (?, 'Pumpe', 'geraet', 1, 'defekt', ?) RETURNING id", &[e, fz]).await;

        let load = |listen: AusfallListen| {
            let pool = pool.clone();
            async move {
                load_einheiten_mit_ausfall(&pool, einsatz_id, listen)
                    .await
                    .unwrap()
            }
        };
        assert_eq!(
            load(AusfallListen::ALL).await,
            ["Logistiktrupp", "Sanitätszug", "Führungstrupp"]
        );
        assert_eq!(
            load(AusfallListen {
                material: false,
                ..AusfallListen::ALL
            })
            .await,
            ["Sanitätszug"]
        );
        assert_eq!(
            load(AusfallListen {
                personal: false,
                ..AusfallListen::ALL
            })
            .await,
            ["Logistiktrupp", "Führungstrupp"]
        );
        assert_eq!(
            load(AusfallListen {
                fahrzeuge: false,
                ..AusfallListen::ALL
            })
            .await,
            ["Logistiktrupp", "Sanitätszug"]
        );
    }

    /// LLH-1964, Review: je ausgeblendetes Modul entfällt genau seine Liste.
    #[test]
    fn listen_folgen_den_ausgeblendeten_modulen() {
        use std::collections::HashSet;
        let aus = |m: &[&'static str]| {
            AusfallListen::from_ausgeblendet(&m.iter().copied().collect::<HashSet<_>>())
        };
        assert_eq!(aus(&[]), AusfallListen::ALL);
        assert_eq!(
            aus(&["personal"]),
            AusfallListen {
                personal: false,
                ..AusfallListen::ALL
            }
        );
        assert_eq!(
            aus(&["fahrzeuge"]),
            AusfallListen {
                fahrzeuge: false,
                ..AusfallListen::ALL
            }
        );
        assert_eq!(
            aus(&["material"]),
            AusfallListen {
                material: false,
                ..AusfallListen::ALL
            }
        );
        assert_eq!(aus(&["einheiten", "etb"]), AusfallListen::ALL);
    }
}
