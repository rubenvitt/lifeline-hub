package dev.rubeen.lifeline.android

import android.app.Application
import dev.rubeen.lifeline.android.web.SystemWebviewFabrik
import dev.rubeen.lifeline.android.web.WebviewFabrik

/**
 * Anwendung der Android-Hülle (LLH-1989). Hält die WebView-Fabrik, damit die Tests eine Attrappe
 * einsetzen können (Robolectric kennt keine WebView-Profile); Kanal und Updater hängen sich hier
 * an, sobald es sie gibt.
 */
class LifelineApp : Application() {
    var webviewFabrik: WebviewFabrik = SystemWebviewFabrik
}
