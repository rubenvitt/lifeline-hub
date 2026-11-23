import Foundation

/// Die App Group von App und Extension (`com.apple.security.application-groups` in beiden
/// Berechtigungen). Die Serverliste liegt im Speicher der App, den die Extension nicht sieht; die
/// App legt deshalb die Zahl der Server hier ab, die Extension liest sie für den Untertitel.
enum AppGroup {
    static let kennung = "group.dev.rubeen.lifeline.ios"
    static let serverAnzahl = "serverAnzahl"

    static var defaults: UserDefaults? { UserDefaults(suiteName: kennung) }
}
