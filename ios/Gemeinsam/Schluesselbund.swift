import Foundation
import Security

/// Die Schlüssel der Push-Anmeldungen im gemeinsamen Schlüsselbund von App und Extension, einer je
/// Kennung (Entwurf „iOS-Alarme über APNs“). Lesbar nach dem ersten Entsperren, damit die Extension
/// auch bei gesperrtem Gerät entschlüsseln kann. Nie loggen.
enum Schluesselbund {
    struct Fehler: Error {
        let status: OSStatus
    }

    private static let dienst = "dev.rubeen.lifeline.ios.push"

    /// `keychain-access-groups` beider Berechtigungen: `$(AppIdentifierPrefix)` steht erst beim
    /// Bauen fest, deshalb trägt die Info.plist beider Targets die fertige Gruppe (`ios/project.yml`).
    private static var gruppe: String? {
        (Bundle.main.object(forInfoDictionaryKey: "LifelineSchluesselbundGruppe") as? String)
            .flatMap { $0.isEmpty ? nil : $0 }
    }

    private static func abfrage(kennung: String) -> [String: Any] {
        var felder: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: dienst,
            kSecAttrAccount as String: kennung,
        ]
        if let gruppe { felder[kSecAttrAccessGroup as String] = gruppe }
        return felder
    }

    /// Legt den Schlüssel der Kennung ab; ein vorhandener wird ersetzt.
    static func speichern(kennung: String, schluessel: Data) throws {
        loeschen(kennung: kennung)
        var eintrag = abfrage(kennung: kennung)
        eintrag[kSecValueData as String] = schluessel
        eintrag[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(eintrag as CFDictionary, nil)
        guard status == errSecSuccess else { throw Fehler(status: status) }
    }

    static func lesen(kennung: String) -> Data? {
        var anfrage = abfrage(kennung: kennung)
        anfrage[kSecReturnData as String] = true
        anfrage[kSecMatchLimit as String] = kSecMatchLimitOne
        var ergebnis: CFTypeRef?
        guard SecItemCopyMatching(anfrage as CFDictionary, &ergebnis) == errSecSuccess else {
            return nil
        }
        return ergebnis as? Data
    }

    static func loeschen(kennung: String) {
        SecItemDelete(abfrage(kennung: kennung) as CFDictionary)
    }
}
