// Wurzel des Android-Builds: keine eigenen Aufgaben. Die Plugins der App stehen hier nur, damit
// sie einmal in einem Klassenlader liegen; der Kern trägt seine eigenen (`android/kern`).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.roborazzi) apply false
}
