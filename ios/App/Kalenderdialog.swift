import EventKit
import EventKitUI
import LifelineKern
import UIKit
import WebKit

/// Der Systemdialog „Neues Ereignis“ für einen Termin aus einer Kalenderdatei (LLH-2127). Seit
/// iOS 17 läuft er außerhalb der App: sie braucht keine Kalenderfreigabe, liest den Kalender nicht
/// und schreibt nicht selbst hinein; die Person wählt den Kalender und tippt „Hinzufügen“. Nach dem
/// Schließen, ob hinzugefügt oder abgebrochen, räumt er die Datei weg.
enum Kalenderdialog {
    @MainActor
    static func zeige(_ termin: IcsTermin, datei: URL, von webView: WKWebView?) {
        guard let webView, var oben = webView.window?.rootViewController else {
            raeumeWeg(datei)
            return
        }
        while let gezeigt = oben.presentedViewController { oben = gezeigt }

        let speicher = EKEventStore()
        let ereignis = EKEvent(eventStore: speicher)
        ereignis.title = termin.titel
        ereignis.startDate = termin.beginn
        ereignis.endDate = termin.ende
        if let erinnerung = termin.erinnerung {
            ereignis.alarms = [EKAlarm(relativeOffset: -erinnerung)]
        }

        let dialog = EKEventEditViewController()
        dialog.eventStore = speicher
        dialog.event = ereignis
        let begleiter = Begleiter(datei: datei)
        dialog.editViewDelegate = begleiter
        // Kein Wegwischen: nur „Hinzufügen“ oder „Abbrechen“ schließt, und beide räumen die Datei weg.
        dialog.isModalInPresentation = true
        // `editViewDelegate` ist schwach; der Dialog hält seinen Begleiter bis zum Schließen.
        objc_setAssociatedObject(dialog, &Begleiter.schluessel, begleiter, .OBJC_ASSOCIATION_RETAIN)
        oben.present(dialog, animated: true)
    }

    /// Nur Dateioperationen, wie beim Teilen-Blatt.
    static func raeumeWeg(_ datei: URL) {
        try? FileManager.default.removeItem(at: datei.deletingLastPathComponent())
    }

    private final class Begleiter: NSObject, EKEventEditViewDelegate {
        nonisolated(unsafe) static var schluessel: UInt8 = 0
        let datei: URL

        init(datei: URL) {
            self.datei = datei
        }

        // Der Rückruf kommt auf dem Hauptthread; `nonisolated` wie in `Standortdienst`, damit die
        // Konformanz unabhängig davon baut, ob das SDK das Protokoll an den Main Actor bindet.
        nonisolated func eventEditViewController(
            _ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction
        ) {
            let datei = self.datei
            MainActor.assumeIsolated {
                controller.dismiss(animated: true)
            }
            Kalenderdialog.raeumeWeg(datei)
        }
    }
}
