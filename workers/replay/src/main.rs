use std::io::{self, Read, Write};

fn main() {
    let mut input = String::new();
    let output = match io::stdin().read_to_string(&mut input) {
        Ok(_) => holecard_replay::run_json(&input),
        Err(e) => holecard_replay::error_json("", &format!("STDIN: {e}")),
    };
    print!("{output}");
    let _ = io::stdout().flush();
}
