//! Modem profiles: named sets of MFSK parameters, from slowest/most robust to fastest.

use crate::SR;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ProfileId {
    Wraith = 0,
    Specter = 1,
    Banshee = 2,
}

impl ProfileId {
    /// Ordered slowest to fastest.
    pub const ALL: [ProfileId; 3] = [ProfileId::Wraith, ProfileId::Specter, ProfileId::Banshee];

    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Wraith),
            1 => Some(Self::Specter),
            2 => Some(Self::Banshee),
            _ => None,
        }
    }

    pub fn profile(self) -> &'static Profile {
        match self {
            Self::Wraith => &WRAITH,
            Self::Specter => &SPECTER,
            Self::Banshee => &BANSHEE,
        }
    }

    pub fn name(self) -> &'static str {
        self.profile().name
    }

    pub fn slower(self) -> Option<Self> {
        match self {
            Self::Wraith => None,
            Self::Specter => Some(Self::Wraith),
            Self::Banshee => Some(Self::Specter),
        }
    }
}

/// MFSK parameters. Each symbol carries one 4-bit tone index per group; groups sit in
/// separate sub-bands and play at the same time.
///
/// A symbol is `guard + window` samples. The receiver analyses `window` samples starting at
/// `analysis_offset`, so echoes shorter than the guard don't leak into the analysis window
/// (the same idea as an OFDM cyclic prefix). Tones sit on exact DFT bins of the window.
#[derive(Debug)]
pub struct Profile {
    pub id: ProfileId,
    pub name: &'static str,
    pub tones: usize,
    pub groups: usize,
    pub window: usize,
    pub guard: usize,
    pub base_hz: f32,
    pub spacing_hz: f32,
    /// Reed-Solomon parity bytes for the payload codeword.
    pub parity: usize,
}

impl Profile {
    pub fn symbol_len(&self) -> usize {
        self.guard + self.window
    }

    /// Crossfade length between consecutive symbols.
    pub fn ramp(&self) -> usize {
        self.guard / 4
    }

    pub fn analysis_offset(&self) -> usize {
        (self.guard + self.ramp()) / 2
    }

    pub fn tone_hz(&self, group: usize, tone: usize) -> f32 {
        self.base_hz + (group * self.tones + tone) as f32 * self.spacing_hz
    }

    pub fn top_hz(&self) -> f32 {
        self.tone_hz(self.groups - 1, self.tones - 1)
    }

    pub fn symbols_for_bytes(&self, bytes: usize) -> usize {
        (2 * bytes).div_ceil(self.groups)
    }

    pub fn raw_bps(&self) -> f32 {
        (self.groups * 4) as f32 * SR / self.symbol_len() as f32
    }
}

pub static WRAITH: Profile = Profile {
    id: ProfileId::Wraith,
    name: "wraith",
    tones: 16,
    groups: 2,
    window: 1920,
    guard: 480,
    base_hz: 1800.0,
    spacing_hz: 50.0,
    parity: 24,
};

pub static SPECTER: Profile = Profile {
    id: ProfileId::Specter,
    name: "specter",
    tones: 16,
    groups: 2,
    window: 960,
    guard: 480,
    base_hz: 1500.0,
    spacing_hz: 100.0,
    parity: 16,
};

pub static BANSHEE: Profile = Profile {
    id: ProfileId::Banshee,
    name: "banshee",
    tones: 16,
    groups: 2,
    window: 480,
    guard: 240,
    base_hz: 1500.0,
    spacing_hz: 100.0,
    parity: 12,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tones_sit_on_dft_bins() {
        for id in ProfileId::ALL {
            let p = id.profile();
            let bin = SR / p.window as f32;
            for g in 0..p.groups {
                for t in 0..p.tones {
                    let k = p.tone_hz(g, t) / bin;
                    assert!((k - k.round()).abs() < 1e-3, "{} tone not on a bin", p.name);
                }
            }
            assert!(p.top_hz() < 5000.0);
            assert!(p.analysis_offset() >= p.ramp());
            assert!(p.analysis_offset() + p.window <= p.symbol_len());
        }
    }
}
