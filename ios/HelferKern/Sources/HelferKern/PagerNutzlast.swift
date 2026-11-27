import Foundation
import LifelineKern

/// Der entschlüsselte Klartext eines Auftrags-Push (`PagerKlartext` in src/helfer/pager.rs):
/// `{v: 1, s, art: "auftrag", e, t, titel, text}`, bei einer Erinnerung dazu `w` (Stufe 1, 2;
/// LLH-2157).
public struct PagerKlartext: Equatable, Sendable {
    public let version: Int
    /// Name des Servers (`s`).
    public let server: String?
    public let einsatzId: Int64
    public let auftragId: Int64
    public let titel: String
    public let text: String?
    /// Stufe der Erinnerung (`w`); `nil` beim ersten Push.
    public let erinnerung: Int?
}

/// Was der Mitteilungsdienst anzeigt.
public struct PagerMeldung: Equatable, Sendable {
    public let titel: String
    public let text: String
    /// Gruppiert die Aufträge eines Einsatzes (`threadIdentifier`).
    public let thread: String
    public let einsatzId: Int64
    public let auftragId: Int64
}

/// Die Nutzlast eines Auftrags-Push lesen (ADR-0111, gemeinsame Fälle
/// `src-tauri/faelle/helfer-auftrag.json`, Abschnitt `nutzlast`): erst den Umschlag `l` wie die
/// Lifeline-App (`PushNutzlast.umschlag`, AES-256-GCM, AAD = Kennung), nach dem Entschlüsseln den
/// Klartext. Die Entschlüsselung selbst gehört wie bei der Hülle nicht in den Kern: unter Linux gibt
/// es kein CryptoKit; sie steht in `ios/Gemeinsam/Entschluesseler.swift`, den App und
/// Mitteilungsdienst `ios/Helfer/Dienst` einbinden.
public enum PagerNutzlast {
    /// Die einzige Art, die die Helfer-App kennt.
    public static let art = "auftrag"

    /// Der Umschlag `l` der APNs-Nutzlast; `nil` bei jedem Fehler.
    public static func umschlag(_ l: String) -> PushNutzlast.Umschlag? {
        PushNutzlast.umschlag(l)
    }

    /// Gelesen mit `JSONDecoder` (nicht `JSONSerialization`, das Zahlen 0 und 1 zu `Bool` brückt).
    private struct Roh: Decodable {
        let v: Int?
        let s: String?
        let art: String?
        let e: Int64?
        let t: Int64?
        let titel: String?
        let text: String?
        let w: Int64?

        private enum CodingKeys: String, CodingKey { case v, s, art, e, t, titel, text, w }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func zahl(_ k: CodingKeys) -> Int64? { (try? c.decodeIfPresent(Int64.self, forKey: k)) ?? nil }
            func wort(_ k: CodingKeys) -> String? {
                let roh = (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil
                let text = roh?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return text.isEmpty ? nil : text
            }
            v = zahl(.v).map { Int($0) }
            s = wort(.s)
            art = wort(.art)
            e = zahl(.e)
            t = zahl(.t)
            titel = wort(.titel)
            self.text = wort(.text)
            w = zahl(.w)
        }
    }

    /// Liest den Klartext; `nil`, wenn er kein Auftrag der Version 1 mit Einsatz, Auftrag und
    /// Titel ist.
    public static func klartext(_ daten: Data) -> PagerKlartext? {
        guard let roh = try? JSONDecoder().decode(Roh.self, from: daten),
            roh.v == 1, roh.art == Self.art,
            let e = roh.e, let t = roh.t, let titel = roh.titel
        else { return nil }
        return PagerKlartext(
            version: 1, server: roh.s, einsatzId: e, auftragId: t, titel: titel, text: roh.text,
            erinnerung: roh.w.flatMap { $0 > 0 ? Int($0) : nil })
    }

    /// Die Meldung aus dem entschlüsselten Klartext; `nil` wie bei `klartext`. Eine Erinnerung
    /// trägt `AuftragAnzeige.erinnerung` vor dem Titel.
    public static func meldung(aus daten: Data) -> PagerMeldung? {
        guard let k = klartext(daten) else { return nil }
        let titel = k.erinnerung == nil ? k.titel : AuftragAnzeige.erinnerung + k.titel
        return PagerMeldung(
            titel: titel, text: k.text ?? "", thread: "auftraege-\(k.einsatzId)",
            einsatzId: k.einsatzId, auftragId: k.auftragId)
    }
}
