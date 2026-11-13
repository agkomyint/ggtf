//! Runs the scenario matrix and writes bench/results.md and bench/results.json.
//! Table 1: every profile on the mid band. Table 2: every band with the specter profile.
//! Each cell shows classic vs ML decoder success rate.
//! Usage: cargo run --release -p ggtf-core --example bench -- [frames] [payload_bytes]

use ggtf_core::bench::{self, BenchResult, Scenario};
use ggtf_core::ml::{self, Decoder};
use ggtf_core::profile::{Band, ProfileId};
use std::fmt::Write;
use std::sync::Mutex;

#[derive(Clone)]
struct Cell {
    sc: usize,
    id: ProfileId,
    band: Band,
    dec: Decoder,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let frames: u32 = args.get(1).and_then(|v| v.parse().ok()).unwrap_or(30);
    let payload: usize = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(32);
    let scenarios = bench::scenarios();
    let decoders: Vec<Decoder> = if ml::model_available() { vec![Decoder::Classic, Decoder::Ml] } else { vec![Decoder::Classic] };

    let mut cells = Vec::new();
    for sc in 0..scenarios.len() {
        for &dec in &decoders {
            for id in ProfileId::ALL {
                cells.push(Cell { sc, id, band: Band::Mid, dec });
            }
            for band in [Band::Low, Band::High] {
                cells.push(Cell { sc, id: ProfileId::Specter, band, dec });
            }
        }
    }
    let results: Mutex<Vec<(Cell, BenchResult)>> = Mutex::new(Vec::new());
    let next = Mutex::new(0usize);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    eprintln!("{} cells, {} frames each, {} threads, ML model: {}", cells.len(), frames, threads, ml::model_available());
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = {
                    let mut n = next.lock().unwrap();
                    let i = *n;
                    *n += 1;
                    i
                };
                let Some(c) = cells.get(i) else { break };
                let r = bench::run(&scenarios[c.sc], c.id, c.band, c.dec, frames, payload, 42);
                results.lock().unwrap().push((c.clone(), r));
            });
        }
    });
    let results = results.into_inner().unwrap();
    let get = |sc: usize, id: ProfileId, band: Band, dec: Decoder| -> Option<&BenchResult> {
        results.iter().find(|(c, _)| c.sc == sc && c.id == id && c.band == band && c.dec == dec).map(|(_, r)| r)
    };
    let cell = |sc: usize, id: ProfileId, band: Band| -> String {
        let c = get(sc, id, band, Decoder::Classic).map(|r| r.success_rate()).unwrap_or(0.0);
        match get(sc, id, band, Decoder::Ml) {
            Some(m) => {
                let m = m.success_rate();
                let mark = if m > c + 0.001 { " ▲" } else if m + 0.001 < c { " ▼" } else { "" };
                format!("{:.0}% / {:.0}%{}", c * 100.0, m * 100.0, mark)
            }
            None => format!("{:.0}%", c * 100.0),
        }
    };

    let mut md = String::new();
    writeln!(md, "# GGTF benchmark\n").unwrap();
    writeln!(md, "{frames} frames per cell, {payload}-byte payloads, fixed seeds, simulated rooms (SNR is full-band).").unwrap();
    if decoders.len() == 2 {
        writeln!(md, "Cells are **classic / ML** frame success rates. ▲ = ML better, ▼ = ML worse.\n").unwrap();
    } else {
        writeln!(md, "No ML model bundled: classic decoder only.\n").unwrap();
    }
    let header = |md: &mut String, cols: &[String]| {
        write!(md, "| Room | Tier |").unwrap();
        for c in cols {
            write!(md, " {c} |").unwrap();
        }
        writeln!(md).unwrap();
        writeln!(md, "|---|---|{}", "---|".repeat(cols.len())).unwrap();
    };
    let row_tail = |md: &mut String, sc: &Scenario| write!(md, "| {} | {} |", sc.name, sc.tier).unwrap();

    writeln!(md, "## Speed profiles (mid band, 1.5–5.1 kHz)\n").unwrap();
    header(&mut md, &ProfileId::ALL.iter().map(|p| p.name().to_string()).collect::<Vec<_>>());
    for (i, sc) in scenarios.iter().enumerate() {
        row_tail(&mut md, sc);
        for id in ProfileId::ALL {
            write!(md, " {} |", cell(i, id, Band::Mid)).unwrap();
        }
        writeln!(md).unwrap();
    }
    writeln!(md, "\n## Frequency bands (specter profile)\n").unwrap();
    header(&mut md, &Band::ALL.iter().map(|b| format!("{} ({:.1}–{:.1} kHz)", b.name(), b.base_hz() / 1000.0, (b.base_hz() + 3600.0) / 1000.0)).collect::<Vec<_>>());
    for (i, sc) in scenarios.iter().enumerate() {
        row_tail(&mut md, sc);
        for band in Band::ALL {
            write!(md, " {} |", cell(i, ProfileId::Specter, band)).unwrap();
        }
        writeln!(md).unwrap();
    }

    let mut totals = String::new();
    for &dec in &decoders {
        let (ok, n): (u32, u32) = results.iter().filter(|(c, _)| c.dec == dec).fold((0, 0), |a, (_, r)| (a.0 + r.ok, a.1 + r.frames));
        let hard: (u32, u32) = results.iter().filter(|(c, _)| c.dec == dec && scenarios[c.sc].tier != "easy").fold((0, 0), |a, (_, r)| (a.0 + r.ok, a.1 + r.frames));
        writeln!(totals, "- **{}**: {ok}/{n} frames overall ({:.1}%), hard + brutal rooms {}/{} ({:.1}%)", dec.name(), 100.0 * ok as f64 / n.max(1) as f64, hard.0, hard.1, 100.0 * hard.0 as f64 / hard.1.max(1) as f64).unwrap();
    }
    let corrupted: u32 = results.iter().map(|(_, r)| r.corrupted).sum();
    writeln!(md, "\n## Totals\n\n{totals}- Silently corrupted frames accepted: **{corrupted}** (must be 0).").unwrap();

    let json: Vec<String> = results
        .iter()
        .map(|(c, r)| {
            format!(
                "{{\"scenario\":\"{}\",\"tier\":\"{}\",\"profile\":\"{}\",\"band\":\"{}\",\"decoder\":\"{}\",\"frames\":{},\"ok\":{},\"missed\":{},\"marker_fail\":{},\"header_fail\":{},\"payload_fail\":{},\"corrupted\":{},\"goodput_bps\":{:.1}}}",
                scenarios[c.sc].key, scenarios[c.sc].tier, c.id.name(), c.band.name(), c.dec.name(), r.frames, r.ok, r.missed, r.marker_fail, r.header_fail, r.payload_fail, r.corrupted, r.goodput_bps
            )
        })
        .collect();
    std::fs::create_dir_all("bench").unwrap();
    std::fs::write("bench/results.md", &md).unwrap();
    std::fs::write("bench/results.json", format!("[\n{}\n]\n", json.join(",\n"))).unwrap();
    println!("{md}");
}
