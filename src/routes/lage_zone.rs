use crate::app::AppState;
use crate::benachrichtigung::{
    self, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::lage_zone::repo::{self as zone_repo, ZoneNeu, ZonePatch};
use crate::live::LiveEvent;
// ETB-Wortlaut der Zone: der Baustein liegt seit LFH-690 im Fachmodul (Demo-Import).
use crate::lage_zone::{self, etb_text, LageZoneAnzeige};
use crate::routes::support::{deserialize_optional_field, parse_enum, trimme, AnsichtFilter};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): eine Zone hat sich geändert. Event-Tag `lage_zone`.
pub(crate) fn sse_zone(state: &AppState, einsatz_id: i64, zid: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::LageZone, "zone_id", zid);
}

/// SSE-Notify an das Modul Evakuierung (LFH-673, seit LLH-1034 eigenes Modul): die
/// Flächenzahl eines Bezirks hat sich geändert. Eigenes Ereignis statt der Frontend-Zuordnung
/// `lage_zone → evakuierung`, denn `lage_zone` erreicht nur Leser von Lagekarte/Gefahren — wer
/// nur die Evakuierung liest, sähe `flaechen` sonst nie nachziehen. Nutzlast nur Kennungen, wie
/// in `routes/evakuierung.rs`.
fn sse_bezirk(state: &AppState, einsatz_id: i64, bezirk_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Evakuierung, "bezirk_id", bezirk_id);
}

/// Prüft eine Bezirks-Zuordnung (LFH-673, design.md D4/D5). Reihenfolge = Codes:
/// - Zone anderen Typs → **422** (Zusammenhang: Typ × Zuordnung, wie beim Gefahrengebiet);
/// - kein Zugriff auf das Modul Evakuierung (LLH-1034) → **403** (sonst ließen sich fremde
///   Bezirks-ids per 404/409 abtasten);
/// - Bezirk fehlt oder gehört zu einem anderen Einsatz → **404**;
/// - Bezirk storniert → **409** (Lebenszyklus, kein CAS — die Zonen-Route hat keinen
///   Überschreiben-Dialog).
async fn pruefe_bezirk_zuordnung(
    state: &AppState,
    ctx: &EinsatzKontext,
    typ: &str,
    bezirk_id: i64,
) -> Result<(), AppError> {
    if typ != "evakuierungsbezirk" {
        return Err(AppError::UnprocessableEntity(
            "Bezirks-Zuordnung nur an Zonen vom Typ evakuierungsbezirk".into(),
        ));
    }
    ctx.fordere_modul_zugriff(&state.pool, "evakuierung")
        .await?;
    let bezirk =
        crate::betreuung::repo::bezirk_laden(&state.pool, ctx.einsatz.id, bezirk_id).await?;
    if bezirk.storniert_at.is_some() {
        return Err(AppError::Conflict(format!(
            "Evakuierungsbezirk ‚{}‘ ist storniert",
            bezirk.bezeichnung
        )));
    }
    Ok(())
}

/// GET /api/einsaetze/{id}/zonen — Liste aller Zonen. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    Query(filter): Query<AnsichtFilter>,
) -> Result<Json<Vec<LageZoneAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let mut liste = zone_repo::liste(&state.pool, einsatz_id, filter.ansicht).await?;
    // Ein Abschnittsgerät (LFH-1043, design.md D4) sieht nur die Gefahrenzonen, einsatzweit;
    // Evakuierungsbezirke und freie Skizzen fehlen auch in der Antwort.
    if ctx
        .geraet
        .as_ref()
        .is_some_and(|g| g.ansicht == crate::geraet::Funktionsansicht::Einsatzabschnitt)
    {
        liste.retain(|z| z.typ.ist_gefahrenzone());
    }
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct ZoneBody {
    pub typ: String,
    /// Pflicht ohne `kreis`; mit `kreis` optional und dann nur `Polygon` (LLH-1043).
    pub geometrie_typ: Option<String>,
    /// GeoJSON-Geometry als String (Hausmuster wie FlaecheBody.flaeche_geojson —
    /// das FE sendet JSON.stringify(g), die DB-Spalte ist TEXT). Pflicht ohne `kreis`; mit
    /// `kreis` verboten: die Kreisnäherung rechnet der Server (LLH-1043, design.md D2).
    pub geometrie: Option<String>,
    /// Kreis um einen Punkt (LLH-1043): Mitte und Radius in Metern; der Server rechnet daraus
    /// das Polygon ([`lage_zone::kreis_polygon`]) und speichert die Angaben an der Zone.
    pub kreis: Option<lage_zone::Kreis>,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    /// Ansichts-Zugehörigkeit (LFH-320): das FE sendet die aktive Ansicht; absent/NULL =
    /// auf allen Ansichten sichtbar.
    pub ansicht_id: Option<i64>,
    /// Evakuierungsbezirk (LFH-673), nur bei `typ = evakuierungsbezirk`; absent/NULL = nicht
    /// zugeordnet. Geprüft von [`pruefe_bezirk_zuordnung`].
    pub evakuierungsbezirk_id: Option<i64>,
}

/// Validiert typ/geometrie_typ/geometrie (statt DB-CHECK→500) über
/// [`lage_zone::validiere_neu`], die reine Prüfung im Fachmodul (LFH-690: der Demo-Import
/// ruft dieselbe), bzw. einen Kreis über [`lage_zone::validiere_kreis_neu`] (LLH-1043). Liefert
/// Geometrieklasse und die zu speichernde Geometrie: den validierten Eingabe-String oder die
/// Kreisnäherung des Servers.
fn validiere_neu(body: &ZoneBody) -> Result<(&'static str, String), AppError> {
    if let Some(k) = &body.kreis {
        lage_zone::validiere_kreis_neu(&body.typ, body.geometrie_typ.as_deref(), k)?;
        // Zusammenhang, nicht Feld: zwei Geometriequellen für eine Zone (Statuscode-Konvention).
        if body.geometrie.is_some() {
            return Err(AppError::UnprocessableEntity(
                "Kreis und Geometrie schließen sich aus: die Kreisfläche rechnet der Server".into(),
            ));
        }
        return Ok((
            "Polygon",
            lage_zone::kreis_polygon(k.mitte_lat, k.mitte_lon, k.radius_m),
        ));
    }
    let (Some(geometrie_typ), Some(geometrie)) = (&body.geometrie_typ, &body.geometrie) else {
        return Err(AppError::Validation(
            "geometrie_typ und geometrie fehlen (oder kreis angeben)".into(),
        ));
    };
    lage_zone::validiere_neu(&body.typ, geometrie_typ, geometrie)?;
    let klasse = if geometrie_typ == "Polygon" {
        "Polygon"
    } else {
        "LineString"
    };
    Ok((klasse, geometrie.clone()))
}

/// POST /api/einsaetze/{id}/zonen — anlegen. Schreibrecht + aktiv. ETB „eingerichtet".
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    JsonBody(body): JsonBody<ZoneBody>,
) -> Result<(StatusCode, Json<LageZoneAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (geometrie_typ, geometrie) = validiere_neu(&body)?;
    // Ansicht muss zu diesem Einsatz gehören (LFH-738), sonst 404.
    crate::karten_ansicht::repo::pruefe_zugehoerig(&state.pool, einsatz_id, body.ansicht_id)
        .await?;
    if let Some(bid) = body.evakuierungsbezirk_id {
        pruefe_bezirk_zuordnung(&state, &ctx, &body.typ, bid).await?;
    }

    let label = trimme(body.label.clone());
    let notiz = trimme(body.notiz.clone());
    // farbe nur für freie_skizze; sonst ignorieren (Stil aus typ abgeleitet).
    let farbe = if body.typ == "freie_skizze" {
        trimme(body.farbe.clone())
    } else {
        None
    };

    // F06/LFH-244 Tier-A: Zonen-INSERT (+ ggf. Gruppen-INSERT) + System-ETB-Eintrag atomar
    // in EINER Tx (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige für
    // ETB-Text (Typ-Label + Label) UND Response. SSE erst nach dem Commit (Reinheits-Kontrakt).
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let z = crate::write_retry!(&state.pool, |conn| {
        let id = zone_repo::anlegen_tx(
            conn,
            einsatz_id,
            ZoneNeu {
                typ: &body.typ,
                geometrie_typ,
                geometrie: &geometrie,
                label: label.as_deref(),
                farbe: farbe.as_deref(),
                notiz: notiz.as_deref(),
                ansicht_id: body.ansicht_id,
                evakuierungsbezirk_id: body.evakuierungsbezirk_id,
                kreis: body.kreis,
                erstellt_von: ctx.benutzer.id,
            },
        )
        .await?;
        let z = zone_repo::laden_tx(conn, einsatz_id, id).await?;
        // Eine Kreiszone nennt ihren Radius schon beim Einrichten (LLH-1043, design.md D4).
        let text = match z.kreis_radius_m {
            Some(r) => {
                lage_zone::etb_text_kreis_eingerichtet(z.typ.as_str(), z.label.as_deref(), r)
            }
            None => etb_text(z.typ.as_str(), z.label.as_deref(), "eingerichtet"),
        };
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(z)
    })?;
    sse_zone(&state, einsatz_id, z.id);
    if let Some(bid) = z.evakuierungsbezirk_id {
        sse_bezirk(&state, einsatz_id, bid);
    }
    // Spec `benachrichtigungen`, „Neue Gefahr“: ein neu gezeichnetes Gefahrengebiet (die Anlage
    // legt immer eine eigene Gruppe an) meldet an die Leser der Lagekarte. Änderungen an
    // bestehenden Gefahren (PATCH der Zone, Gebiet umbenennen, Matrix) bleiben still.
    if let Some(gid) = z.gefahrengebiet_id {
        benachrichtigung::melden(
            &state.pool,
            &state.live,
            Anlass::neu(
                einsatz_id,
                BenachrichtigungArt::Gefahr,
                Bezug::neu(BenachrichtigungBezugTyp::Gefahrengebiet, gid),
            )
            .von(ctx.benutzer.id)
            .an(Adressat::ModulLeser("lagekarte")),
        )
        .await;
    }
    Ok((StatusCode::CREATED, Json(z)))
}

#[derive(Debug, Deserialize)]
pub struct ZonePatchBody {
    pub typ: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub farbe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub gefahrengebiet_id: Option<Option<i64>>,
    /// Verschieben/Freigeben (LFH-320): absent = unverändert, `null` = auf alle Ansichten.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ansicht_id: Option<Option<i64>>,
    /// Bezirks-Zuordnung (LFH-673): absent = unverändert, `null` = lösen, Zahl = zuordnen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub evakuierungsbezirk_id: Option<Option<i64>>,
    /// Neuer Radius einer Kreiszone in Metern (LLH-1043): der Server rechnet das Polygon um
    /// dieselbe Mitte neu. An einer Zone ohne Kreis 422.
    pub kreis_radius_m: Option<f64>,
    /// Neue Mitte einer Kreiszone (LLH-1344, design.md D1): nur als Paar mit
    /// [`Self::kreis_mitte_lon`]. Der Server rechnet das Polygon um die neue Mitte mit dem
    /// (unveränderten oder mitgeschickten) Radius neu. An einer Zone ohne Kreis 422.
    pub kreis_mitte_lat: Option<f64>,
    /// Länge der neuen Mitte; nur mit [`Self::kreis_mitte_lat`].
    pub kreis_mitte_lon: Option<f64>,
    /// Neue Geometrie (GeoJSON-String) derselben Klasse — eine punktweise Bearbeitung. Nimmt der
    /// Zone die Kreisangaben (LLH-1043, design.md D3).
    pub geometrie: Option<String>,
}

/// Prüft eine neue Geometrie aus dem PATCH gegen die gespeicherte Klasse: Größe und Struktur
/// sind Feldfehler (400), kaputtes JSON und eine andere Klasse der Zusammenhang (422) — dieselbe
/// Trennung wie beim Anlegen.
fn pruefe_neue_geometrie(geometrie: &str, gespeichert: &str) -> Result<(), AppError> {
    lage_zone::pruefe_geometrie_groesse(geometrie, "geometrie")?;
    let v: serde_json::Value = serde_json::from_str(geometrie)
        .map_err(|_| AppError::UnprocessableEntity("geometrie ist kein gültiges JSON".into()))?;
    if v.get("type").and_then(|t| t.as_str()) != Some(gespeichert) {
        return Err(AppError::UnprocessableEntity(format!(
            "geometrie.type passt nicht zur vorhandenen Geometrie ({gespeichert})"
        )));
    }
    lage_zone::pruefe_geometrie_struktur(&v, "geometrie")
}

/// PATCH /api/einsaetze/{id}/zonen/{zid} — label/typ/farbe/notiz, dazu Radius und Mitte einer
/// Kreiszone (LLH-1043, LLH-1344) oder eine neue Geometrie. ETB „geändert" NUR wenn effektiver
/// typ, label oder die Geometrie sich unterscheidet; eine Kreisänderung schreibt EINE Zeile
/// „Radius alt → neu · Mitte um … versetzt“.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<ZonePatchBody>,
) -> Result<Json<LageZoneAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = zone_repo::laden(&state.pool, einsatz_id, zid).await?;

    // Geometrie (LLH-1043, LLH-1344): Radius und/oder Mitte einer Kreiszone ODER frei — beides
    // zugleich ist ein Widerspruch (422). Felder für sich zuerst (400), dann der Zusammenhang
    // (422).
    if let Some(r) = body.kreis_radius_m {
        lage_zone::pruefe_radius(r)?;
    }
    let neue_mitte = match (body.kreis_mitte_lat, body.kreis_mitte_lon) {
        (Some(lat), Some(lon)) => {
            // Dieselbe Feldprüfung wie beim Anlegen; der Radius steht dabei nur für sich.
            lage_zone::pruefe_kreis(&lage_zone::Kreis {
                mitte_lat: lat,
                mitte_lon: lon,
                radius_m: 1.0,
            })?;
            Some((lat, lon))
        }
        (None, None) => None,
        _ => {
            return Err(AppError::Validation(
                "kreis_mitte_lat und kreis_mitte_lon nur zusammen".into(),
            ))
        }
    };
    if let Some(g) = &body.geometrie {
        lage_zone::pruefe_geometrie_groesse(g, "geometrie")?;
    }
    if (body.kreis_radius_m.is_some() || neue_mitte.is_some()) && body.geometrie.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Kreisangaben und Geometrie schließen sich aus".into(),
        ));
    }
    let vorher_kreis = match (
        vorher.kreis_mitte_lat,
        vorher.kreis_mitte_lon,
        vorher.kreis_radius_m,
    ) {
        (Some(mitte_lat), Some(mitte_lon), Some(radius_m)) => Some(lage_zone::Kreis {
            mitte_lat,
            mitte_lon,
            radius_m,
        }),
        _ => None,
    };
    // Ein unveränderter Kreis (gleicher Radius, gleiche Mitte) rechnet nichts neu und schreibt
    // keinen ETB.
    let neuer_kreis = match (
        vorher_kreis,
        body.kreis_radius_m.is_some() || neue_mitte.is_some(),
    ) {
        (None, true) => {
            return Err(AppError::UnprocessableEntity(
                "Die Zone ist kein Kreis; Radius und Mitte lassen sich nicht setzen".into(),
            ))
        }
        (Some(k), true) => {
            let (mitte_lat, mitte_lon) = neue_mitte.unwrap_or((k.mitte_lat, k.mitte_lon));
            let neu = lage_zone::Kreis {
                mitte_lat,
                mitte_lon,
                radius_m: body.kreis_radius_m.unwrap_or(k.radius_m),
            };
            (neu != k).then_some(neu)
        }
        _ => None,
    };
    if let Some(g) = &body.geometrie {
        pruefe_neue_geometrie(g, &vorher.geometrie_typ)?;
    }
    let kreis_geometrie =
        neuer_kreis.map(|k| lage_zone::kreis_polygon(k.mitte_lat, k.mitte_lon, k.radius_m));
    let geometrie_patch = match (&body.geometrie, neuer_kreis, &kreis_geometrie) {
        (Some(g), _, _) => Some(zone_repo::GeometriePatch::Frei(g)),
        (None, Some(kreis), Some(geometrie)) => {
            Some(zone_repo::GeometriePatch::Kreis { geometrie, kreis })
        }
        _ => None,
    };

    // Effektiver neuer typ; wenn geändert: gültig + passt zur *gespeicherten* Geometrie.
    let neuer_typ = match &body.typ {
        Some(t) => {
            // Feld isoliert unbrauchbar → 400; die Passung zur gespeicherten Geometrie
            // darunter ist ein Zusammenhang → bleibt 422 (LFH-305).
            parse_enum(
                lage_zone::LageZoneTyp::parse,
                t,
                format!("Unbekannter Zonen-Typ: {t}"),
            )?;
            if !lage_zone::geometrie_klasse_passt(t, &vorher.geometrie_typ) {
                return Err(AppError::UnprocessableEntity(format!(
                    "Typ {t} ist mit der vorhandenen Geometrie ({}) nicht zulässig",
                    vorher.geometrie_typ
                )));
            }
            t.clone()
        }
        None => vorher.typ.as_str().to_string(),
    };

    // Effektives label (getrimmt).
    let neues_label: Option<String> = match &body.label {
        Some(opt) => opt.clone().and_then(|s| trimme(Some(s))),
        None => vorher.label.clone(),
    };

    // farbe-Normalisierung: nur freie_skizze darf farbe tragen.
    let farbe_patch: Option<Option<&str>> = if neuer_typ != "freie_skizze" {
        Some(None) // beim Wechsel weg von freie_skizze farbe nullen
    } else {
        body.farbe.as_ref().map(|o| o.as_deref())
    };

    // Gruppen-Zuordnung: nur gefahrengebiet-Zonen; Merge-Ziel muss zum Einsatz gehören.
    let gebiet_patch: Option<Option<i64>> = match &body.gefahrengebiet_id {
        Some(Some(zielid)) => {
            if neuer_typ != "gefahrengebiet" {
                return Err(AppError::UnprocessableEntity(
                    "Gefahrengebiet-Zuordnung nur an gefahrengebiet-Zonen".into(),
                ));
            }
            crate::gefahr::repo::gebiet_laden(&state.pool, einsatz_id, *zielid).await?; // Ownership/NotFound
            Some(Some(*zielid))
        }
        Some(None) => Some(None), // in neue eigene Gruppe abspalten
        None => None,             // unverändert
    };

    // Ansicht (LFH-738): nur das Setzen wird geprüft, `null` gibt auf alle Ansichten frei.
    crate::karten_ansicht::repo::pruefe_zugehoerig(
        &state.pool,
        einsatz_id,
        body.ansicht_id.flatten(),
    )
    .await?;

    // Bezirks-Zuordnung (LFH-673). Nur das SETZEN wird geprüft: Lösen (`null`) und der
    // Wegfall beim Typwechsel legen keine Bezirksangabe offen.
    if let Some(Some(bid)) = body.evakuierungsbezirk_id {
        pruefe_bezirk_zuordnung(&state, &ctx, &neuer_typ, bid).await?;
    }

    let z = zone_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        zid,
        ctx.benutzer.id,
        ZonePatch {
            typ: body.typ.as_deref(),
            label: body
                .label
                .as_ref()
                .map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
            farbe: farbe_patch,
            notiz: body
                .notiz
                .as_ref()
                .map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
            gefahrengebiet_id: gebiet_patch,
            ansicht_id: body.ansicht_id,
            evakuierungsbezirk_id: body.evakuierungsbezirk_id,
            geometrie: geometrie_patch,
        },
    )
    .await?;

    // Sinntragende Änderung? typ, label oder die Geometrie (punktweise) effektiv geändert.
    let typ_geaendert = neuer_typ != vorher.typ.as_str();
    let label_geaendert = neues_label != vorher.label;
    let geometrie_geaendert = body
        .geometrie
        .as_deref()
        .is_some_and(|g| g != vorher.geometrie);
    if typ_geaendert || label_geaendert || geometrie_geaendert {
        super::etb_system_degradiert(
            &state,
            einsatz_id,
            ctx.benutzer.id,
            &etb_text(z.typ.as_str(), z.label.as_deref(), "geändert"),
        )
        .await;
    }
    if let (Some(alt), Some(neu)) = (vorher_kreis, neuer_kreis) {
        let radius = (neu.radius_m != alt.radius_m).then_some((alt.radius_m, neu.radius_m));
        let versatz =
            (neu.mitte_lat != alt.mitte_lat || neu.mitte_lon != alt.mitte_lon).then(|| {
                lage_zone::grosskreis_m(alt.mitte_lat, alt.mitte_lon, neu.mitte_lat, neu.mitte_lon)
            });
        super::etb_system_degradiert(
            &state,
            einsatz_id,
            ctx.benutzer.id,
            &lage_zone::etb_text_kreis_geaendert(
                z.typ.as_str(),
                z.label.as_deref(),
                radius,
                versatz,
            ),
        )
        .await;
    }

    sse_zone(&state, einsatz_id, zid);

    // Bezirks-Zuordnung geändert (auch implizit per Typwechsel) → beide Bezirke zählen neu.
    if vorher.evakuierungsbezirk_id != z.evakuierungsbezirk_id {
        for bid in [vorher.evakuierungsbezirk_id, z.evakuierungsbezirk_id]
            .into_iter()
            .flatten()
        {
            sse_bezirk(&state, einsatz_id, bid);
        }
    }

    // Merge/Split hat die Gebiete-Liste verändert → zusätzlich gefahr-Event (Design-Spec).
    if gebiet_patch.is_some() {
        if let Some(gid) = z.gefahrengebiet_id {
            state
                .live
                .publiziere_objekt(einsatz_id, LiveEvent::Gefahr, "gefahrengebiet_id", gid);
        }
    }

    Ok(Json(z))
}

/// DELETE /api/einsaetze/{id}/zonen/{zid} — aufheben (Hard-Delete). ETB „aufgehoben".
pub async fn aufloesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = zone_repo::laden(&state.pool, einsatz_id, zid).await?;

    // F06/LFH-244 Tier-A: Zonen-DELETE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus dem VOR der Tx geladenen `vorher` berechenbar (kein In-Tx-Reload nötig). Das
    // Aufräumen einer dadurch verwaisten Gefahrengebiet-Gruppe läuft NACH dem Commit auf dem
    // Pool (zweiter Writer — darf nicht in die BEGIN-IMMEDIATE-Tx). SSE ebenfalls nach dem Commit.
    let text = etb_text(vorher.typ.as_str(), vorher.label.as_deref(), "aufgehoben");
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let weg = crate::write_retry!(&state.pool, |conn| {
        let weg = zone_repo::loese_auf_tx(conn, einsatz_id, zid).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(weg)
    })?;
    if let Some(g) = weg.gefahrengebiet_id {
        crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(&state.pool, g).await?;
    }
    sse_zone(&state, einsatz_id, zid);
    if let Some(bid) = weg.evakuierungsbezirk_id {
        sse_bezirk(&state, einsatz_id, bid);
    }
    Ok(StatusCode::NO_CONTENT)
}
