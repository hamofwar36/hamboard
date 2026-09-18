fn main() {
    println!("cargo:rerun-if-env-changed=HAMBOARD_GOOGLE_OAUTH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=HAMBOARD_GOOGLE_OAUTH_CLIENT_SECRET");
    tauri_build::build()
}
