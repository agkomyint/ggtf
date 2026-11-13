//! Checks the embedded model in Rust against the validation set (parity with PyTorch).
//! Usage: cargo run --release -p ggtf-core --example ml_eval -- [data_dir]
use ggtf_core::ml::{self, N_FEATURES, TONES};

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| "ml/data/val".into());
    let xb = std::fs::read(format!("{dir}/x.f32")).expect("x.f32");
    let y = std::fs::read(format!("{dir}/y.u8")).expect("y.u8");
    let m = ml::model().expect("no model bundled (run ml/train.py, then rebuild)");
    let (mut ok_ml, mut ok_classic) = (0usize, 0usize);
    let mut feat = [0f32; N_FEATURES];
    for (i, &label) in y.iter().enumerate() {
        for (j, f) in feat.iter_mut().enumerate() {
            let o = (i * N_FEATURES + j) * 4;
            *f = f32::from_le_bytes([xb[o], xb[o + 1], xb[o + 2], xb[o + 3]]);
        }
        let p = m.predict(&feat);
        let am = |v: &[f32]| v.iter().enumerate().fold((0, f32::MIN), |a, (k, &x)| if x > a.1 { (k, x) } else { a }).0;
        ok_ml += (am(&p) == label as usize) as usize;
        ok_classic += (am(&feat[..TONES]) == label as usize) as usize;
    }
    let n = y.len() as f64;
    println!("rust classic accuracy {:.4}, rust ML accuracy {:.4} on {} symbols", ok_classic as f64 / n, ok_ml as f64 / n, y.len());
}
