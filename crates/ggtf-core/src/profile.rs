//! Modem profiles: named sets of MFSK parameters, from slowest/most robust to fastest.

use crate::SR;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ProfileId {
    Wraith = 0,
    Specter = 1,
    Banshee = 2,
    /// Turbo: three tone groups at once. Needs a quiet room.
    Poltergeist = 3,
}

impl ProfileId {
    /// Ordered slowest to fastest.
    pub const ALL: [ProfileId; 4] = [ProfileId::Wraith, ProfileId::Specter, ProfileId::Banshee, ProfileId::Poltergeist];

    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Wraith),
            1 => Some(Self::Specter),
            2 => Some(Self::Banshee),
            3 => Some(Self::Poltergeist),
            _ => None,
        }
    }

    pub fn profile(self) -> &'static Profile {
        match self {
            Self::Wraith => &WRAITH,
            Self::Specter => &SPECTER,
            Self::Banshee => &BANSHEE,
            Self::Poltergeist => &POLTERGEIST,
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
            Self::Poltergeist => Some(Self::Banshee),
        }
    }
}

/// Frequency band. The 2-group profiles span 3.1 kHz above the base; poltergeist spans 4.7 kHz.
/// Every profile keeps its tone layout and is shifted up or down by the band base.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Band {
    /// 500 Hz – 4.1 kHz: warmer, carries through cheap speakers, overlaps speech more.
    Low = 0,
    /// 1.5 – 5.1 kHz: the default, most robust on laptops and phones.
    Mid = 1,
    /// 14.5 – 18.1 kHz: a faint high whine most people barely notice. Some speakers and mics roll off here.
    High = 2,
}

impl Band {
    pub const ALL: [Band; 3] = [Band::Low, Band::Mid, Band::High];

    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Low),
            1 => Some(Self::Mid),
            2 => Some(Self::High),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Mid => "mid",
            Self::High => "high",
        }
    }

    /// Lowest tone frequency; all tone layouts start here.
    pub fn base_hz(self) -> f32 {
        match self {
            Self::Low => 500.0,
            Self::Mid => 1500.0,
            Self::High => 14500.0,
        }
    }

    /// Preamble chirp range.
    pub fn chirp(self) -> (f32, f32) {
        (self.base_hz(), self.base_hz() + 3300.0)
    }

    /// Receiver band-pass range.
    pub fn filter(self) -> (f32, f32) {
        match self {
            Self::Low => (250.0, 5800.0),
            Self::Mid => (1100.0, 6800.0),
            Self::High => (13800.0, 20500.0),
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
    /// Offset of the first tone above the band base.
    pub offset_hz: f32,
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

    pub fn tone_hz(&self, band: Band, group: usize, tone: usize) -> f32 {
        band.base_hz() + self.offset_hz + (group * self.tones + tone) as f32 * self.spacing_hz
    }

    pub fn low_hz(&self, band: Band) -> f32 {
        self.tone_hz(band, 0, 0)
    }

    pub fn top_hz(&self, band: Band) -> f32 {
        self.tone_hz(band, self.groups - 1, self.tones - 1)
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
    offset_hz: 300.0,
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
    offset_hz: 0.0,
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
    offset_hz: 0.0,
    spacing_hz: 100.0,
    parity: 12,
};

pub static POLTERGEIST: Profile = Profile {
    id: ProfileId::Poltergeist,
    name: "poltergeist",
    tones: 16,
    groups: 3,
    window: 480,
    guard: 240,
    offset_hz: 0.0,
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
            for band in Band::ALL {
                for g in 0..p.groups {
                    for t in 0..p.tones {
                        let k = p.tone_hz(band, g, t) / bin;
                        assert!((k - k.round()).abs() < 1e-3, "{} tone not on a bin", p.name);
                    }
                }
                let (lo, hi) = band.filter();
                assert!(p.low_hz(band) > lo && p.top_hz(band) < hi && hi < 24000.0);
            }
            assert!(p.analysis_offset() >= p.ramp());
            assert!(p.analysis_offset() + p.window <= p.symbol_len());
        }
    }
}
