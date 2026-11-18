import Foundation

/// Stil, den die Hülle in jede Seite des Hauptframes einspielt (Entwurf D6, tasks.md 8.10): lange
/// Berührung zeigt außerhalb von Eingaben weder Lupe noch Textmenü. Eingaben, Textfelder und
/// bearbeitbare Bereiche bleiben auswählbar. Der Stil gehört in die Hülle, nicht ins
/// Frontend-CSS: im Browser bleibt Text auswählbar, und ältere Server bekommen ihn auch.
public enum Huellenstil {
    /// `id` des eingespielten `<style>`.
    public static let kennung = "lifeline-huelle-stil"

    /// Auf jedem Element, nicht nur auf `body`: ob die Eigenschaften erben, hängt vom Browser ab.
    /// Die Ausnahmen gewinnen über die Spezifität des Elementselektors gegenüber `*`.
    public static let css = """
        * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
        input, textarea, select, [contenteditable]:not([contenteditable="false"]), \
        [contenteditable]:not([contenteditable="false"]) * \
        { -webkit-touch-callout: default; -webkit-user-select: text; user-select: text; }
        """

    /// Läuft als eigenes `WKUserScript` zu Dokumentbeginn im Hauptframe. Fehlt `<html>` noch,
    /// hängt es den Stil bei `DOMContentLoaded` an; ein zweiter Lauf fügt nichts doppelt ein.
    public static var skript: String {
        "(() => { const einfuegen = () => { if (document.getElementById(\(Anmeldung.literal(kennung)))) "
            + "return; const stil = document.createElement('style'); stil.id = "
            + "\(Anmeldung.literal(kennung)); stil.textContent = \(Anmeldung.literal(css)); "
            + "(document.head || document.documentElement).appendChild(stil); }; "
            + "if (document.documentElement) einfuegen(); "
            + "else document.addEventListener('DOMContentLoaded', einfuegen, { once: true }); })();"
    }
}

extension Testzustand {
    /// Seite des Testzustands `web`: lädt die App ohne Netz unter der Adresse des Beispielservers.
    /// Lang genug zum Ziehen, mit Text für die lange Berührung und einem Eingabefeld.
    public static let beispielseite = """
        <!doctype html>
        <html lang="de"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Lifeline</title>
        <style>
        body { margin: 0; font: 17px -apple-system, sans-serif; background: #f4f4f5; color: #18181b; }
        header { background: #18181b; color: #fafafa; padding: 12px 16px; font-weight: 600; }
        main { padding: 16px; }
        p { line-height: 1.5; }
        input { width: 100%; box-sizing: border-box; padding: 10px; font-size: 17px; }
        </style></head>
        <body>
        <header id="kopf">ELW 1 · Einsatztagebuch</header>
        <main>
        <p id="text">Lange Berührung auf diesem Text zeigt weder Lupe noch Textmenü.</p>
        <label>Eintrag <input id="eingabe" value="Eingaben bleiben auswählbar"></label>
        <p>Die Seite federt am Rand nicht nach und lädt beim Ziehen nicht neu.</p>
        </main>
        </body></html>
        """
}
