import Foundation
import Security

/// Die eine Kopplung dieses Geräts im Schlüsselbund (Spec „Server-Verbindung“: das Sitzungs-Cookie
/// im Schlüsselbund, kein weiteres Geheimnis): Server und Wert des Cookies `lifeline_sid`. Lesbar
/// nach dem ersten Entsperren, nur auf diesem Gerät. Nie loggen. Positionen liegen nie hier.
enum Sitzungsablage {
    struct Sitzung: Codable, Equatable, Sendable {
        let server: URL
        let cookie: String
    }

    private static let dienst = "dev.rubeen.lifeline.helfer.sitzung"
    private static let konto = "kopplung"

    private static var abfrage: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: dienst,
            kSecAttrAccount as String: konto,
        ]
    }

    static func lesen() -> Sitzung? {
        var anfrage = abfrage
        anfrage[kSecReturnData as String] = true
        anfrage[kSecMatchLimit as String] = kSecMatchLimitOne
        var ergebnis: CFTypeRef?
        guard SecItemCopyMatching(anfrage as CFDictionary, &ergebnis) == errSecSuccess,
            let daten = ergebnis as? Data
        else { return nil }
        return try? JSONDecoder().decode(Sitzung.self, from: daten)
    }

    static func speichern(_ sitzung: Sitzung) {
        loeschen()
        guard let daten = try? JSONEncoder().encode(sitzung) else { return }
        var eintrag = abfrage
        eintrag[kSecValueData as String] = daten
        eintrag[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(eintrag as CFDictionary, nil)
    }

    static func loeschen() {
        SecItemDelete(abfrage as CFDictionary)
    }
}
