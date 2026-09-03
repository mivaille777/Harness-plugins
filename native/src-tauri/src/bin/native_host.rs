fn main() {
    if let Err(error) = dsh_selection_companion_native::native_messaging::run_stdio() {
        eprintln!("dsh selection companion native host failed: {error}");
        std::process::exit(1);
    }
}
