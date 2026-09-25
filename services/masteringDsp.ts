export const MASTERING_DSP_CODE = `
/**
 * Analog Mojo Stereo DSP Kernel V8.2 (Hardened)
 * Professional mastering chain with NaN/Overflow protection and FTZ.
 */

const MASTERING_EPSILON = 1e-12;
const MASTERING_FTZ = 1e-15;

class BBDChorus {
    constructor(sampleRate) {
        this.s = sampleRate;
        this.buffer = new Float32Array(Math.floor(sampleRate * 0.1));
        this.ptr = 0;
        this.lfo = 0;
    }
    reset() {
        this.buffer.fill(0);
        this.ptr = 0;
        this.lfo = 0;
    }
    process(x, depth, rate, feedback) {
        depth = Math.max(0, Math.min(1.0, depth));
        feedback = Math.max(0, Math.min(0.95, feedback));

        this.lfo += rate / Math.max(MASTERING_EPSILON, this.s);
        const mod = Math.sin(this.lfo * 6.283) * depth;
        const delay = 0.02 * this.s + mod * 0.012 * this.s;
        let readPtr = this.ptr - delay;
        while (readPtr < 0) readPtr += this.buffer.length;
        readPtr %= this.buffer.length;

        const i = Math.floor(readPtr);
        const f = readPtr - i;
        const p1 = this.buffer[i];
        const p2 = this.buffer[(i + 1) % this.buffer.length];

        const y = p1 + (p2 - p1) * f;
        const nextVal = x + y * feedback;
        this.buffer[this.ptr] = isFinite(nextVal) ? Math.tanh(nextVal) : 0;
        this.ptr = (this.ptr + 1) % this.buffer.length;

        const out = isFinite(y) ? y : 0;
        return Math.abs(out) < MASTERING_FTZ ? 0 : out;
    }
}

class TiltEQ {
    constructor(sampleRate) {
        this.s = sampleRate;
        this.lp = 0;
    }
    reset() { this.lp = 0; }
    process(x, tilt) {
        tilt = Math.max(0, Math.min(1.0, tilt));
        const f = Math.min(0.95, 1200 / Math.max(MASTERING_EPSILON, this.s));
        this.lp = this.lp + f * (x - this.lp);

        const hp = x - this.lp;
        const gainL = 1.0 + (0.5 - tilt) * 1.5;
        const gainH = 1.0 + (tilt - 0.5) * 1.5;
        const out = this.lp * gainL + hp * gainH;

        if (Math.abs(this.lp) < MASTERING_FTZ) this.lp = 0;
        return isFinite(out) ? out : 0;
    }
}

class MasteringChain {
    constructor(sampleRate) {
        this.s = sampleRate || 44100;
        this.tiltL = new TiltEQ(this.s); this.tiltR = new TiltEQ(this.s);
        this.chorusL = new BBDChorus(this.s); this.chorusR = new BBDChorus(this.s);
        this.p = {
            eq: {enabled: true, tilt: 0.53},
            tape: {enabled: true, drive: 1.1, bias: 0.01},
            chorus: {enabled: true, depth: 0.2, rate: 0.5, mix: 0.1},
            reverb: {active: true, mix: 0.05},
            output: {gain: 1.0}
        };
    }
    reset() {
        this.tiltL.reset(); this.tiltR.reset();
        this.chorusL.reset(); this.chorusR.reset();
    }
    updateParams(p) { if(p) this.p = p; }
    process(xL, xR) {
        let sL = xL, sR = xR;
        if (this.p.tape?.enabled) {
            const sat = (v) => isFinite(v * this.p.tape.drive + this.p.tape.bias) ? Math.tanh(v * this.p.tape.drive + this.p.tape.bias) : 0;
            sL = sat(sL); sR = sat(sR);
        }
        if (this.p.eq?.enabled) {
            sL = this.tiltL.process(sL, this.p.eq.tilt || 0.5);
            sR = this.tiltR.process(sR, this.p.eq.tilt || 0.5);
        }
        if (this.p.chorus?.enabled) {
            const m = this.p.chorus.mix || 0;
            const modL = this.chorusL.process(sL, this.p.chorus.depth, this.p.chorus.rate, 0.3);
            const modR = this.chorusR.process(sR, this.p.chorus.depth, this.p.chorus.rate, 0.3);
            sL = sL * (1-m) + modL * m; sR = sR * (1-m) + modR * m;
        }
        const g = this.p.output?.gain ?? 1.0;
        return [Math.tanh(sL * g), Math.tanh(sR * g)];
    }
}
`;
