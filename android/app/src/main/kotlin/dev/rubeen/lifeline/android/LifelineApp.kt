package dev.rubeen.lifeline.android

import android.app.Application
import dev.rubeen.lifeline.android.update.Updater
import dev.rubeen.lifeline.android.web.SystemWebviewFabrik
import dev.rubeen.lifeline.android.web.WebviewFabrik

/**
 * Anwendung der Android-Hülle (LLH-1989). Hält die WebView-Fabrik und den [Updater], damit die
 * Tests Attrappen einsetzen können (Robolectric kennt keine WebView-Profile). Den Updater teilen
 * sich Activity, Hintergrundarbeit und Empfänger; er entsteht beim ersten Zugriff und setzt dabei
 * den Kanal (Entwurf D9).
 */
class LifelineApp : Application() {
    var webviewFabrik: WebviewFabrik = SystemWebviewFabrik

    /**
     * Steht die Oberfläche vorn (`ON_START` bis `ON_STOP` der Activity)? Die Hintergrundarbeit des
     * Updaters fragt es, bevor sie installiert (Review K1).
     */
    @Volatile
    var imVordergrund: Boolean = false

    private var eigenerUpdater: Updater? = null

    /** Einer für alle: Hintergrundarbeit (eigener Faden) und Activity dürfen gleichzeitig fragen (Review K4). */
    var updater: Updater
        get() = synchronized(this) { eigenerUpdater ?: Updater(this).also { eigenerUpdater = it } }
        set(wert) {
            synchronized(this) { eigenerUpdater = wert }
        }
}
