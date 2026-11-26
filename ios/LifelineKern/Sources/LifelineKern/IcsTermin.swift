import Foundation

/// Ein Termin aus einer `.ics`, so weit die Hülle ihn dem Dialog „Neues Ereignis“ übergibt
/// (LLH-2127). Gelesen wird nur, was der eigene Server für den Lagebesprechungstermin erzeugt
/// (`src/lagebesprechung/ics.rs`): genau ein `VEVENT` mit Zeiten in UTC. Eine Serie, eine Zeitzone,
/// ein ganztägiger Termin oder mehrere Termine ergeben `nil`; dann bietet die App die Datei im
/// Teilen-Blatt an. Fälle: `src-tauri/faelle/kalender.json`.
public struct IcsTermin: Equatable, Sendable {
    public let titel: String
    public let beginn: Date
    public let ende: Date
    /// Sekunden vor dem Beginn; `nil` heißt: keine Erinnerung.
    public let erinnerung: TimeInterval?

    public init(titel: String, beginn: Date, ende: Date, erinnerung: TimeInterval?) {
        self.titel = titel
        self.beginn = beginn
        self.ende = ende
        self.erinnerung = erinnerung
    }

    /// Dauer ohne `DTEND`, wie der Server sie setzt.
    static let standarddauer: TimeInterval = 30 * 60

    public static func lies(_ text: String) -> IcsTermin? {
        var ebenen: [String] = []
        var termine = 0
        var titel = ""
        var beginn: Date?
        var ende: Date?
        var erinnerung: TimeInterval?
        var alarmGesehen = false

        for zeile in entfalte(text) {
            guard let eigenschaft = Eigenschaft(zeile) else { continue }
            switch eigenschaft.name {
            case "BEGIN":
                let art = eigenschaft.wert.uppercased()
                if art == "VEVENT" {
                    termine += 1
                    if termine > 1 { return nil }
                }
                ebenen.append(art)
                continue
            case "END":
                _ = ebenen.popLast()
                continue
            default:
                break
            }

            if ebenen.last == "VEVENT" {
                switch eigenschaft.name {
                case "DTSTART":
                    guard !eigenschaft.hatParameter, let zeit = utc(eigenschaft.wert) else { return nil }
                    beginn = zeit
                case "DTEND":
                    guard !eigenschaft.hatParameter, let zeit = utc(eigenschaft.wert) else { return nil }
                    ende = zeit
                case "SUMMARY":
                    titel = entschluessele(eigenschaft.wert)
                case "RRULE", "RDATE", "DURATION":
                    return nil
                default:
                    break
                }
            } else if ebenen.last == "VALARM", ebenen.dropLast().last == "VEVENT" {
                // Nur die erste Erinnerung, und nur relativ zum Beginn.
                if eigenschaft.name == "TRIGGER", !alarmGesehen {
                    alarmGesehen = true
                    erinnerung = eigenschaft.hatParameter ? nil : vorlauf(eigenschaft.wert)
                }
            }
        }

        guard termine == 1, let beginn else { return nil }
        let schluss = ende ?? beginn.addingTimeInterval(standarddauer)
        guard schluss > beginn else { return nil }
        return IcsTermin(titel: titel, beginn: beginn, ende: schluss, erinnerung: erinnerung)
    }

    /// Eine Inhaltszeile `NAME;PARAMETER:WERT`.
    private struct Eigenschaft {
        let name: String
        let hatParameter: Bool
        let wert: String

        init?(_ zeile: String) {
            guard let doppelpunkt = zeile.firstIndex(of: ":") else { return nil }
            let kopf = zeile[..<doppelpunkt]
            let name = kopf.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
            self.name = name.uppercased()
            self.hatParameter = kopf.contains(";")
            self.wert = String(zeile[zeile.index(after: doppelpunkt)...])
        }
    }

    /// Zeilen nach RFC 5545, 3.1: CRLF oder LF trennt, eine Zeile mit Leerzeichen oder Tab am
    /// Anfang setzt die vorige fort. Auf Unicode-Skalaren, weil `\r\n` als `Character` eins ist.
    static func entfalte(_ text: String) -> [String] {
        var zeilen: [String.UnicodeScalarView] = []
        var aktuell = String.UnicodeScalarView()
        var roh: [String.UnicodeScalarView] = []
        for skalar in text.unicodeScalars {
            if skalar == "\n" {
                roh.append(aktuell)
                aktuell = String.UnicodeScalarView()
            } else {
                aktuell.append(skalar)
            }
        }
        roh.append(aktuell)
        for var zeile in roh {
            if zeile.last == "\r" { zeile.removeLast() }
            if let erstes = zeile.first, erstes == " " || erstes == "\t", !zeilen.isEmpty {
                zeilen[zeilen.count - 1].append(contentsOf: zeile.dropFirst())
            } else {
                zeilen.append(zeile)
            }
        }
        return zeilen.map(String.init).filter { !$0.isEmpty }
    }

    /// TEXT-Escaping nach RFC 5545, 3.3.11 zurücknehmen.
    static func entschluessele(_ wert: String) -> String {
        var aus = ""
        var maskiert = false
        for zeichen in wert {
            if maskiert {
                aus.append(zeichen == "n" || zeichen == "N" ? "\n" : zeichen)
                maskiert = false
            } else if zeichen == "\\" {
                maskiert = true
            } else {
                aus.append(zeichen)
            }
        }
        if maskiert { aus.append("\\") }
        return aus
    }

    /// `JJJJMMTTTHHMMSSZ` in UTC; jede andere Form (Ortszeit, Datum allein) ergibt `nil`.
    static func utc(_ wert: String) -> Date? {
        let zeichen = Array(wert.unicodeScalars)
        guard zeichen.count == 16, zeichen[8] == "T", zeichen[15] == "Z" else { return nil }
        func zahl(_ von: Int, _ bis: Int) -> Int? {
            var ergebnis = 0
            for skalar in zeichen[von..<bis] {
                guard ("0"..."9").contains(skalar) else { return nil }
                ergebnis = ergebnis * 10 + Int(skalar.value - 48)
            }
            return ergebnis
        }
        guard let jahr = zahl(0, 4), let monat = zahl(4, 6), let tag = zahl(6, 8),
            let stunde = zahl(9, 11), let minute = zahl(11, 13), let sekunde = zahl(13, 15)
        else { return nil }
        var kalender = Calendar(identifier: .gregorian)
        guard let utc = TimeZone(identifier: "UTC") else { return nil }
        kalender.timeZone = utc
        let teile = DateComponents(
            year: jahr, month: monat, day: tag, hour: stunde, minute: minute, second: sekunde)
        guard let datum = kalender.date(from: teile) else { return nil }
        // Calendar rollt einen 30. Februar still in den März; das ist kein Termin.
        let zurueck = kalender.dateComponents([.year, .month, .day, .hour, .minute, .second], from: datum)
        guard zurueck.year == jahr, zurueck.month == monat, zurueck.day == tag,
            zurueck.hour == stunde, zurueck.minute == minute, zurueck.second == sekunde
        else { return nil }
        return datum
    }

    /// `-PT<n>M`, `-PT<n>H` oder `-PT<n>S` als Sekunden vor dem Beginn; sonst `nil`.
    static func vorlauf(_ wert: String) -> TimeInterval? {
        guard wert.hasPrefix("-PT"), let einheit = wert.last else { return nil }
        let ziffern = wert.dropFirst(3).dropLast()
        guard !ziffern.isEmpty, ziffern.allSatisfy({ ("0"..."9").contains($0) }),
            let anzahl = Int(ziffern)
        else { return nil }
        switch einheit {
        case "S": return TimeInterval(anzahl)
        case "M": return TimeInterval(anzahl) * 60
        case "H": return TimeInterval(anzahl) * 3600
        default: return nil
        }
    }
}
