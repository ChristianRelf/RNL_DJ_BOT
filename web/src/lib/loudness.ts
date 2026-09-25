/** Offline EBU R128 style gated loudness and a 4x interpolated peak estimate. */
class Filter {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private readonly b0: number, private readonly b1: number, private readonly b2: number,
    private readonly a1: number, private readonly a2: number) {}
  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const shelf = () => new Filter(1.53512485958697, -2.69169618940638, 1.19839281085285,
  -1.69065929318241, 0.73248077421585);
const highPass = () => new Filter(1, -2, 1, -1.99004745483398, 0.99007225036621);
const BLOCK = 19_200;
const STEP = 4_800;

export class LoudnessAnalyser {
  private readonly filters = [[shelf(), highPass()], [shelf(), highPass()]];
  private readonly ring = new Float32Array(BLOCK);
  private sum = 0;
  private count = 0;
  private readonly blocks: number[] = [];
  private peak = 0;
  private readonly previousL = [0, 0, 0];
  private readonly previousR = [0, 0, 0];

  push(l: number, r: number): void {
    const yl = this.filters[0][1].step(this.filters[0][0].step(l));
    const yr = this.filters[1][1].step(this.filters[1][0].step(r));
    const power = yl * yl + yr * yr;
    const index = this.count % BLOCK;
    this.sum += power - this.ring[index];
    this.ring[index] = power;
    this.count++;
    if (this.count >= BLOCK && (this.count - BLOCK) % STEP === 0) this.blocks.push(this.sum / BLOCK);

    this.peak = Math.max(this.peak, Math.abs(l), Math.abs(r));
    if (this.count >= 4) {
      const interpolate = (history: number[], current: number) => {
        const [a, b, c] = history;
        for (const t of [0.25, 0.5, 0.75]) {
          const value = 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - current) * t * t
            + (-a + 3 * b - 3 * c + current) * t * t * t);
          this.peak = Math.max(this.peak, Math.abs(value));
        }
      };
      interpolate(this.previousL, l);
      interpolate(this.previousR, r);
    }
    this.previousL.shift(); this.previousL.push(l);
    this.previousR.shift(); this.previousR.push(r);
  }

  finish(): { loudnessLufs: number | null; truePeakDb: number | null } {
    if (!this.blocks.length && this.count) this.blocks.push(this.sum / this.count);
    const absolute = this.blocks.filter((power) => power > 0 && -0.691 + 10 * Math.log10(power) > -70);
    if (!absolute.length) return { loudnessLufs: null, truePeakDb: this.peak ? 20 * Math.log10(this.peak) : null };
    const mean = absolute.reduce((a, b) => a + b, 0) / absolute.length;
    const relative = mean / 10;
    const gated = absolute.filter((power) => power >= relative);
    const power = gated.reduce((a, b) => a + b, 0) / gated.length;
    return {
      loudnessLufs: Math.round((-0.691 + 10 * Math.log10(power)) * 10) / 10,
      truePeakDb: this.peak ? Math.round(20 * Math.log10(this.peak) * 10) / 10 : null,
    };
  }
}
