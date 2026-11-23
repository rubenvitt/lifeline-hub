import WebKit

/// Fährt WebKit einmal je Testprozess hoch, bevor der erste Test einen Webview braucht (LLH-2073).
///
/// Die App-Tests laufen auf einem frisch gebooteten Simulator: scripts/ios/simulator-pruefung.sh
/// fährt ihn nach dem Eintragen der Test-CA wieder herunter. Der erste Webview startet dann
/// GPU-, Networking- und WebContent-Prozess. Im CI dauerte das 5 bis 10 s je Prozess, und der
/// WebContent-Prozess meldete sich zwischendurch als „unresponsive“ (Läufe 45198079874,
/// 45203095862, 45204564216). Gescheitert ist dadurch der jeweils erste Webview-Test einer Klasse,
/// nicht an dem, was er prüft: der Blob-Download in `LinkTests` und das Laden vom Testserver in
/// `OhneServerTests`. Diesen Kaltstart fängt hier ein eigener Webview ohne den Datenspeicher eines
/// Servers ab, samt einem `blob:`-Abruf, der über den Networking-Prozess geht.
///
/// Scheitert der Vorlauf, schlägt er selbst nicht fehl: dann scheitern die Tests danach mit ihrer
/// eigenen Meldung, und das Protokoll nennt die Dauer des Vorlaufs.
@MainActor
enum WebkitVorlauf {
    /// Höchstens so lange wartet der Vorlauf; im CI kam der erste Webinhalt schon nach über 80 s
    /// (Lauf 44427089802).
    static let frist: Duration = .seconds(120)

    private static var begonnen = false

    /// Beim ersten Aufruf je Prozess: WebKit hochfahren. Jeder weitere kehrt sofort zurück, auch
    /// nach einem gescheiterten Vorlauf, damit nicht jeder Test erneut zwei Minuten wartet.
    static func sicherstellen() async {
        guard !begonnen else { return }
        begonnen = true
        let konfiguration = WKWebViewConfiguration()
        konfiguration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: konfiguration)
        defer { web.stopLoading() }
        web.loadHTMLString(
            "<!doctype html><html><body><p id='bereit'>bereit</p></body></html>",
            baseURL: URL(string: "https://vorlauf.invalid/"))
        let beginn = ContinuousClock.now
        while ContinuousClock.now - beginn < frist {
            let wert = try? await web.callAsyncJavaScript(
                """
                if (!document.getElementById('bereit')) return false;
                const adresse = URL.createObjectURL(new Blob(['x'], { type: 'text/plain' }));
                const text = await (await fetch(adresse)).text();
                URL.revokeObjectURL(adresse);
                return text === 'x';
                """,
                contentWorld: .page)
            if (wert as? Bool) == true {
                print("WebKit-Vorlauf: bereit nach \(ContinuousClock.now - beginn)")
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        print("WebKit-Vorlauf: nach \(frist) nicht bereit; die folgenden Webview-Tests laufen kalt")
    }
}
