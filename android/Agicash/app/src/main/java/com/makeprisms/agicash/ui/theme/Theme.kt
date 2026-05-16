package com.makeprisms.agicash.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Material 3 palette mirroring the web app's Tailwind tokens. Pulled by hand
 * from `app/tailwind.css` HSL values to RGB; the iOS scaffold uses the same
 * source so the brands stay in sync.
 *
 *   --primary           hsl(20 90% 48%)   -> #E96518
 *   --primary-fg        hsl(0 0% 100%)    -> #FFFFFF
 *   --background        hsl(0 0% 100%)    -> #FFFFFF
 *   --foreground        hsl(20 14% 10%)   -> #1D1816
 *   --card              hsl(0 0% 100%)    -> #FFFFFF
 *   --muted             hsl(60 5% 96%)    -> #F5F5F4
 *   --muted-fg          hsl(25 5% 45%)    -> #78716C
 *   --border            hsl(20 6% 90%)    -> #E7E5E4
 *   --destructive       hsl(0 84% 60%)    -> #EF4444
 */
private val BrandOrange = Color(0xFFE96518)
private val BrandOrangeOn = Color(0xFFFFFFFF)
private val BackgroundLight = Color(0xFFFFFFFF)
private val ForegroundLight = Color(0xFF1D1816)
private val CardLight = Color(0xFFFFFFFF)
private val MutedLight = Color(0xFFF5F5F4)
private val MutedFgLight = Color(0xFF78716C)
private val BorderLight = Color(0xFFE7E5E4)
private val Destructive = Color(0xFFEF4444)

private val BackgroundDark = Color(0xFF1D1816)
private val ForegroundDark = Color(0xFFFAFAF9)
private val CardDark = Color(0xFF26221F)
private val MutedDark = Color(0xFF2D2825)
private val MutedFgDark = Color(0xFFA8A29E)
private val BorderDark = Color(0xFF3F3935)

private val LightColors = lightColorScheme(
    primary = BrandOrange,
    onPrimary = BrandOrangeOn,
    secondary = ForegroundLight,
    onSecondary = BackgroundLight,
    background = BackgroundLight,
    onBackground = ForegroundLight,
    surface = CardLight,
    onSurface = ForegroundLight,
    surfaceVariant = MutedLight,
    onSurfaceVariant = MutedFgLight,
    outline = BorderLight,
    error = Destructive,
    onError = BrandOrangeOn,
)

private val DarkColors = darkColorScheme(
    primary = BrandOrange,
    onPrimary = BrandOrangeOn,
    secondary = ForegroundDark,
    onSecondary = BackgroundDark,
    background = BackgroundDark,
    onBackground = ForegroundDark,
    surface = CardDark,
    onSurface = ForegroundDark,
    surfaceVariant = MutedDark,
    onSurfaceVariant = MutedFgDark,
    outline = BorderDark,
    error = Destructive,
    onError = BrandOrangeOn,
)

@Composable
fun AgicashTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // We intentionally do NOT use dynamicColor (the user's Material You
    // accent) so the brand orange stays consistent across devices.
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = AgicashTypography,
        content = content,
    )
}
