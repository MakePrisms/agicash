//! Build the multi-language UniFFI bindgen CLI. Used by the Kotlin generate
//! script (`bindings/kotlin/generate-bindings.sh`) with `--language kotlin`.

fn main() {
    uniffi::uniffi_bindgen_main()
}
