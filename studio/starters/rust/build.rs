//! Turns film.json (size, fps, length) and params.json (the panel's values)
//! into constants for the film, in $OUT_DIR/film.rs:
//!
//!   WIDTH, HEIGHT    the frame in pixels: twice the film's size, so a
//!                    render is 4K and `render --draft` (half) is the film's own
//!   VIEW_W, VIEW_H   the film's own size, the units everything is drawn in
//!   FPS, DURATION
//!   P_<KEY>          one per param: f32 for numbers, &str for text, colours
//!                    and choices, bool for toggles
//!
//! The studio writes params.json from film.json before every build, so
//! changing a value in the panel rebuilds the film (in a few seconds).
use serde_json::Value;
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=film.json");
    println!("cargo:rerun-if-changed=params.json");
    let film: Value = serde_json::from_str(&fs::read_to_string("film.json").expect("film.json")).expect("film.json is JSON");
    let num = |k: &str, d: f64| film.get(k).and_then(Value::as_f64).unwrap_or(d);
    let (w, h) = (num("width", 1920.), num("height", 1080.));

    // params.json is { key: value }; without it, film.json's own values.
    let values: serde_json::Map<String, Value> = fs::read_to_string("params.json")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let mut out = format!(
        "pub const WIDTH: usize = {};\npub const HEIGHT: usize = {};\npub const VIEW_W: f32 = {:.1};\npub const VIEW_H: f32 = {:.1};\npub const FPS: usize = {};\npub const DURATION: f32 = {:.4};\n",
        (w * 2.) as usize,
        (h * 2.) as usize,
        w,
        h,
        num("fps", 60.) as usize,
        num("duration", 5.),
    );
    for p in film.get("params").and_then(Value::as_array).into_iter().flatten() {
        let key = p["key"].as_str().unwrap_or_default();
        let name: String = key
            .chars()
            .flat_map(|c| if c.is_uppercase() { vec!['_', c] } else { vec![c.to_ascii_uppercase()] })
            .collect();
        let value = values.get(key).unwrap_or(&p["value"]);
        let line = match p["type"].as_str() {
            Some("number") => format!("pub const P_{name}: f32 = {:?};\n", value.as_f64().unwrap_or(0.) as f32),
            Some("toggle") => format!("pub const P_{name}: bool = {};\n", value.as_bool().unwrap_or(false)),
            _ => format!("pub const P_{name}: &str = {:?};\n", value.as_str().unwrap_or_default()),
        };
        out.push_str(&line);
    }
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("film.rs"), out).unwrap();
}
