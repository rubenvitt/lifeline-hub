import CryptoKit
import Foundation
import LifelineKern

/// Die Kryptografie der Push-Anmeldung in App und Extension (Entwurf „iOS-Alarme über APNs“): der
/// Schlüssel je Kennung, das Öffnen der Nutzlast und der Nachweis zum Abmelden. Gegenstück und
/// gemeinsamer Testvektor: `src/ios_push/krypto.rs`, `src-tauri/faelle/push-nutzlast.json`. Im Kern
/// steht das nicht, weil es unter Linux kein CryptoKit gibt.
enum Entschluesseler {
    /// Länge des GCM-Tags am Ende von `chiffrat`.
    private static let tagLaenge = 16

    /// Öffnet den Umschlag mit AES-256-GCM; AAD ist die Kennung. `nil` bei jedem Fehler (falscher
    /// Schlüssel, fremde Kennung, verändertes Chiffrat).
    static func oeffnen(_ u: PushNutzlast.Umschlag, schluessel: Data) -> Data? {
        guard schluessel.count == 32, u.chiffrat.count >= tagLaenge,
            let nonce = try? AES.GCM.Nonce(data: u.nonce)
        else { return nil }
        let grenze = u.chiffrat.endIndex - tagLaenge
        guard
            let box = try? AES.GCM.SealedBox(
                nonce: nonce, ciphertext: u.chiffrat[..<grenze], tag: u.chiffrat[grenze...])
        else { return nil }
        return try? AES.GCM.open(
            box, using: SymmetricKey(data: schluessel), authenticating: Data(u.kennung.utf8))
    }

    /// base64url(HMAC-SHA256(schluessel, "abmelden:" + kennung)) ohne Auffüllung.
    static func nachweis(kennung: String, schluessel: Data) -> String {
        let code = HMAC<SHA256>.authenticationCode(
            for: Data("abmelden:\(kennung)".utf8), using: SymmetricKey(data: schluessel))
        return Base64URL.encode(Data(code))
    }

    /// 32 zufällige Byte, einmal je Kennung (`Schluesselbund`).
    static func neuerSchluessel() -> Data {
        SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    }
}
