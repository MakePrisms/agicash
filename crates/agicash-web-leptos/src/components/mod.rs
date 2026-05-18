//! Reusable view components. Phase 1 partial ships `LoginView` +
//! `CashuTokenPasteView`. The receive-token component is owned by lane L4
//! (`feat/leptos-receive-token`) and is intentionally self-contained so
//! it doesn't conflict with the L3 component-library branch
//! (`feat/leptos-components`) when those land — see the
//! `// TODO: replace with L3 <Card> / <Button>` markers in
//! `cashu_token_paste_view.rs`.

mod cashu_token_paste_view;
mod login_view;

pub use cashu_token_paste_view::CashuTokenPasteView;
pub use login_view::LoginView;
