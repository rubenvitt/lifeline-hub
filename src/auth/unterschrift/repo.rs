//! Speicher der Unterschriftsschlüssel (`unterschrift_schluessel`, design.md D7, D9).

use super::pruefen::{self, VerifySchluessel};
use super::{
    AufnahmeErklaerung, Gegenzeichnung, LetzterSchluesselHalter, UnterschriftSchluesselAnzeige,
    UnterschriftSchluesselHerkunft, UnterschriftSchluesselLieferung, UnterschriftSchluesselZustand,
    ALG_ES256, TYP_AUFNAHME,
};
use crate::error::AppError;
use crate::instanz::basis32::{fingerabdruck, parse_b64, sha256_b64};
use sqlx::{SqliteConnection, SqlitePool};

/// Eine Zeile, wie sie in der DB steht.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SchluesselZeile {
    pub id: i64,
    pub org_id: i64,
    pub herkunft: String,
    pub kopplung_org_id: Option<i64>,
    pub fremde_id: Option<i64>,
    pub benutzer_id: Option<i64>,
    pub benutzer_name: String,
    pub credential_id: String,
    pub alg: String,
    pub schluessel: String,
    pub rp_id: String,
    pub origin: String,
    pub bezeichnung: String,
    pub fingerabdruck: String,
    pub zustand: String,
    pub gegenzeichnung: Option<String>,
    pub stand: i64,
    pub erstellt_at: String,
    pub widerrufen_at: Option<String>,
}

/// Höchstzahl gelieferter Unterschriftsschlüssel je Lieferung (`src/AGENTS.md`, Listen von außen):
/// je Grundstock und je Antwort auf eine Meldung, über alle Orgs zusammen. Abgestimmt auf
/// `melden::ANTWORT_MAX` (Test `groesste_antwort_passt_in_die_lesegrenze`). Die Nachlieferung
/// liefert nach `stand` sortiert; was darüber liegt, folgt mit der nächsten Meldung, weil der Stand
/// der Gegenseite mitwandert. Ein Grundstock darüber ist ein 409.
pub const LIEFERUNGEN_MAX: usize = 64;
/// Länge des Inhabernamens an einem Schlüssel; der Anzeigename selbst hat keine Obergrenze, darum
/// wird er beim Registrieren gekürzt.
pub const NAME_MAX: usize = 200;

const SPALTEN: &str = "id, org_id, herkunft, kopplung_org_id, fremde_id, benutzer_id, \
     benutzer_name, credential_id, alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, \
     zustand, gegenzeichnung, stand, erstellt_at, widerrufen_at";

impl SchluesselZeile {
    pub fn zustand(&self) -> UnterschriftSchluesselZustand {
        UnterschriftSchluesselZustand::parse(&self.zustand)
            .unwrap_or(UnterschriftSchluesselZustand::Widerrufen)
    }

    fn gegenzeichnung(&self) -> Option<Gegenzeichnung> {
        self.gegenzeichnung
            .as_deref()
            .and_then(|g| serde_json::from_str(g).ok())
    }

    pub fn lieferung(&self) -> UnterschriftSchluesselLieferung {
        UnterschriftSchluesselLieferung {
            id: self.id,
            benutzer_name: self.benutzer_name.clone(),
            credential_id: self.credential_id.clone(),
            alg: self.alg.clone(),
            schluessel: self.schluessel.clone(),
            rp_id: self.rp_id.clone(),
            origin: self.origin.clone(),
            bezeichnung: self.bezeichnung.clone(),
            zustand: self.zustand(),
            gegenzeichnung: self.gegenzeichnung(),
            stand: self.stand,
        }
    }

    pub fn pruef_schluessel(&self) -> VerifySchluessel<'_> {
        VerifySchluessel {
            credential_id: &self.credential_id,
            schluessel: &self.schluessel,
            rp_id: &self.rp_id,
            origin: &self.origin,
        }
    }
}

/// Nächster `stand` der lokalen Schlüssel einer Org.
async fn next_stand(conn: &mut SqliteConnection, org_id: i64) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE(MAX(stand), 0) + 1 FROM unterschrift_schluessel \
         WHERE org_id = ? AND herkunft = 'lokal'",
    )
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Hat die Org eine Kopplung, in der eine andere Instanz ihre Schlüssel bekommt (wir stellen aus,
/// das Gegenüber meldet sich)?
pub async fn is_org_verteilt(conn: &mut SqliteConnection, org_id: i64) -> Result<bool, AppError> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM instanz_kopplung_org o JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND o.widerrufen_at IS NULL AND k.richtung = 'wird_gemeldet' \
         AND k.zustand IN ('angebahnt', 'aktiv')",
    )
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(n > 0)
}

/// Was beim Registrieren feststeht.
#[derive(Debug, Clone)]
pub struct NeuerSchluessel<'a> {
    pub org_id: i64,
    pub benutzer_id: i64,
    pub benutzer_name: &'a str,
    pub credential_id: &'a str,
    /// SEC1-Punkt, Base64url.
    pub schluessel: &'a str,
    pub rp_id: &'a str,
    pub origin: &'a str,
    pub bezeichnung: &'a str,
}

/// Legt einen lokal registrierten Schlüssel an. Gültig sofort, solange die Org ihre Schlüssel an
/// keine gekoppelte Instanz verteilt; sonst wartet er auf eine Gegenzeichnung (Spec
/// `org-admin-unterschrift`).
pub async fn create_lokal(
    conn: &mut SqliteConnection,
    neu: &NeuerSchluessel<'_>,
) -> Result<i64, AppError> {
    // Alles, was hier gespeichert wird, geht später mit jeder Lieferung hinaus und muss in
    // `melden::ANTWORT_MAX` passen (Test `groesste_antwort_passt_in_die_lesegrenze`).
    if neu.credential_id.len() > super::pruefen::CREDENTIAL_ID_MAX {
        return Err(AppError::Validation(
            "Die Kennung des Passkeys ist zu lang.".into(),
        ));
    }
    let benutzer_name: String = neu.benutzer_name.chars().take(NAME_MAX).collect();
    let zustand = if is_org_verteilt(conn, neu.org_id).await? {
        UnterschriftSchluesselZustand::WartetAufGegenzeichnung
    } else {
        UnterschriftSchluesselZustand::Gueltig
    };
    let stand = next_stand(conn, neu.org_id).await?;
    let fp = parse_b64(neu.schluessel)
        .map(|b| fingerabdruck(&b))
        .ok_or_else(|| AppError::Internal("Schlüssel unlesbar".into()))?;
    Ok(sqlx::query_scalar(
        "INSERT INTO unterschrift_schluessel (org_id, herkunft, benutzer_id, benutzer_name, \
         credential_id, alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, zustand, stand) \
         VALUES (?, 'lokal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(neu.org_id)
    .bind(neu.benutzer_id)
    .bind(&benutzer_name)
    .bind(neu.credential_id)
    .bind(ALG_ES256)
    .bind(neu.schluessel)
    .bind(neu.rp_id)
    .bind(neu.origin)
    .bind(neu.bezeichnung)
    .bind(fp)
    .bind(zustand.as_str())
    .bind(stand)
    .fetch_one(&mut *conn)
    .await?)
}

/// Ein Schlüssel der Org (beliebiger Herkunft); 404, wenn er nicht zur Org gehört.
pub async fn load(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<SchluesselZeile, AppError> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM unterschrift_schluessel WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Gültige lokale Schlüssel eines Benutzers.
pub async fn list_gueltige_eigene(
    conn: &mut SqliteConnection,
    benutzer_id: i64,
) -> Result<Vec<SchluesselZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM unterschrift_schluessel WHERE benutzer_id = ? \
         AND herkunft = 'lokal' AND zustand = 'gueltig' ORDER BY id"
    )))
    .bind(benutzer_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Setzt einen wartenden Schlüssel nach geprüfter Gegenzeichnung auf gültig.
pub async fn save_gegenzeichnung(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    gegenzeichnung: &Gegenzeichnung,
) -> Result<(), AppError> {
    let stand = next_stand(conn, org_id).await?;
    let n = sqlx::query(
        "UPDATE unterschrift_schluessel SET zustand = 'gueltig', gegenzeichnung = ?, stand = ? \
         WHERE id = ? AND org_id = ? AND herkunft = 'lokal' AND zustand = 'wartet_auf_gegenzeichnung'",
    )
    .bind(serde_json::to_string(gegenzeichnung).expect("serialisierbar"))
    .bind(stand)
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if n != 1 {
        return Err(AppError::Conflict(
            "Der Schlüssel wartet nicht (mehr) auf eine Gegenzeichnung.".into(),
        ));
    }
    Ok(())
}

/// Ist `id` der letzte gültige lokale Schlüssel einer Org, die ihre Schlüssel verteilt?
pub async fn is_letzter_bei_kopplung(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<bool, AppError> {
    if !is_org_verteilt(conn, org_id).await? {
        return Ok(false);
    }
    let andere: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM unterschrift_schluessel WHERE org_id = ? AND herkunft = 'lokal' \
         AND zustand = 'gueltig' AND id <> ?",
    )
    .bind(org_id)
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(andere == 0)
}

/// Passen `eingabe` und die letzten vier Zeichen des Fingerabdrucks zusammen? Trennzeichen,
/// Leerraum und Groß- und Kleinschreibung zählen nicht (design.md D3).
pub fn is_fingerabdruck_ende(fingerabdruck: &str, eingabe: &str) -> bool {
    let norm = |t: &str| -> String {
        t.chars()
            .filter(char::is_ascii_alphanumeric)
            .map(|c| c.to_ascii_uppercase())
            .collect()
    };
    let eingabe = norm(eingabe);
    eingabe.len() == 4 && norm(fingerabdruck).ends_with(&eingabe)
}

/// Bestätigt einen vom Gegenüber gelieferten, wartenden Schlüssel der Org (LLH-1605); `false`,
/// wenn er nicht (mehr) wartet. Der bedingte `UPDATE` macht einen doppelten Klick wirkungslos.
pub async fn confirm(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    decide(
        conn,
        org_id,
        id,
        UnterschriftSchluesselZustand::Gueltig,
        benutzer_id,
        jetzt,
    )
    .await
}

/// Weist einen vom Gegenüber gelieferten, wartenden Schlüssel der Org zurück; er wird nie gültig.
pub async fn reject(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    decide(
        conn,
        org_id,
        id,
        UnterschriftSchluesselZustand::Abgelehnt,
        benutzer_id,
        jetzt,
    )
    .await
}

async fn decide(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    zustand: UnterschriftSchluesselZustand,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let n = sqlx::query(
        "UPDATE unterschrift_schluessel SET zustand = ?, entschieden_at = ?, entschieden_von = ? \
         WHERE id = ? AND org_id = ? AND herkunft = 'gegenueber' \
         AND zustand = 'wartet_auf_bestaetigung'",
    )
    .bind(zustand.as_str())
    .bind(jetzt)
    .bind(benutzer_id)
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(n == 1)
}

/// Widerruft einen lokalen Schlüssel; `false`, wenn er schon widerrufen war.
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let stand = next_stand(conn, org_id).await?;
    let n = sqlx::query(
        "UPDATE unterschrift_schluessel SET zustand = 'widerrufen', widerrufen_at = ?, stand = ? \
         WHERE id = ? AND org_id = ? AND herkunft = 'lokal' AND zustand <> 'widerrufen'",
    )
    .bind(jetzt)
    .bind(stand)
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(n == 1)
}

/// Widerruft alle Schlüssel eines Benutzers (Deaktivieren, Herabstufen; im selben Commit wie die
/// Änderung am Konto). Liefert die widerrufenen Fingerabdrücke.
pub async fn alle_des_benutzers_widerrufen(
    conn: &mut SqliteConnection,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Vec<String>, AppError> {
    let zeilen: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT id, org_id, fingerabdruck FROM unterschrift_schluessel WHERE benutzer_id = ? \
         AND herkunft = 'lokal' AND zustand <> 'widerrufen'",
    )
    .bind(benutzer_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut aus = Vec::with_capacity(zeilen.len());
    for (id, org_id, fp) in zeilen {
        if widerrufen(conn, org_id, id, jetzt).await? {
            aus.push(fp);
        }
    }
    Ok(aus)
}

/// Grundstock beim Koppeln: alle gültigen lokalen Schlüssel der Org und der höchste Stand. Mehr
/// als [`LIEFERUNGEN_MAX`] sind ein 409 statt eines abgeschnittenen Grundstocks: was danach mit der
/// Nachlieferung käme, bräuchte eine Gegenzeichnung, die ein Schlüssel aus der Zeit vor der
/// Kopplung nicht hat, und ginge still verloren.
pub async fn grundstock(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<(Vec<UnterschriftSchluesselLieferung>, i64), AppError> {
    let zeilen: Vec<SchluesselZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM unterschrift_schluessel WHERE org_id = ? AND herkunft = 'lokal' \
         AND zustand = 'gueltig' ORDER BY stand LIMIT {}",
        LIEFERUNGEN_MAX + 1
    )))
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    if zeilen.len() > LIEFERUNGEN_MAX {
        return Err(AppError::Conflict(format!(
            "Die Organisation hat mehr als {LIEFERUNGEN_MAX} gültige Unterschriftsschlüssel. \
             Bitte vor dem Koppeln die überzähligen widerrufen."
        )));
    }
    let stand: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(stand), 0) FROM unterschrift_schluessel WHERE org_id = ? AND herkunft = 'lokal'",
    )
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok((
        zeilen.iter().map(SchluesselZeile::lieferung).collect(),
        stand,
    ))
}

/// Nachlieferung beim Melden: was sich an gültigen oder widerrufenen lokalen Schlüsseln der Org
/// seit `seit` geändert hat, höchstens `hoechstens` (gedeckelt auf [`LIEFERUNGEN_MAX`]). Wartende
/// gehen nie hinaus.
pub async fn nachlieferung(
    conn: &mut SqliteConnection,
    org_id: i64,
    seit: i64,
    hoechstens: usize,
) -> Result<Vec<UnterschriftSchluesselLieferung>, AppError> {
    let zeilen: Vec<SchluesselZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM unterschrift_schluessel WHERE org_id = ? AND herkunft = 'lokal' \
         AND stand > ? AND zustand IN ('gueltig', 'widerrufen') ORDER BY stand LIMIT ?"
    )))
    .bind(org_id)
    .bind(seit)
    .bind(hoechstens.min(LIEFERUNGEN_MAX) as i64)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen.iter().map(SchluesselZeile::lieferung).collect())
}

/// Ein vom Gegenüber gelieferter Schlüssel, den diese Instanz verworfen hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Abgelehnt {
    pub fingerabdruck: String,
    pub benutzer_name: String,
    pub grund: String,
}

/// Wohin gelieferte Schlüssel gehören: welche Org-Zuordnung, welche lokale Org, welche Org dort.
#[derive(Debug, Clone, Copy)]
pub struct Ziel<'a> {
    pub kopplung_org_id: i64,
    pub org_id: i64,
    pub fremde_org_kennung: &'a str,
}

/// Prüft eine Gegenzeichnung gegen die schon bekannten, gültigen Schlüssel dieser Org-Zuordnung.
fn check_gegenzeichnung(
    l: &UnterschriftSchluesselLieferung,
    ziel: &Ziel<'_>,
    bekannte: &[SchluesselZeile],
) -> Result<(), String> {
    let g = l
        .gegenzeichnung
        .as_ref()
        .ok_or_else(|| "ohne Gegenzeichnung".to_string())?;
    let e: AufnahmeErklaerung =
        serde_json::from_str(&g.erklaerung).map_err(|_| "Erklärung unlesbar".to_string())?;
    let schluessel_bytes = parse_b64(&l.schluessel).ok_or("Schlüssel unlesbar")?;
    if e.typ != TYP_AUFNAHME
        || e.org != ziel.fremde_org_kennung
        || e.credential_id != l.credential_id
        || e.schluessel_hash != sha256_b64(&schluessel_bytes)
        || e.rp_id != l.rp_id
        || e.origin != l.origin
        || e.alg != l.alg
    {
        return Err("Erklärung passt nicht zum Schlüssel".into());
    }
    let unterzeichner = bekannte
        .iter()
        .find(|b| {
            b.credential_id == g.unterzeichner_credential_id
                && b.zustand() == UnterschriftSchluesselZustand::Gueltig
        })
        .ok_or_else(|| "gegengezeichnet von einem unbekannten Schlüssel".to_string())?;
    pruefen::verify(
        &g.erklaerung,
        &g.assertion,
        &unterzeichner.pruef_schluessel(),
    )
    .map_err(|f| format!("Gegenzeichnung ungültig: {f}"))
}

/// Übernimmt gelieferte Schlüssel (design.md D7). `grundstock = true` nur beim Koppeln: dann
/// gilt, was der durch den Code gebundene Aussteller liefert. Sonst braucht ein neuer Schlüssel die
/// Gegenzeichnung eines bekannten; ein Widerruf gilt ohne. Liefert die verworfenen Schlüssel.
pub async fn accept_lieferungen(
    conn: &mut SqliteConnection,
    ziel: &Ziel<'_>,
    lieferungen: &[UnterschriftSchluesselLieferung],
    grundstock: bool,
    jetzt: &str,
) -> Result<Vec<Abgelehnt>, AppError> {
    if lieferungen.len() > LIEFERUNGEN_MAX {
        return Err(AppError::Validation(format!(
            "Eine Lieferung darf höchstens {LIEFERUNGEN_MAX} Unterschriftsschlüssel je Org enthalten."
        )));
    }
    // Nicht entdoppelt: jede Zeile wird über ihre id nachgeschlagen, eine doppelte ändert nichts,
    // und ein späterer Widerruf derselben id soll greifen. Die Grenze deckelt die Arbeit.
    let mut abgelehnt = Vec::new();
    for l in lieferungen {
        let fp = parse_b64(&l.schluessel)
            .map(|b| fingerabdruck(&b))
            .unwrap_or_default();
        let vorhanden: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, zustand FROM unterschrift_schluessel WHERE kopplung_org_id = ? AND fremde_id = ?",
        )
        .bind(ziel.kopplung_org_id)
        .bind(l.id)
        .fetch_optional(&mut *conn)
        .await?;
        match (l.zustand, vorhanden) {
            (UnterschriftSchluesselZustand::Widerrufen, Some((id, _))) => {
                sqlx::query(
                    "UPDATE unterschrift_schluessel SET zustand = 'widerrufen', \
                     widerrufen_at = COALESCE(widerrufen_at, ?), stand = ? WHERE id = ?",
                )
                .bind(jetzt)
                .bind(l.stand)
                .bind(id)
                .execute(&mut *conn)
                .await?;
            }
            // Ein unbekannter widerrufener oder ein noch wartender Schlüssel ändert nichts; ein
            // hier schon bekannter gültiger auch nicht, gleich ob er hier gilt, wartet oder
            // abgelehnt ist. Ein widerrufener oder abgelehnter lebt nie wieder auf. Die Zustände
            // der Bestätigung gibt es nur hier, ein Gegenüber liefert sie nicht.
            (UnterschriftSchluesselZustand::Widerrufen, None)
            | (UnterschriftSchluesselZustand::WartetAufGegenzeichnung, _)
            | (UnterschriftSchluesselZustand::WartetAufBestaetigung, _)
            | (UnterschriftSchluesselZustand::Abgelehnt, _)
            | (UnterschriftSchluesselZustand::Gueltig, Some(_)) => {}
            (UnterschriftSchluesselZustand::Gueltig, None) => {
                // Derselbe Schlüssel unter anderer id: ein widerrufener lebt nie wieder auf, ein
                // gültiger steht schon da.
                let schon: Option<String> = sqlx::query_scalar(
                    "SELECT zustand FROM unterschrift_schluessel WHERE kopplung_org_id = ? \
                     AND (credential_id = ? OR schluessel = ?) \
                     ORDER BY zustand IN ('widerrufen', 'abgelehnt') DESC LIMIT 1",
                )
                .bind(ziel.kopplung_org_id)
                .bind(&l.credential_id)
                .bind(&l.schluessel)
                .fetch_optional(&mut *conn)
                .await?;
                match schon.as_deref() {
                    Some(z @ ("widerrufen" | "abgelehnt")) => {
                        abgelehnt.push(Abgelehnt {
                            fingerabdruck: fp,
                            benutzer_name: l.benutzer_name.clone(),
                            grund: if z == "widerrufen" {
                                "Schlüssel war widerrufen".into()
                            } else {
                                "Schlüssel war zurückgewiesen".into()
                            },
                        });
                        continue;
                    }
                    Some(_) => continue,
                    None => {}
                }
                if l.alg != ALG_ES256 {
                    abgelehnt.push(Abgelehnt {
                        fingerabdruck: fp,
                        benutzer_name: l.benutzer_name.clone(),
                        grund: format!("Algorithmus {} nicht unterstützt", l.alg),
                    });
                    continue;
                }
                if !grundstock {
                    let bekannte: Vec<SchluesselZeile> =
                        sqlx::query_as(sqlx::AssertSqlSafe(format!(
                        "SELECT {SPALTEN} FROM unterschrift_schluessel WHERE kopplung_org_id = ? \
                         AND zustand = 'gueltig'"
                    )))
                        .bind(ziel.kopplung_org_id)
                        .fetch_all(&mut *conn)
                        .await?;
                    if let Err(grund) = check_gegenzeichnung(l, ziel, &bekannte) {
                        abgelehnt.push(Abgelehnt {
                            fingerabdruck: fp,
                            benutzer_name: l.benutzer_name.clone(),
                            grund,
                        });
                        continue;
                    }
                }
                sqlx::query(
                    "INSERT INTO unterschrift_schluessel (org_id, herkunft, kopplung_org_id, \
                     fremde_id, benutzer_name, credential_id, alg, schluessel, rp_id, origin, \
                     bezeichnung, fingerabdruck, zustand, gegenzeichnung, stand) \
                     VALUES (?, 'gegenueber', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(ziel.org_id)
                .bind(ziel.kopplung_org_id)
                .bind(l.id)
                .bind(&l.benutzer_name)
                .bind(&l.credential_id)
                .bind(&l.alg)
                .bind(&l.schluessel)
                .bind(&l.rp_id)
                .bind(&l.origin)
                .bind(&l.bezeichnung)
                .bind(&fp)
                // Der Grundstock gilt sofort, das Koppeln ist der Anker; was danach kommt,
                // wartet auf die Bestätigung eines Admins hier (design.md D2, R24).
                .bind(if grundstock {
                    UnterschriftSchluesselZustand::Gueltig.as_str()
                } else {
                    UnterschriftSchluesselZustand::WartetAufBestaetigung.as_str()
                })
                .bind(
                    l.gegenzeichnung
                        .as_ref()
                        .map(|g| serde_json::to_string(g).expect("serialisierbar")),
                )
                .bind(l.stand)
                .execute(&mut *conn)
                .await?;
            }
        }
    }
    let hoechster = lieferungen.iter().map(|l| l.stand).max().unwrap_or(0);
    sqlx::query(
        "UPDATE instanz_kopplung_org SET unterschrift_stand = MAX(unterschrift_stand, ?) WHERE id = ?",
    )
    .bind(hoechster)
    .bind(ziel.kopplung_org_id)
    .execute(&mut *conn)
    .await?;
    Ok(abgelehnt)
}

/// Widerruft die vom Gegenüber übernommenen Schlüssel einer Org-Zuordnung (deren Widerruf).
pub async fn fremde_der_zuordnung_widerrufen(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE unterschrift_schluessel SET zustand = 'widerrufen', \
         widerrufen_at = COALESCE(widerrufen_at, ?) WHERE kopplung_org_id = ? AND zustand <> 'widerrufen'",
    )
    .bind(jetzt)
    .bind(kopplung_org_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Alle Schlüssel einer Org für die Admin-Seite: lokale und die gekoppelter Instanzen.
pub async fn list_fuer_org(
    pool: &SqlitePool,
    org_id: i64,
    benutzer_id: i64,
) -> Result<Vec<UnterschriftSchluesselAnzeige>, AppError> {
    let zeilen: Vec<(SchluesselZeile, Option<String>)> = {
        let roh: Vec<SchluesselZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT {SPALTEN} FROM unterschrift_schluessel WHERE org_id = ? \
             ORDER BY herkunft DESC, zustand = 'widerrufen', id"
        )))
        .bind(org_id)
        .fetch_all(pool)
        .await?;
        let mut aus = Vec::with_capacity(roh.len());
        for z in roh {
            let fremd: Option<String> = match z.kopplung_org_id {
                Some(ko) => {
                    sqlx::query_scalar(
                        "SELECT fremde_org_name FROM instanz_kopplung_org WHERE id = ?",
                    )
                    .bind(ko)
                    .fetch_optional(pool)
                    .await?
                }
                None => None,
            };
            aus.push((z, fremd));
        }
        aus
    };
    let mut aus = Vec::with_capacity(zeilen.len());
    for (z, fremde_org_name) in &zeilen {
        let (gegengezeichnet_von, unterzeichner_fingerabdruck, erklaert_at) =
            match z.gegenzeichnung() {
                Some(g) => {
                    let unterzeichner: Option<(String, String)> = sqlx::query_as(
                        "SELECT benutzer_name, fingerabdruck FROM unterschrift_schluessel \
                         WHERE credential_id = ? AND org_id = ? LIMIT 1",
                    )
                    .bind(&g.unterzeichner_credential_id)
                    .bind(org_id)
                    .fetch_optional(pool)
                    .await?;
                    let erklaert_at = serde_json::from_str::<AufnahmeErklaerung>(&g.erklaerung)
                        .ok()
                        .map(|e| e.zeitpunkt);
                    let (name, fp) = unterzeichner.unzip();
                    (name, fp, erklaert_at)
                }
                None => (None, None, None),
            };
        aus.push(UnterschriftSchluesselAnzeige {
            id: z.id,
            benutzer_name: z.benutzer_name.clone(),
            bezeichnung: z.bezeichnung.clone(),
            fingerabdruck: z.fingerabdruck.clone(),
            zustand: z.zustand(),
            herkunft: UnterschriftSchluesselHerkunft::parse(&z.herkunft)
                .unwrap_or(UnterschriftSchluesselHerkunft::Lokal),
            eigen: z.benutzer_id == Some(benutzer_id),
            erstellt_at: z.erstellt_at.clone(),
            widerrufen_at: z.widerrufen_at.clone(),
            fremde_org_name: fremde_org_name.clone(),
            gegengezeichnet_von,
            unterzeichner_fingerabdruck,
            erklaert_at,
        });
    }
    Ok(aus)
}

/// Eine Zeile für die Anzeige.
/// Konten der Org, die alle gültigen lokalen Schlüssel halten, während die Org ihre Schlüssel an
/// eine gekoppelte Instanz verteilt; ihr Deaktivieren oder Herabstufen ließe die Kopplungen ohne
/// gültigen Schlüssel zurück (design.md D5). Höchstens ein Konto, weil „alle“ sonst niemand hält.
pub async fn list_letzte_halter(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<Vec<LetzterSchluesselHalter>, AppError> {
    let halter: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT benutzer_id FROM unterschrift_schluessel WHERE org_id = ? \
         AND herkunft = 'lokal' AND zustand = 'gueltig' AND benutzer_id IS NOT NULL",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    let [benutzer_id] = halter[..] else {
        return Ok(Vec::new());
    };
    let kopplungen: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT k.gegenueber_name FROM instanz_kopplung_org o \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND o.widerrufen_at IS NULL AND k.richtung = 'wird_gemeldet' \
         AND k.zustand IN ('angebahnt', 'aktiv') ORDER BY k.gegenueber_name",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    if kopplungen.is_empty() {
        return Ok(Vec::new());
    }
    Ok(vec![LetzterSchluesselHalter {
        benutzer_id,
        kopplungen,
    }])
}

pub async fn load_anzeige(
    pool: &SqlitePool,
    org_id: i64,
    benutzer_id: i64,
    id: i64,
) -> Result<UnterschriftSchluesselAnzeige, AppError> {
    list_fuer_org(pool, org_id, benutzer_id)
        .await?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests;
