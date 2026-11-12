// AudioWorklet: captures the microphone and plays GGTF transmissions.
// Talks straight to the link worker through a MessagePort, so audio never touches the main thread.
// The modem works at 48 kHz; if the device runs at another rate, this resamples both ways.

const TARGET_RATE = 48000;
const CHUNK = 2048;

class GgtfProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Device samples per modem sample.
    this.ratio = sampleRate / TARGET_RATE;
    this.chunk = new Float32Array(CHUNK);
    this.fill = 0;
    this.inPos = 0;
    this.prev = 0;
    this.queue = [];
    this.cur = null;
    this.curPos = 0;
    this.worker = null;
    this.peak = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === "port") {
        this.worker = e.data.port;
        this.worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === "tx") this.queue.push(m.samples);
          else if (m.type === "flush") {
            this.queue = [];
            this.cur = null;
          }
        };
      }
    };
  }

  emit(v) {
    this.chunk[this.fill++] = v;
    const a = v < 0 ? -v : v;
    if (a > this.peak) this.peak = a;
    if (this.fill === CHUNK) {
      if (this.worker) this.worker.postMessage({ type: "rx", samples: this.chunk, peak: this.peak }, [this.chunk.buffer]);
      this.chunk = new Float32Array(CHUNK);
      this.fill = 0;
      this.peak = 0;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      if (this.ratio === 1) {
        for (let i = 0; i < input.length; i++) this.emit(input[i]);
      } else {
        for (let i = 0; i < input.length; i++) {
          const cur = input[i];
          while (this.inPos <= 1) {
            this.emit(this.prev + (cur - this.prev) * this.inPos);
            this.inPos += this.ratio;
          }
          this.inPos -= 1;
          this.prev = cur;
        }
      }
    }

    const out = outputs[0];
    const ch = out && out[0];
    if (ch) {
      const step = 1 / this.ratio;
      for (let i = 0; i < ch.length; i++) {
        if (!this.cur && this.queue.length) {
          this.cur = this.queue.shift();
          this.curPos = 0;
        }
        if (this.cur) {
          const i0 = Math.floor(this.curPos);
          const f = this.curPos - i0;
          const a = this.cur[i0] || 0;
          const b = this.cur[i0 + 1] || 0;
          ch[i] = a + (b - a) * f;
          this.curPos += step;
          if (this.curPos >= this.cur.length) {
            this.cur = null;
            if (this.worker) this.worker.postMessage({ type: "txdone" });
          }
        } else {
          ch[i] = 0;
        }
      }
      for (let c = 1; c < out.length; c++) out[c].set(ch);
    }
    return true;
  }
}

registerProcessor("ggtf-processor", GgtfProcessor);
