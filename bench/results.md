# GGTF benchmark

20 frames per cell, 32-byte payloads, fixed seeds, simulated rooms (SNR is full-band).
Cells are **classic / ML** frame success rates. ▲ = ML better, ▼ = ML worse.

## Speed profiles (mid band, 1.5–5.1 kHz)

| Room | Tier | wraith | specter | banshee | poltergeist |
|---|---|---|---|---|---|
| Clean room | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, 10 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, 0 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| People talking, 5 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Music, 5 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Echoey room (RT60 300 ms) | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Cut-outs (2 × 80 ms) | easy | 100% / 100% | 100% / 100% | 100% / 100% | 80% / 80% |
| Clock drift 200 ppm | easy | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, -6 dB | hard | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, -10 dB | hard | 100% / 100% | 100% / 100% | 100% / 100% | 5% / 5% |
| Loud talking, -5 dB | hard | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Loud music, -5 dB | hard | 100% / 100% | 100% / 100% | 95% / 100% ▲ | 95% / 100% ▲ |
| Notification beeps, 5 dB | hard | 90% / 90% | 90% / 100% ▲ | 30% / 100% ▲ | 50% / 100% ▲ |
| Big hall (RT60 800 ms) | hard | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 0% |
| Door slams (3 × 120 ms) | hard | 100% / 100% | 100% / 100% | 100% / 100% | 75% / 80% ▲ |
| Phone speaker (300 Hz–7 kHz) | hard | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Mic roll-off above 15 kHz | hard | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Café (talk + music + echo + drift) | hard | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, -14 dB | brutal | 100% / 100% | 95% / 95% | 0% / 0% | 0% / 0% |
| Beeps, 0 dB | brutal | 85% / 85% | 55% / 95% ▲ | 10% / 60% ▲ | 35% / 55% ▲ |
| Everything (café + beeps + cut-outs) | brutal | 100% / 100% | 100% / 100% | 85% / 95% ▲ | 35% / 40% ▲ |

## Frequency bands (specter profile)

| Room | Tier | low (0.5–4.1 kHz) | mid (1.5–5.1 kHz) | high (14.5–18.1 kHz) |
|---|---|---|---|---|
| Clean room | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, 10 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, 0 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| People talking, 5 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Music, 5 dB | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Echoey room (RT60 300 ms) | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Cut-outs (2 × 80 ms) | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Clock drift 200 ppm | easy | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, -6 dB | hard | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, -10 dB | hard | 100% / 100% | 100% / 100% | 100% / 100% |
| Loud talking, -5 dB | hard | 95% / 100% ▲ | 100% / 100% | 100% / 100% |
| Loud music, -5 dB | hard | 0% / 70% ▲ | 100% / 100% | 100% / 100% |
| Notification beeps, 5 dB | hard | 95% / 100% ▲ | 90% / 100% ▲ | 100% / 100% |
| Big hall (RT60 800 ms) | hard | 0% / 0% | 0% / 0% | 0% / 0% |
| Door slams (3 × 120 ms) | hard | 100% / 100% | 100% / 100% | 100% / 100% |
| Phone speaker (300 Hz–7 kHz) | hard | 100% / 100% | 100% / 100% | 0% / 0% |
| Mic roll-off above 15 kHz | hard | 100% / 100% | 100% / 100% | 100% / 100% |
| Café (talk + music + echo + drift) | hard | 100% / 100% | 100% / 100% | 100% / 100% |
| Hiss, -14 dB | brutal | 100% / 100% | 95% / 95% | 85% / 85% |
| Beeps, 0 dB | brutal | 65% / 100% ▲ | 55% / 95% ▲ | 100% / 100% |
| Everything (café + beeps + cut-outs) | brutal | 100% / 100% | 100% / 100% | 100% / 100% |

## Totals

- **classic**: 2190/2520 frames overall (86.9%), hard + brutal rooms 1234/1560 (79.1%)
- **ml**: 2267/2520 frames overall (90.0%), hard + brutal rooms 1311/1560 (84.0%)
- Silently corrupted frames accepted: **0** (must be 0).
