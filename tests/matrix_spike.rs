//! Spike (LLH-2094, Task 1): lässt sich ein verschlüsselter Versand mit dem nachgebauten
//! Homeserver von matrix-sdk prüfen, ohne echten Homeserver?
//!
//! Aufbau: `MatrixMockServer` mit den Schlüssel-Endpunkten (`keys/upload`, `keys/query`,
//! `keys/claim`, die echte hochgeladene Schlüssel zurückgeben). Der Absender ist ein
//! eingeloggter Client mit SQLite-Speicher im `tempdir` (wie später die Anbindung), der
//! Empfänger ein zweiter Client mit Gerät. Der Raum kommt per Sync mit `m.room.encryption`.
//! Erwartet: `room.send` geht als `PUT …/send/m.room.encrypted/{txn}` hinaus, Megolm, ohne
//! Klartext. Task 7 macht daraus den echten Test des Zustellers.

use matrix_sdk::{
    ruma::{
        device_id, event_id, events::room::message::RoomMessageEventContent, room_id, user_id,
        RoomVersionId,
    },
    test_utils::mocks::MatrixMockServer,
};
use matrix_sdk_test::{event_factory::EventFactory, JoinedRoomBuilder};

#[tokio::test]
async fn nachricht_in_verschluesselten_raum_geht_als_m_room_encrypted_hinaus() {
    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;

    let speicher = tempfile::tempdir().expect("tempdir");
    let bot_id = user_id!("@lifeline:example.org");
    let bot = server
        .client_builder_for_crypto_end_to_end(bot_id, device_id!("LIFELINE"))
        .on_builder(|builder| builder.sqlite_store(speicher.path(), Some("passphrase")))
        .build()
        .await;
    let leitstelle_id = user_id!("@leitstelle:example.org");
    let leitstelle = server
        .client_builder_for_crypto_end_to_end(leitstelle_id, device_id!("LEITSTELLE"))
        .build()
        .await;
    // Beide laden ihre Geräteschlüssel hoch; der Bot kennt danach das Gerät der Leitstelle.
    server.exchange_e2ee_identities(&bot, &leitstelle).await;

    let raum_id = room_id!("!lage:example.org");
    let ereignisse = EventFactory::new().room(raum_id).sender(bot_id);
    server
        .mock_sync()
        .ok_and_run(&bot, |sync| {
            sync.add_joined_room(
                JoinedRoomBuilder::new(raum_id)
                    .add_state_event(ereignisse.create(bot_id, RoomVersionId::V10))
                    .add_state_event(ereignisse.room_encryption())
                    .add_state_event(ereignisse.member(bot_id))
                    .add_state_event(ereignisse.member(leitstelle_id).sender(leitstelle_id)),
            );
        })
        .await;
    let raum = bot.get_room(raum_id).expect("Raum nach dem Sync bekannt");
    assert!(
        raum.latest_encryption_state()
            .await
            .expect("Verschlüsselungsstand")
            .is_encrypted(),
        "der Raum gilt als verschlüsselt"
    );

    server
        .mock_get_members()
        .ok(vec![
            ereignisse.member(bot_id).into_raw(),
            ereignisse
                .member(leitstelle_id)
                .sender(leitstelle_id)
                .into_raw(),
        ])
        .mount()
        .await;
    let (gesendet, mock) = server
        .mock_room_send()
        .ok_with_capture(event_id!("$gesendet"), bot_id);
    mock.mock_once().named("send").mount().await;
    // Der Megolm-Raumschlüssel geht per Olm an das Gerät der Leitstelle (`sendToDevice`).
    let (_schluessel_wache, raumschluessel) = server.mock_capture_put_to_device(bot_id).await;

    raum.send(RoomMessageEventContent::text_plain(
        "Lagemeldung 12:00, geheim",
    ))
    .await
    .expect("Versand in den verschlüsselten Raum");

    let schluessel: serde_json::Value = raumschluessel
        .await
        .deserialize_as()
        .expect("JSON des Raumschlüssels");
    assert_eq!(
        schluessel["type"], "m.room.encrypted",
        "to-device: {schluessel}"
    );
    assert_eq!(
        schluessel["content"]["algorithm"],
        "m.olm.v1.curve25519-aes-sha2"
    );

    let ereignis = gesendet.await.expect("PUT …/send/… empfangen");
    let json: serde_json::Value = ereignis.deserialize_as().expect("JSON");
    assert_eq!(json["type"], "m.room.encrypted", "Ereignis: {json}");
    assert_eq!(json["content"]["algorithm"], "m.megolm.v1.aes-sha2");
    assert!(json["content"]["ciphertext"].is_string());
    assert!(
        !json.to_string().contains("Lagemeldung"),
        "kein Klartext im Versand: {json}"
    );
    // Die Olm-/Megolm-Schlüssel liegen in der SQLite-Datei des Speicherverzeichnisses.
    assert!(speicher.path().join("matrix-sdk-crypto.sqlite3").is_file());
}
