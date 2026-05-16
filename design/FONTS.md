# Fonts — Bundling Guide

## What the web app uses

Two Google Fonts families, loaded at runtime from the Google Fonts CDN:

| Family | Role | Weights used | CSS var | Source |
|--------|------|--------------|---------|--------|
| **Kode Mono** | All UI text (primary) | 400, 500, 600, 700 | `--font-primary` | `app/root.tsx:56-58` |
| **Teko** | All monetary amounts (numeric) | 300, 400, 500, 600, 700 | `--font-numeric` | `app/root.tsx:56-58` |

**Exact stylesheet URL** (single request, both families):
```
https://fonts.googleapis.com/css2?family=Kode+Mono:wght@400..700&family=Teko:wght@300..700&display=swap
```

There are **no bundled font files** in the repo (verified by globbing `app/` for `.woff*`, `.ttf`, `.otf`).

Fallbacks declared in `app/tailwind.css` lines 122-123:
- Kode Mono falls back to `monospace`
- Teko falls back to `sans-serif`

## iOS bundling instructions

1. **Download the TTF files**:
   - Kode Mono: https://fonts.google.com/specimen/Kode+Mono → "Get font" → "Download all"
   - Teko: https://fonts.google.com/specimen/Teko → "Get font" → "Download all"
2. **Pick the static TTFs** (not the variable font; iOS Info.plist registration works most reliably with static TTFs):
   - `KodeMono-Regular.ttf` (400), `KodeMono-Medium.ttf` (500), `KodeMono-SemiBold.ttf` (600), `KodeMono-Bold.ttf` (700)
   - `Teko-Light.ttf` (300), `Teko-Regular.ttf` (400), `Teko-Medium.ttf` (500), `Teko-SemiBold.ttf` (600), `Teko-Bold.ttf` (700)
3. **Copy into the iOS project**:
   ```
   ios/Agicash/Agicash/Fonts/
     KodeMono-Regular.ttf
     KodeMono-Medium.ttf
     KodeMono-SemiBold.ttf
     KodeMono-Bold.ttf
     Teko-Light.ttf
     Teko-Regular.ttf
     Teko-Medium.ttf
     Teko-SemiBold.ttf
     Teko-Bold.ttf
   ```
4. **Register in `Info.plist`** under `UIAppFonts` (array of relative paths):
   ```xml
   <key>UIAppFonts</key>
   <array>
     <string>Fonts/KodeMono-Regular.ttf</string>
     <string>Fonts/KodeMono-Medium.ttf</string>
     <string>Fonts/KodeMono-SemiBold.ttf</string>
     <string>Fonts/KodeMono-Bold.ttf</string>
     <string>Fonts/Teko-Light.ttf</string>
     <string>Fonts/Teko-Regular.ttf</string>
     <string>Fonts/Teko-Medium.ttf</string>
     <string>Fonts/Teko-SemiBold.ttf</string>
     <string>Fonts/Teko-Bold.ttf</string>
   </array>
   ```
5. **Add to the Xcode target's Copy Bundle Resources** build phase.
6. **PostScript names** (use these in `Font.custom(...)`, not file names):
   - `KodeMono-Regular`, `KodeMono-Medium`, `KodeMono-SemiBold`, `KodeMono-Bold`
   - `Teko-Light`, `Teko-Regular`, `Teko-Medium`, `Teko-SemiBold`, `Teko-Bold`
7. **License**: Both fonts are OFL (SIL Open Font License 1.1) — free for embedding in apps, including commercial use. Bundle the `OFL.txt` from the Google download in the app's licensing/credits screen.

## Android bundling instructions

1. **Download static TTFs** (same as iOS step 1-2 above).
2. **Copy into `res/font/`** with snake-case names (Android resource naming rule — no caps, no hyphens):
   ```
   android/app/src/main/res/font/
     kode_mono_regular.ttf
     kode_mono_medium.ttf
     kode_mono_semibold.ttf
     kode_mono_bold.ttf
     teko_light.ttf
     teko_regular.ttf
     teko_medium.ttf
     teko_semibold.ttf
     teko_bold.ttf
   ```
3. **Optionally** create a `font-family` XML for each family at `res/font/kode_mono.xml`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <font-family xmlns:app="http://schemas.android.com/apk/res-auto">
     <font app:fontStyle="normal" app:fontWeight="400" app:font="@font/kode_mono_regular" />
     <font app:fontStyle="normal" app:fontWeight="500" app:font="@font/kode_mono_medium" />
     <font app:fontStyle="normal" app:fontWeight="600" app:font="@font/kode_mono_semibold" />
     <font app:fontStyle="normal" app:fontWeight="700" app:font="@font/kode_mono_bold" />
   </font-family>
   ```
   This lets Compose pick the right weight automatically. Same pattern for `teko.xml`.
4. **License**: Same OFL note as iOS — surface license text in the about/credits screen.

## Why not "system fonts"

Both families are **deliberate brand choices**:
- **Teko** is a tall, condensed sans-serif used at large sizes for currency amounts (see `MoneyDisplay` `text-6xl` / 60px). Substituting the system font (San Francisco / Roboto) would visibly change the brand at the most prominent moment in the UI.
- **Kode Mono** is a square-ish monospace giving Agicash its slightly technical, crypto-adjacent feel. The system monospace (Menlo on iOS, Roboto Mono on Android) is taller and narrower — not equivalent.

The operator directive ("make sure we use the same fonts and themes") forecloses falling back to system fonts as the default. Bundle them.

## Why not download at runtime (Android `downloadable-font`)

Two reasons:
1. **Cold-start jank**: the first paint would either flash a fallback or block on the network. The web app uses `display=swap` to allow the flash; native apps tend to feel broken when text reflows after launch.
2. **Offline**: Agicash is a wallet — the user may be in an airport with bad connectivity. Bundled fonts work offline.

## License redistribution

Both Kode Mono and Teko are released under the **SIL Open Font License 1.1**. Redistribution inside an app is explicitly allowed. The OFL only requires:
- The license text travels with the font files (include `OFL.txt` in the app bundle or in an "Open Source Licenses" screen).
- The fonts are not sold by themselves (irrelevant for our use case).
- Modified versions can't reuse the reserved family names — we are not modifying the fonts.
