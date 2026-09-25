
/* eslint-disable no-inner-declarations */
import { ParsedTrace, SidEvent, MasteringParams, MixerParams } from '../types';
import { MASTERING_DSP_CODE } from './masteringDsp';

/**
 * PERFECT TRACE REPLAY + ROBUST MATH
 * - Stable sub-sample cycle integration
 * - Hardened audio mixer logic
 * - NO-EXPLODE Clamping
 */

export const CLOCK_PAL = 985248;
export const CLOCK_NTSC = 1022727;

const u8 = (v: number) => (v | 0) & 0xff;

const inferRefreshHz = (clock: number, header?: any): number => {
  const h = header || {};
  const hz = Number(h.refreshHz ?? h.refresh_hz ?? h.frameRate ?? h.fps ?? h.videoHz);
  if (Number.isFinite(hz) && hz > 40 && hz < 80) return hz;
  const dPal = Math.abs(clock - CLOCK_PAL);
  const dNtsc = Math.abs(clock - CLOCK_NTSC);
  return dNtsc < dPal ? 60 : 50;
};

const lowerBoundCycles = (arr: SidEvent[] | undefined, target: number): number => {
  const a = arr || [];
  let lo = 0,
    hi = a.length;
  const t = target | 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((a[mid].cycles | 0) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export const getRegsAtCycle = (trace: ParsedTrace | null, cycles: number): number[] => {
  if (!trace) return new Array(32).fill(0);

  const clock = Number(trace.header?.clock) || CLOCK_PAL;
  const refreshHz = inferRefreshHz(clock, trace.header);
  const cyclesPerFrame = clock / refreshHz;

  const frames = trace.frames || [];
  const events = trace.events || [];

  if (frames.length === 0 && events.length === 0) return new Array(32).fill(0);

  const frameIdx = Math.floor((cycles | 0) / cyclesPerFrame);
  const baseIdx = Math.max(0, Math.min(frames.length - 1, frameIdx));

  const regs = new Uint8Array(32);
  if (frames.length > 0) {
    const fr = frames[baseIdx] as any;
    for (let i = 0; i < 32; i++) regs[i] = u8(fr?.[i] ?? 0);
  }

  if (events.length > 0) {
    const startCycle = Math.floor(baseIdx * cyclesPerFrame);
    let i = lowerBoundCycles(events, startCycle);
    const end = cycles | 0;
    while (i < events.length) {
      const e = events[i];
      const c = e.cycles | 0;
      if (c > end) break;
      regs[e.reg & 0x1f] = u8(e.val);
      i++;
    }
  }

  return Array.from(regs);
};

function generateWorkletCode() {
  return `
${MASTERING_DSP_CODE}

function u8(v){ return (v|0) & 255; }
function clampF(v, lo, hi){ return v<lo?lo:(v>hi?hi:v); }
function isFin(v){ return Number.isFinite(v) && !Number.isNaN(v); }

function stableSortEvents(ev){
  if (!ev) return [];
  for (let i=0;i<ev.length;i++){
    if (ev[i]._i === undefined) ev[i]._i = i;
  }
  ev.sort((a,b)=>{
    const dc = (a.cycles|0) - (b.cycles|0);
    if (dc) return dc;
    return (a._i|0) - (b._i|0);
  });
  return ev;
}

function lowerBoundCycles(arr, target){
  let lo=0, hi=arr?arr.length:0;
  const t=target|0;
  while (lo<hi){
    const mid=(lo+hi)>>>1;
    if ((arr[mid].cycles|0) < t) lo=mid+1; else hi=mid;
  }
  return lo;
}

const ADSR_RATE_PERIODS = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

function getExpDiv(env){
  if (env >= 93) return 1;
  if (env >= 54) return 2;
  if (env >= 26) return 4;
  if (env >= 14) return 8;
  if (env >= 6) return 16;
  return 30;
}

class SidFilter {
  constructor(){
    this.vhp=0; this.vbp=0; this.vlp=0;
    this.w0=0; this.q=1;
    this.model='6581';
    this._cut=-1; this._res=-1;
  }
  reset(){ this.vhp=0; this.vbp=0; this.vlp=0; }
  updateParams(cutoff, res, model){
    model = model || '6581';
    cutoff = cutoff|0; res = res|0;
    if (model === this.model && cutoff === this._cut && res === this._res) return;
    this.model = model; this._cut = cutoff; this._res = res;

    let f0=0;
    const i = cutoff & 2047;

    if (this.model === '8580') {
      f0 = 30 * Math.pow(2, (i / 2047) * 9.058);
    } else {
      if (i < 256) f0 = 30 + (i * 0.7);
      else if (i < 512) f0 = 209 + 425 * Math.pow((i - 256) / 256, 1.15);
      else if (i < 1024) f0 = 634 + 1450 * Math.pow((i - 512) / 512, 1.45);
      else f0 = 2084 + 9900 * Math.pow((i - 1024) / 1023, 2.1);
    }

    this.w0 = 2 * Math.PI * f0 / (sampleRate * 8);

    const rTable = this.model === '8580'
      ? [0.707, 0.75, 0.85, 1.0, 1.2, 1.5, 2.0, 2.5, 3.2, 4.0, 5.2, 6.5, 8.5, 11.0, 14.0, 18.0]
      : [0.707, 0.8, 1.0, 1.3, 1.7, 2.2, 3.0, 4.0, 5.5, 7.5, 10.0, 13.5, 18.0, 24.0, 32.0, 50.0];

    this.q = clampF(1.0 / rTable[res & 15], 0.0001, 1.8);
  }
  step(input, mode){
    if (!isFin(input)) { this.reset(); return 0; }
    const sat = (x)=>{
      if (this.model === '8580') return clampF(x, -1.0, 1.0);
      return clampF(x - (x*x*x) * 0.12, -1.0, 1.0);
    };
    this.vlp = sat(this.vlp + this.w0 * this.vbp);
    this.vhp = sat(input - this.vlp - this.q * this.vbp);
    this.vbp = sat(this.vbp + this.w0 * this.vhp);
    let out = 0;
    if (mode & 0x01) out += this.vlp;
    if (mode & 0x02) out += this.vbp;
    if (mode & 0x04) out += this.vhp;
    return isFin(out) ? out : 0;
  }
}

class Voice {
  constructor(index){
    this.index=index|0;
    this.model='6581';
    this.reset();
  }
  reset(){
    this.freq=0; this.pw=0; this.ctrl=0; this.ad=0; this.sr=0;
    this.acc=0; this.env=0;
    this.lfsr=0x7FFFFF;
    this.timer=0; this.expTimer=0; this.state=0; this.gate=0;
    this.output=0;
    this.prevBit19=0;
    this.prevSrcMSB=0;
  }
  write(reg, val){
    val = u8(val);
    switch(reg|0){
      case 0: this.freq = (this.freq & 0xFF00) | val; break;
      case 1: this.freq = (this.freq & 0x00FF) | (val << 8); break;
      case 2: this.pw = (this.pw & 0x0F00) | val; break;
      case 3: this.pw = (this.pw & 0x00FF) | ((val & 0x0F) << 8); break;
      case 4: {
        const oldGate = this.gate;
        const newGate = (val & 1) ? 1 : 0;
        const testNow = (val & 0x08) ? 1 : 0;
        const testWas = (this.ctrl & 0x08) ? 1 : 0;
        if (testNow && !testWas){
          this.acc = 0; this.lfsr = 0x7FFFFF; this.output = 0;
        }
        if (newGate && !oldGate) this.state = 1;
        else if (!newGate && oldGate) this.state = 4;
        this.ctrl = val; this.gate = newGate;
        break;
      }
      case 5: this.ad = val; break;
      case 6: this.sr = val; break;
    }
  }
  stepAcc(){
    if (this.ctrl & 0x08) return;
    this.acc = (this.acc + (this.freq|0)) & 0xFFFFFF;
  }
  applySync(srcMSBRise){
    if ((this.ctrl & 0x02) && srcMSBRise) this.acc = 0;
  }
  stepNoise(){
    const b19 = (this.acc & 0x080000) ? 1 : 0;
    if (b19 && !this.prevBit19){
      const bit0 = ((this.lfsr >> 22) ^ (this.lfsr >> 17)) & 1;
      this.lfsr = ((this.lfsr << 1) | bit0) & 0x7FFFFF;
    }
    this.prevBit19 = b19;
  }
  stepEnv(){
    if (this.state === 0 || this.state === 3) return;
    const ad=this.ad|0, sr=this.sr|0;
    const rateVal = (this.state === 1) ? ((ad >> 4) & 15) : (this.state === 2 ? (ad & 15) : (sr & 15));
    const period = ADSR_RATE_PERIODS[rateVal] | 0;
    this.timer = (this.timer + 1) | 0;
    if (this.timer < period) return;
    this.timer = 0;
    if (this.state === 1){
      this.env = (this.env + 1) & 255;
      if (this.env === 255){ this.state = 2; this.expTimer = 0; }
      return;
    }
    this.expTimer = (this.expTimer + 1) | 0;
    const div = getExpDiv(this.env|0) | 0;
    if (this.expTimer < div) return;
    this.expTimer = 0;
    const sustain = (((sr >> 4) & 15) * 17) | 0;
    if (this.state === 2){
      if ((this.env|0) > sustain) this.env = ((this.env - 1) & 255); else this.state = 3;
    } else if (this.state === 4){
      if ((this.env|0) > 0) this.env = ((this.env - 1) & 255); else { this.env = 0; this.state = 0; }
    }
  }
  stepWave(ringSrcAcc){
    const tri = (this.ctrl & 0x10) ? 1 : 0, saw = (this.ctrl & 0x20) ? 1 : 0, pul = (this.ctrl & 0x40) ? 1 : 0, noi = (this.ctrl & 0x80) ? 1 : 0;
    if (!tri && !saw && !pul && !noi){ this.output = 0; return; }
    let triVal=0, sawVal=0, pulVal=0, noiVal=0;
    const curAcc = this.acc|0;
    if (tri){
      let t = (curAcc >> 12) & 0xFFF;
      if (curAcc & 0x800000) t ^= 0xFFF;
      if ((this.ctrl & 0x04) && (ringSrcAcc & 0x800000)) t ^= 0xFFF;
      triVal = t;
    }
    if (saw) sawVal = (curAcc >> 12) & 0xFFF;
    if (pul) pulVal = (((curAcc >> 12) & 0xFFF) < (this.pw & 0x0FFF)) ? 0xFFF : 0x000;
    if (noi) noiVal = (this.lfsr >> 11) & 0xFFF;
    let combined = 0xFFF;
    if (noi) combined = noiVal;
    else if (this.model === '8580'){
      if (tri) combined &= triVal; if (saw) combined &= sawVal; if (pul) combined &= pulVal;
    } else {
      const vals = []; if (tri) vals.push(triVal); if (saw) vals.push(sawVal); if (pul) vals.push(pulVal);
      if (vals.length === 1) combined = vals[0];
      else if (vals.length === 2) combined = ( (vals[0] & vals[1]) * 0.88 ) | 0;
      else if (vals.length === 3) combined = ( (vals[0] & vals[1] & vals[2]) * 0.65 ) | 0;
      else combined = 0;
    }
    this.output = clampF(((combined / 4095.0) - 0.5) * (this.env / 255.0) * 2.0, -1.2, 1.2);
  }
}

class SidProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.v = [new Voice(0), new Voice(1), new Voice(2)];
    this.filter = new SidFilter();
    this.regs = new Uint8Array(32);
    this.activityMap = new Uint8Array(32);
    this.transitionMap = new Uint8Array(32);
    this.pendingWrites = []; this.ev = []; this.ei = 0; this.cy = 0; this.nextCy = 0;
    this.clk = 985248; this.playing = false; this.model = '6581'; this.speed = 1.0; this.voiceMask = [1,1,1];
    this.mastering = new MasteringChain(sampleRate);
    this.mixer = { voices: [{volume:1, pan:0, muted:false}, {volume:1, pan:0, muted:false}, {volume:1, pan:0, muted:false}], masterVolume: 1.0 };
    this.statusThrottle = 0;
    this.voicePeaks = [0,0,0]; this.voiceRms = [0,0,0]; this.masterPeaks = [0,0];

    this.port.onmessage = (e)=>{
      const { type, payload } = e.data || {};
      if (type === 'DATA'){
        this.ev = stableSortEvents((payload?.events || []).map((x,i)=>({ cycles: x.cycles|0, reg: x.reg & 31, val: u8(x.val), _i: i })));
        this.clk = payload?.clock || 985248; this.ei = 0; this.cy = 0; this.nextCy = 0;
        this.regs.fill(0); this.pendingWrites.length = 0;
        this.v.forEach(v=>v.reset()); this.filter.reset(); this.mastering.reset();
      }
      else if (type === 'PLAY') this.playing = !!payload;
      else if (type === 'LIVE') this.pendingWrites.push({ reg: payload.reg & 31, val: u8(payload.val), cy: this.cy + 1, _i: this.pendingWrites.length });
      else if (type === 'MASTER') this.mastering.updateParams(payload || {});
      else if (type === 'MIXER') this.mixer = payload || this.mixer;
      else if (type === 'MODEL'){
        this.model = payload === '8580' ? '8580' : '6581';
        this.v.forEach(v=>v.model=this.model); this.filter.model=this.model; this.filter._cut=-1;
      }
      else if (type === 'SPEED') this.speed = Number.isFinite(payload) && payload > 0 ? clampF(payload, 0.05, 8) : 1;
      else if (type === 'MASK' && Array.isArray(payload)) payload.forEach((m,i)=>this.voiceMask[i]=m?1:0);
      else if (type === 'SEEK'){
        this.cy = payload|0; this.nextCy = payload|0;
        this.ei = lowerBoundCycles(this.ev, this.cy);
        this.regs.fill(0); this.pendingWrites.length = 0;
        this.v.forEach(v=>v.reset()); this.filter.reset(); this.mastering.reset();
      }
    };
  }

  stepOneCycle(){
    while (this.ei < (this.ev?.length || 0) && this.ev[this.ei].cycles <= this.cy){
      const e = this.ev[this.ei++]; const r = e.reg; const nv = e.val; const ov = this.regs[r];
      this.regs[r] = nv; this.activityMap[r] = 1; this.transitionMap[r] |= (ov ^ nv);
      if (r < 21) this.v[(r/7)|0].write(r%7, nv);
    }
    if (this.pendingWrites.length > 1) this.pendingWrites.sort((a,b)=> (a.cy-b.cy) || (a._i-b._i) );
    while (this.pendingWrites.length && this.pendingWrites[0].cy <= this.cy){
      const w = this.pendingWrites.shift(); const r = w.reg; const nv = w.val; const ov = this.regs[r];
      this.regs[r] = nv; this.activityMap[r] = 1; this.transitionMap[r] |= (ov ^ nv);
      if (r < 21) this.v[(r/7)|0].write(r%7, nv);
    }
    const p0 = this.v[0].acc|0, p1 = this.v[1].acc|0, p2 = this.v[2].acc|0;
    this.v[0].stepAcc(); this.v[1].stepAcc(); this.v[2].stepAcc();
    const n0 = this.v[0].acc|0, n1 = this.v[1].acc|0, n2 = this.v[2].acc|0;
    this.v[0].applySync((n2 & 0x800000) && !(p2 & 0x800000));
    this.v[1].applySync((n0 & 0x800000) && !(p0 & 0x800000));
    this.v[2].applySync((n1 & 0x800000) && !(p1 & 0x800000));
    this.v[0].stepNoise(); this.v[1].stepNoise(); this.v[2].stepNoise();
    this.v[0].stepEnv(); this.v[1].stepEnv(); this.v[2].stepEnv();
    this.v[0].stepWave(this.v[2].acc|0); this.v[1].stepWave(this.v[0].acc|0); this.v[2].stepWave(this.v[1].acc|0);
  }

  process(inputs, outputs){
    const outL = outputs[0][0]; const outR = outputs[0][1]; if (!outL) return true;
    const clk = this.clk || 985248; const cyclesPerSub = (clk * this.speed) / (sampleRate * 8);
    this.activityMap.fill(0); this.transitionMap.fill(0);

    for (let i=0; i<outL.length; i++){
      let sampleSumL = 0;
      let sampleSumR = 0;
      for (let sub=0; sub<8; sub++){
        if (this.playing){
          this.nextCy += cyclesPerSub;
          while (this.cy < Math.floor(this.nextCy)){ this.stepOneCycle(); this.cy++; }
        }
        const cutoff = (((this.regs[21] & 7) | (this.regs[22] << 3)) & 0x7FF);
        const route = this.regs[23], modeVol = this.regs[24];
        this.filter.updateParams(cutoff, (route >> 4) & 15, this.model);
        let toFilter = 0, direct = 0;
        for (let v=0; v<3; v++){
          if (v === 2 && (modeVol & 0x80)) continue;
          const mixV = this.mixer.voices[v];
          const rawVal = (this.voiceMask[v] && !mixV.muted ? this.v[v].output : 0);
          const val = rawVal * mixV.volume;

          this.voicePeaks[v] = Math.max(this.voicePeaks[v], Math.abs(val));
          this.voiceRms[v] = this.voiceRms[v] * 0.999 + (val * val) * 0.001;

          if (route & (1 << v)) toFilter += val; else direct += val;
        }
        const subMono = (this.filter.step(toFilter, (modeVol >> 4) & 7) + direct) * (modeVol & 15) / 15;
        sampleSumL += subMono;
        sampleSumR += subMono;
      }
      const mixedL = clampF((sampleSumL / 8) * this.mixer.masterVolume, -1.5, 1.5);
      const mixedR = clampF((sampleSumR / 8) * this.mixer.masterVolume, -1.5, 1.5);
      const stereo = this.mastering.process(mixedL, mixedR);

      outL[i] = stereo[0]; if (outR) outR[i] = stereo[1];
      this.masterPeaks[0] = Math.max(this.masterPeaks[0], Math.abs(stereo[0]));
      this.masterPeaks[1] = Math.max(this.masterPeaks[1], Math.abs(stereo[1]));
    }
    this.regs[0x1B] = (this.v[2].acc >> 16) & 0xFF; this.regs[0x1C] = this.v[2].env;
    if (++this.statusThrottle >= 4){
      this.statusThrottle = 0;
      const temp = 30 + this.v.reduce((a,v)=>(a+v.env/255), 0) * 120;
      this.port.postMessage({
        type: 'STATUS', cy: this.cy, ts: currentTime * 1000,
        regs: Array.from(this.regs), activity: Array.from(this.activityMap), transitions: Array.from(this.transitionMap),
        vStates: this.v.map(v=>({ level: v.env/255, phase: v.acc, state: v.state, freq: v.freq, pw: v.pw, ctrl: v.ctrl })),
        voicePeaks: [...this.voicePeaks], voiceRms: [...this.voiceRms].map(Math.sqrt),
        masterPeaks: [...this.masterPeaks],
        physics: { temp, power: 0.6 + (temp-30)*0.015, vSupply: (clk === 985248 ? 12 : 9) }
      });
      this.voicePeaks.fill(0); this.masterPeaks.fill(0);
    }
    return true;
  }
}
registerProcessor('sid-processor', SidProcessor);
  `;
}

export class SidPlayer {
  ctx: BaseAudioContext; node: AudioWorkletNode | null = null; gainNode: GainNode;
  public volatileCycles = 0; public volatileLocalTimestamp = 0;
  public volatileRegs = new Array(32).fill(0);
  public volatileActivity = new Array(32).fill(0);
  public volatileTransitions = new Array(32).fill(0);
  public volatileVoiceStates: any[] = Array(3).fill(0).map(() => ({ level: 0, phase: 0, state: 0, freq: 0, pw: 0, ctrl: 0 }));
  public volatilePhysics = { temp: 25, power: 0, vSupply: 12 };
  public volatileVoicePeaks = [0, 0, 0];
  public volatileVoiceRms = [0, 0, 0];
  public volatileMasterPeaks = [0, 0];
  public trace: ParsedTrace | null = null;
  isPlaying = false; private clock = CLOCK_PAL;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx; this.gainNode = ctx.createGain(); this.gainNode.connect(ctx.destination);
  }

  async init() {
    const blob = new Blob([generateWorkletCode()], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, 'sid-processor', { outputChannelCount: [2] });
    this.node.connect(this.gainNode);
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'STATUS') {
        this.volatileCycles = e.data.cy; this.volatileLocalTimestamp = e.data.ts;
        this.volatileRegs = e.data.regs; this.volatileVoiceStates = e.data.vStates;
        this.volatileActivity = e.data.activity; this.volatileTransitions = e.data.transitions;
        this.volatilePhysics = e.data.physics;
        this.volatileVoicePeaks = e.data.voicePeaks || [0,0,0];
        this.volatileVoiceRms = e.data.voiceRms || [0,0,0];
        this.volatileMasterPeaks = e.data.masterPeaks || [0,0];
      }
    };
  }

  setData(ev: SidEvent[], clk: number) {
    this.clock = clk || CLOCK_PAL;
    const sorted = [...ev].sort((a,b)=>a.cycles-b.cycles);
    this.trace = { header: { clock: clk }, frames: [], events: sorted };
    this.node?.port.postMessage({ type: 'DATA', payload: { events: sorted, clock: clk } });
  }
  async play() { if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') await this.ctx.resume(); this.isPlaying = true; this.node?.port.postMessage({ type: 'PLAY', payload: true }); }
  pause() { this.isPlaying = false; this.node?.port.postMessage({ type: 'PLAY', payload: false }); }
  seek(c: number) { this.volatileCycles = c; this.node?.port.postMessage({ type: 'SEEK', payload: c|0 }); }
  setSpeed(s: number) { this.node?.port.postMessage({ type: 'SPEED', payload: s }); }
  setModel(m: '6581' | '8580') { this.node?.port.postMessage({ type: 'MODEL', payload: m }); }
  liveWrite(reg: number, val: number) { this.node?.port.postMessage({ type: 'LIVE', payload: { reg, val } }); }
  setMasteringParams(p: MasteringParams) { this.node?.port.postMessage({ type: 'MASTER', payload: p }); }
  setMixerParams(p: MixerParams) { this.node?.port.postMessage({ type: 'MIXER', payload: p }); }
  setVoiceMask(m: [boolean, boolean, boolean]) { this.node?.port.postMessage({ type: 'MASK', payload: m }); }

  getEstimatedCycles(): number {
    if (!this.isPlaying) return this.volatileCycles;
    const elapsed = performance.now() - (this.volatileLocalTimestamp || performance.now());
    return Math.floor(this.volatileCycles + (elapsed * this.clock / 1000));
  }
  destroy() { this.node?.disconnect(); this.gainNode.disconnect(); if (this.ctx instanceof AudioContext) this.ctx.close(); }
}

export const parseTraceFile = (text: string): ParsedTrace => {
  const events: SidEvent[] = []; const lines = text.split(/\r?\n/);
  lines.forEach(l => {
    const p = l.split('|').map(s => s.trim());
    if (p.length >= 3) {
      const c = parseInt(p[0]), r = parseInt(p[1], 16) & 0x1F, v = parseInt(p[2], 16);
      if (!isNaN(c)) events.push({ cycles: c, reg: r, val: u8(v) });
    }
  });
  if (events.length === 0) {
    try {
      const json = JSON.parse(text);
      const raw = Array.isArray(json) ? json : (json.events || json.writeLog || []);
      raw.forEach((e: any) => {
        const r = parseInt(e.reg ?? (e.addr !== undefined ? e.addr & 0x1F : -1));
        const cycles = Number(e.cycles ?? e.cycle ?? 0);
        if (r >= 0 && r < 32 && Number.isFinite(cycles) && cycles >= 0) events.push({ cycles, reg: r, val: u8(e.val ?? e.value ?? 0) });
      });
    } catch {}
  }
  const sorted = events.sort((a,b)=>a.cycles-b.cycles); const clock = CLOCK_PAL; const frames: any[] = [];
  if (sorted.length > 0) {
    const cpf = clock/50; const total = Math.ceil(sorted[sorted.length-1].cycles/cpf);
    const cur = new Uint8Array(32); let ei = 0;
    for (let f=0; f<total; f++){
      while (ei < sorted.length && sorted[ei].cycles <= f*cpf){ cur[sorted[ei].reg] = sorted[ei].val; ei++; }
      frames.push(new Uint8Array(cur));
    }
  }
  return { header: { clock }, frames, events: sorted };
};

export const getNoteName = (f: number, clk: number): string => {
  if (!Number.isFinite(f) || f <= 0) return '---';
  const hz = (f * clk) / 16777216;
  if (hz < 10) return '---';
  const n = Math.round(69 + 12 * Math.log2(hz / 440));
  const names = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  return (n < 0 || n > 127) ? '???' : names[n % 12] + Math.floor(n / 12);
};

export const midiNoteToFreq = (n: number, clk: number): number => n < 0 ? 0 : Math.round((440 * Math.pow(2, (n - 69) / 12) * 16777216) / clk);

export function generateWaveformPoints(ctrl: number, pw: number, _freq: number, count: number, phase: number): number[] {
  const pts: number[] = [];
  const tri = (ctrl & 0x10) !== 0, saw = (ctrl & 0x20) !== 0, pul = (ctrl & 0x40) !== 0, noi = (ctrl & 0x80) !== 0;
  const pwF = (pw & 0x0fff) / 4095;
  let lfsr = 0x7fffff ^ (((phase % 1) * 0xffffff) | 0);
  for (let i = 0; i < count; i++) {
    const p = (phase + i / count) % 1; let raw = 4095;
    if (tri) raw &= Math.round((p < 0.5 ? (2 * p) : (2 - 2 * p)) * 4095);
    if (saw) raw &= Math.round(p * 4095);
    if (pul) raw &= (p < pwF ? 4095 : 0);
    if (noi) {
      const b0 = ((lfsr >> 22) ^ (lfsr >> 17)) & 1; lfsr = ((lfsr << 1) | b0) & 0x7fffff;
      raw &= ((lfsr >> 11) & 0xfff);
    }
    pts.push(!tri && !saw && !pul && !noi ? 0 : (raw / 2048.0) - 1.0);
  }
  return pts;
}

export const detectVibrato = (f: number[], minDev = 50): boolean => {
  const valid = f.filter(v => v > 0); if (valid.length < 5) return false;
  const avg = valid.reduce((a,b)=>a+b) / valid.length;
  if (Math.max(...valid.map(v => Math.abs(v-avg))) < minDev) return false;
  let cross = 0; for (let i=1; i<valid.length; i++) if ((valid[i-1]<avg && valid[i]>avg) || (valid[i-1]>avg && valid[i]<avg)) cross++;
  return cross > 2;
};

export const analyzeArpeggio = (f: number[]): { x: number; y: number } | null => {
  if (f.length < 3 || f[0] <= 0) return null;
  const semitones: number[] = [];
  for (let i=1; i<Math.min(f.length, 6); i++){
    if (f[i] <= 0) continue;
    const st = Math.round(12 * Math.log2(f[i]/f[0]));
    if (st !== 0 && !semitones.includes(st)) semitones.push(st);
  }
  return semitones.length === 2 ? { x: Math.abs(semitones[0])%16, y: Math.abs(semitones[1])%16 } : null;
};
