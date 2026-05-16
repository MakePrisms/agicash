# Add project specific ProGuard rules here.
# UniFFI's generated Kotlin code uses JNA reflection — keep the bindings package.
-keep class uniffi.** { *; }
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { *; }
-dontwarn java.awt.**
-dontwarn javax.swing.**
