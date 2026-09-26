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
        this.compEnv = [0, 0];
        this.revBufferL = new Float32Array(Math.max(1, Math.floor(this.s * 2.0)));
        this.revBufferR = new Float32Array(Math.max(1, Math.floor(this.s * 2.0)));
        this.revPtr = 0;
        this.dcIn = [0, 0]; this.dcOut = [0, 0];
        this.p = {
            eq: {enabled: true, tilt: 0.53},
            tape: {enabled: true, drive: 1.1, bias: 0.01},
            chorus: {enabled: true, depth: 0.2, rate: 0.5, mix: 0.1},
            comp: {enabled: true, threshold: 0.5, ratio: 2, release: 0.1},
            exciter: {enabled: true, amount: 0.03, freq: 8500},
            reverb: {active: true, mix: 0.05, time: 350, feedback: 0.3},
            imager: {enabled: true, width: 1.05},
            limiter: {enabled: true, ceiling: 0.98},
            output: {enabled: true, gain: 1.0},
            final: {dcBlock: true, dcPole: 0.999}
        };
    }
    reset() {
        this.tiltL.reset(); this.tiltR.reset();
        this.chorusL.reset(); this.chorusR.reset();
        this.compEnv[0] = 0; this.compEnv[1] = 0;
        this.revBufferL.fill(0); this.revBufferR.fill(0); this.revPtr = 0;
        this.dcIn[0] = 0; this.dcIn[1] = 0; this.dcOut[0] = 0; this.dcOut[1] = 0;
        this.exciterLpL = 0; this.exciterLpR = 0;
    }
    updateParams(p) {
        if (!p || typeof p !== 'object') return;
        const sections = ['eq', 'tape', 'chorus', 'comp', 'exciter', 'reverb', 'imager', 'limiter', 'output', 'final'];
        const next = {...this.p};
        sections.forEach((key) => { if (p[key] && typeof p[key] === 'object') next[key] = {...(this.p[key] || {}), ...p[key]}; });
        this.p = next;
    }
    process(xL, xR) {
        let sL = xL, sR = xR;
        const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
        const clamp = (v, lo, hi, fallback) => Math.min(hi, Math.max(lo, finite(v, fallback)));
        if (this.p.tape?.enabled) {
            const drive = clamp(this.p.tape.drive, 0, 8, 1);
            const bias = clamp(this.p.tape.bias, -1, 1, 0);
            const sat = (v) => isFinite(v * drive + bias) ? Math.tanh(v * drive + bias) : 0;
            sL = sat(sL); sR = sat(sR);
        }
        if (this.p.eq?.enabled) {
            sL = this.tiltL.process(sL, this.p.eq.tilt || 0.5);
            sR = this.tiltR.process(sR, this.p.eq.tilt || 0.5);
        }
        if (this.p.exciter?.enabled) {
            const amount = clamp(this.p.exciter.amount, 0, 1, 0);
            const cutoff = clamp(this.p.exciter.freq, 1000, this.s * 0.45, 8500);
            const a = Math.min(0.99, 2 * Math.PI * cutoff / this.s);
            this.exciterLpL = (this.exciterLpL || 0) + a * (sL - (this.exciterLpL || 0));
            this.exciterLpR = (this.exciterLpR || 0) + a * (sR - (this.exciterLpR || 0));
            sL += Math.tanh((sL - this.exciterLpL) * 3) * amount;
            sR += Math.tanh((sR - this.exciterLpR) * 3) * amount;
        }
        if (this.p.comp?.enabled) {
            const threshold = clamp(this.p.comp.threshold, 0.01, 1, 0.5);
            const ratio = clamp(this.p.comp.ratio, 1, 20, 2);
            const release = clamp(this.p.comp.release, 0.005, 2, 0.1);
            const releaseCoeff = Math.exp(-1 / (release * this.s));
            [sL, sR].forEach((sample, channel) => {
                const level = Math.abs(sample);
                this.compEnv[channel] = Math.max(level, this.compEnv[channel] * releaseCoeff);
                if (this.compEnv[channel] > threshold) {
                    const over = this.compEnv[channel] / threshold;
                    const gain = Math.pow(over, -(1 - 1 / ratio));
                    if (channel === 0) sL *= gain; else sR *= gain;
                }
            });
        }
        if (this.p.chorus?.enabled) {
            const m = clamp(this.p.chorus.mix, 0, 1, 0);
            const depth = clamp(this.p.chorus.depth, 0, 1, 0.2);
            const rate = clamp(this.p.chorus.rate, 0.01, 10, 0.5);
            const modL = this.chorusL.process(sL, depth, rate, 0.3);
            const modR = this.chorusR.process(sR, depth, rate, 0.3);
            sL = sL * (1-m) + modL * m; sR = sR * (1-m) + modR * m;
        }
        if (this.p.reverb?.active) {
            const mix = clamp(this.p.reverb.mix, 0, 1, 0);
            const feedback = clamp(this.p.reverb.feedback, 0, 0.95, 0.3);
            const delay = Math.max(1, Math.min(this.revBufferL.length - 1, Math.floor(this.s * clamp(this.p.reverb.time, 10, 1800, 350) / 1000)));
            const read = (this.revPtr - delay + this.revBufferL.length) % this.revBufferL.length;
            const wetL = this.revBufferL[read], wetR = this.revBufferR[read];
            this.revBufferL[this.revPtr] = finite(sL + wetL * feedback);
            this.revBufferR[this.revPtr] = finite(sR + wetR * feedback);
            this.revPtr = (this.revPtr + 1) % this.revBufferL.length;
            sL = sL * (1 - mix) + wetL * mix; sR = sR * (1 - mix) + wetR * mix;
        }
        if (this.p.imager?.enabled) {
            const width = clamp(this.p.imager.width, 0, 2, 1);
            const mid = (sL + sR) * 0.5;
            const side = (sL - sR) * 0.5 * width;
            sL = mid + side; sR = mid - side;
        }
        if (this.p.final?.dcBlock) {
            const pole = clamp(this.p.final.dcPole, 0.9, 0.99999, 0.999);
            const outL = sL - this.dcIn[0] + pole * this.dcOut[0];
            const outR = sR - this.dcIn[1] + pole * this.dcOut[1];
            this.dcIn[0] = sL; this.dcIn[1] = sR; this.dcOut[0] = outL; this.dcOut[1] = outR;
            sL = outL; sR = outR;
        }
        const g = this.p.output?.enabled === false ? 1 : clamp(this.p.output?.gain, 0, 4, 1);
        sL *= g; sR *= g;
        if (this.p.limiter?.enabled) {
            const ceiling = clamp(this.p.limiter.ceiling, 0.1, 1, 0.98);
            const peak = Math.max(Math.abs(sL), Math.abs(sR));
            if (peak > ceiling) { const scale = ceiling / peak; sL *= scale; sR *= scale; }
        }
        return [finite(Math.max(-1, Math.min(1, sL))), finite(Math.max(-1, Math.min(1, sR)))];
    }
}
`;
