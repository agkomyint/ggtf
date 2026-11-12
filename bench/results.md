# GGTF benchmark (classic decoder)

20 frames per cell, 32-byte payloads, fixed seeds. Simulated channel; SNR is full-band.

Cells show frame success rate and goodput (bits/s of payload after decoding).

| Scenario | wraith | specter | banshee |
|---|---|---|---|
| Clean room | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Hiss, 10 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Hiss, 0 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Hiss, -6 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| People talking, 5 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| People talking, 0 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Music, 5 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Music, 0 dB | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Notification beeps, 5 dB | 100% · 61 bps | 90% · 98 bps | 35% · 72 bps |
| Echoey room (RT60 300 ms) | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Cut-outs (2 x 80 ms) | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Door slams (2 x 100 ms) | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Clock drift 200 ppm | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |
| Cafe (talk + music + echo + drift) | 100% · 61 bps | 100% · 108 bps | 100% · 207 bps |

Silently corrupted frames across all runs: **0** (must be 0).
