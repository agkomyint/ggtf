//! Runs the scenario matrix for every profile and writes bench/results.md and bench/results.json.
//! Usage: cargo run --release -p ggtf-core --example bench -- [frames] [payload_bytes]

use ggtf_core::bench;
use ggtf_core::profile::ProfileId;
use std::fmt::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let frames: u32 = args.get(1).and_then(|v| v.parse().ok()).unwrap_or(30);
    let payload: usize = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(32);

    let mut md = String::new();
    let mut json = Vec::new();
    writeln!(md, "# GGTF benchmark (classic decoder)\n").unwrap();
    writeln!(md, "{frames} frames per cell, {payload}-byte payloads, fixed seeds. Simulated channel; SNR is full-band.\n").unwrap();
    writeln!(md, "Cells show frame success rate and goodput (bits/s of payload after decoding).\n").unwrap();
    let ids = ProfileId::ALL;
    write!(md, "| Scenario |").unwrap();
    for id in ids {
        write!(md, " {} |", id.name()).unwrap();
    }
    writeln!(md).unwrap();
    writeln!(md, "|---|{}", "---|".repeat(ids.len())).unwrap();
    let mut corrupted = 0;
    for sc in bench::scenarios() {
        write!(md, "| {} |", sc.name).unwrap();
        for id in ids {
            let r = bench::run(&sc, id, frames, payload, 42);
            corrupted += r.corrupted;
            write!(md, " {:.0}% · {:.0} bps |", r.success_rate() * 100.0, r.goodput_bps).unwrap();
            json.push(format!(
                "{{\"scenario\":\"{}\",\"profile\":\"{}\",\"frames\":{},\"ok\":{},\"missed\":{},\"marker_fail\":{},\"header_fail\":{},\"payload_fail\":{},\"corrupted\":{},\"goodput_bps\":{:.1},\"mean_snr_db\":{:.1}}}",
                sc.key, id.name(), r.frames, r.ok, r.missed, r.marker_fail, r.header_fail, r.payload_fail, r.corrupted, r.goodput_bps, r.mean_snr_db
            ));
            eprintln!("{:<40} {:<8} {:>3}/{}", sc.name, id.name(), r.ok, r.frames);
        }
        writeln!(md).unwrap();
    }
    writeln!(md, "\nSilently corrupted frames across all runs: **{corrupted}** (must be 0).").unwrap();
    std::fs::create_dir_all("bench").unwrap();
    std::fs::write("bench/results.md", md).unwrap();
    std::fs::write("bench/results.json", format!("[\n{}\n]\n", json.join(",\n"))).unwrap();
    println!("wrote bench/results.md and bench/results.json");
}
