
import React, { useEffect, useRef, useState, memo } from 'react';
import { Sliders, Mic2, Waves, Box, Zap, Speaker, Activity, Power, Volume2, Shield, Headphones, Music, Radio, Maximize2, Terminal, Layers, Thermometer, Gauge, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { MasteringParams, MixerParams, VoiceParams } from '../types';
import { SidPlayer } from '../services/sidService';

const toLin = (v: number) => Math.pow(v, 2.5);
const fromLin = (v: number) => Math.pow(v, 1/2.5);

const HighResVuMeter = memo(({ peak, rms, label }: { peak: number, rms: number, label: string }) => {
    const segments = 28;
    const peakHold = useRef(0);
    const lastUpdate = useRef(Date.now());
    const smoothRms = useRef(0);
    smoothRms.current = smoothRms.current * 0.75 + rms * 0.25;
    if (peak > peakHold.current) { peakHold.current = peak; lastUpdate.current = Date.now(); }
    else if (Date.now() - lastUpdate.current > 1200) { peakHold.current *= 0.96; }

    return (
        <div className="flex flex-col items-center gap-1.5 h-full">
            <div className="flex flex-col gap-[1.5px] h-full w-3 bg-black p-[2px] rounded-sm border border-white/10 relative shadow-2xl overflow-hidden">
                {Array.from({length: segments}).map((_, i) => {
                    const idx = segments - 1 - i;
                    const thresh = idx / segments;
                    const isActive = smoothRms.current > thresh;
                    const isPeak = peak > thresh;
                    const isHold = Math.abs(peakHold.current - thresh) < (1/segments);
                    let color = 'bg-slate-900';
                    if (isActive) {
                        color = idx > segments * 0.88 ? 'bg-red-500 shadow-[0_0_10px_red]' :
                                (idx > segments * 0.65 ? 'bg-amber-500 shadow-[0_0_8px_orange]' : 'bg-cyan-500 shadow-[0_0_8px_cyan]');
                    } else if (isPeak || isHold) {
                        color = isHold ? 'bg-white/70 shadow-[0_0_8px_white]' : 'bg-slate-800 opacity-40';
                    }
                    return <div key={i} className={`flex-1 w-full rounded-[0.5px] transition-all duration-100 ${color}`}></div>;
                })}
            </div>
            <span className="text-[7px] text-slate-500 font-black uppercase tracking-tighter">{label}</span>
        </div>
    );
});

interface MixerConsoleProps {
    params: MasteringParams;
    onUpdate: (p: MasteringParams) => void;
    mixerParams: MixerParams;
    onUpdateMixer: (p: MixerParams) => void;
    onClose: () => void;
    player: SidPlayer | null;
}

const MixerConsole: React.FC<MixerConsoleProps> = ({ params, onUpdate, mixerParams, onUpdateMixer, onClose, player }) => {
    const [stats, setStats] = useState({ peaks: [0, 0, 0], rms: [0, 0, 0], mPeaks: [0, 0] });
    const [physics, setPhysics] = useState({ temp: 25.0, power: 0.7, vSupply: 12.0 });
    const rafRef = useRef(0);

    useEffect(() => {
        const tick = () => {
            if (player) {
                // Fix: Correctly reference peak and RMS properties on SidPlayer
                setStats({
                    peaks: [...player.volatileVoicePeaks],
                    rms: [...player.volatileVoiceRms],
                    mPeaks: [...player.volatileMasterPeaks]
                });
                setPhysics({ ...player.volatilePhysics });
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        tick();
        return () => cancelAnimationFrame(rafRef.current);
    }, [player]);

    const updateVoice = (idx: number, changes: Partial<VoiceParams>) => {
        const nextVoices = [...mixerParams.voices] as [VoiceParams, VoiceParams, VoiceParams];
        nextVoices[idx] = { ...nextVoices[idx], ...changes };
        onUpdateMixer({ ...mixerParams, voices: nextVoices });
    };

    const updateMaster = (section: keyof MasteringParams, key: string, value: any) => {
        const currentSection = params[section] || {} as any;
        onUpdate({ ...params, [section]: { ...currentSection, [key]: value } });
    };

    const ControlKnob = ({ label, value, min, max, onChange, color = 'cyan', unit = '' }: any) => {
        const percent = ((value - min) / (max - min)) * 100;
        return (
            <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={() => {
                const next = value + (max-min)*0.15;
                onChange(next > max ? min : next);
            }}>
                <div className={`w-12 h-12 rounded-full bg-slate-950 border-2 border-slate-800 relative flex items-center justify-center transition-all group-hover:border-${color}-500/50 shadow-2xl group-active:scale-95`}>
                    <div className="absolute inset-2 border border-white/5 rounded-full"></div>
                    <div className={`w-1.5 h-4 bg-${color}-400 rounded-full absolute -top-1 origin-bottom shadow-[0_0_12px_currentColor]`} style={{ transform: `rotate(${(percent/100)*270 - 135}deg) translateY(-8px)` }}></div>
                </div>
                <div className="flex flex-col items-center leading-tight">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-[0.2em]">{label}</span>
                    <span className={`text-[10px] text-${color}-400 font-black tracking-tighter`}>{value.toFixed(2)}{unit}</span>
                </div>
            </div>
        );
    };

    const MasterSlider = ({ label, value, min, max, step, onChange, color = 'cyan' }: any) => (
        <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5 flex flex-col gap-3 hover:bg-slate-900/80 transition-all group shadow-inner">
            <div className="flex justify-between items-center px-1">
                <span className="text-[9px] font-black uppercase text-slate-500 tracking-[0.3em] group-hover:text-slate-300 transition-colors">{label}</span>
                <span className={`text-[11px] font-black text-${color}-400 glow-text`}>{value.toFixed(2)}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className={`w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-${color}-500 cursor-crosshair shadow-sm`} />
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-[#010204] font-mono select-none overflow-hidden p-8 gap-8 relative group/console">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.05)_0%,transparent_70%)] pointer-events-none"></div>

            <div className="flex items-center justify-between border-b-2 border-white/5 pb-6 shrink-0 z-10">
                <div className="flex items-center gap-8">
                    <div className="p-4 bg-cyan-500/10 rounded-3xl border-2 border-cyan-500/30 shadow-[0_0_50px_rgba(34,211,238,0.2)]">
                        <Terminal className="w-10 h-10 text-cyan-400 animate-pulse" />
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-3xl font-black text-white tracking-[0.4em] uppercase glow-text italic leading-none">SID_ANALOG_MOJO::V7.0_HQ</h2>
                        <div className="flex items-center gap-4 mt-3">
                           <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-[0.4em] border border-emerald-500/30 px-2 py-0.5 rounded shadow-[0_0_10px_rgba(16,185,129,0.1)] flex items-center gap-2">
                               <CheckCircle2 className="w-3 h-3"/> OVERSAMPLED_KERNEL
                           </span>
                           <span className="text-[9px] text-cyan-500 font-bold uppercase tracking-[0.4em] border border-cyan-500/30 px-2 py-0.5 rounded flex items-center gap-2">
                               <CheckCircle2 className="w-3 h-3"/> POLYBLEP_ANTIALIAS
                           </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-8 items-center px-8 py-3 bg-black/80 rounded-3xl border-2 border-white/10 shadow-2xl ring-1 ring-white/5">
                    <div className="flex flex-col gap-1">
                        <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2"><Gauge className="w-3 h-3"/> VDD_RAIL</span>
                        <span className={`text-[16px] font-black tracking-tighter ${physics.vSupply < 8.5 || (physics.vSupply > 10 && physics.vSupply < 11.4) ? 'text-amber-500 animate-pulse' : 'text-cyan-400'}`}>{physics.vSupply.toFixed(2)}V</span>
                    </div>
                    <div className="w-px h-8 bg-white/10"></div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2"><Zap className="w-3 h-3"/> LOAD_WATT</span>
                        <span className="text-[16px] text-emerald-400 font-black tracking-tighter">{physics.power.toFixed(3)}W</span>
                    </div>
                    <div className="w-px h-8 bg-white/10"></div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest flex items-center gap-2"><Thermometer className="w-3 h-3"/> DIE_TEMP</span>
                        <span className={`text-[16px] font-black tracking-tighter ${physics.temp > 85 ? 'text-red-500 animate-pulse' : (physics.temp > 68 ? 'text-amber-500' : 'text-white')}`}>{physics.temp.toFixed(1)}°C</span>
                    </div>
                </div>

                <button onClick={onClose} className="p-3 bg-red-900/20 border-2 border-red-500/40 text-red-500 rounded-2xl hover:bg-red-500/40 transition-all hover:scale-110 active:scale-95 shadow-lg"><Power className="w-8 h-8" /></button>
            </div>

            <div className="flex-1 flex gap-8 overflow-hidden min-h-0">
                <div className="flex gap-6 p-8 bg-black/60 border-2 border-white/5 rounded-[4rem] shadow-extreme z-10 relative overflow-hidden backdrop-blur-3xl">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent opacity-30"></div>
                    {[0, 1, 2].map((idx) => {
                        const voice = mixerParams.voices[idx];
                        return (
                            <div key={idx} className="flex flex-col items-center gap-8 bg-slate-900/30 p-8 border border-white/10 rounded-[3.5rem] shadow-inner transition-all hover:bg-slate-800/40 w-36 group/strip">
                                <div className="flex flex-col items-center gap-1">
                                    <span className={`text-[13px] font-black tracking-[0.3em] uppercase transition-colors ${voice.muted ? 'text-slate-700' : 'text-cyan-400'}`}>CH_0{idx+1}</span>
                                    <div className={`w-12 h-1 rounded-full ${voice.muted ? 'bg-slate-800' : 'bg-cyan-500 shadow-[0_0_10px_cyan]'}`}></div>
                                </div>

                                <div className="flex gap-5 h-72 items-center relative py-4">
                                    <HighResVuMeter peak={stats.peaks[idx]} rms={stats.rms[idx]} label="LVL" />
                                    <div className="relative h-full w-10 group/fader">
                                        <div className="absolute inset-0 w-[4px] bg-slate-950 left-1/2 -translate-x-1/2 rounded-full border border-white/5 shadow-inner"></div>
                                        <input
                                            type="range" min="0" max="1.1" step="0.01"
                                            value={fromLin(voice.volume)}
                                            onChange={(e) => updateVoice(idx, { volume: toLin(parseFloat(e.target.value)) })}
                                            className="absolute inset-0 w-10 h-full appearance-none bg-transparent cursor-ns-resize vertical-slider z-30 opacity-0"
                                            style={{ WebkitAppearance: 'slider-vertical' } as any}
                                        />
                                        <div className="absolute left-1/2 -translate-x-1/2 w-10 h-6 bg-slate-800 border-2 border-slate-600 rounded-lg pointer-events-none z-20 shadow-extreme transition-all group-hover/fader:border-cyan-500 group-hover/fader:scale-110" style={{ bottom: `${(fromLin(voice.volume) / 1.1) * 100}%` }}>
                                            <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-cyan-400 shadow-[0_0_15px_cyan]"></div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-4 w-full">
                                    <ControlKnob label="PAN" value={voice.pan} min={-1} max={1} onChange={(v:any)=>updateVoice(idx, { pan: v })} color="cyan" />
                                    <button
                                        onClick={() => updateVoice(idx, { muted: !voice.muted })}
                                        className={`flex-1 py-1.5 text-[9px] font-black rounded-xl border-2 transition-all ${voice.muted ? 'bg-red-950 border-red-500 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-slate-950 border-slate-800 text-slate-600 hover:text-slate-400'}`}
                                    >
                                        MUTE
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    <div className="flex flex-col items-center gap-8 bg-emerald-950/20 p-8 border border-emerald-500/20 rounded-[3.5rem] shadow-inner w-36">
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[13px] font-black tracking-[0.3em] uppercase text-emerald-400">EXT_IN</span>
                            <div className="w-12 h-1 rounded-full bg-emerald-500 shadow-[0_0_10px_emerald]"></div>
                        </div>
                        <div className="flex gap-5 h-72 items-center relative py-4">
                            <HighResVuMeter peak={0} rms={0} label="INPUT" />
                            <div className="relative h-full w-10">
                                <div className="absolute inset-0 w-[4px] bg-slate-950 left-1/2 -translate-x-1/2 rounded-full border border-white/5"></div>
                                <input
                                    type="range" min="0" max="1.1" step="0.01"
                                    value={fromLin(mixerParams.extVolume || 0.5)}
                                    onChange={(e) => onUpdateMixer({ ...mixerParams, extVolume: toLin(parseFloat(e.target.value)) })}
                                    className="absolute inset-0 w-10 h-full appearance-none bg-transparent cursor-ns-resize vertical-slider z-30 opacity-0"
                                    style={{ WebkitAppearance: 'slider-vertical' } as any}
                                />
                                <div className="absolute left-1/2 -translate-x-1/2 w-10 h-6 bg-slate-800 border-2 border-slate-600 rounded-lg pointer-events-none z-20" style={{ bottom: `${(fromLin(mixerParams.extVolume || 0.5) / 1.1) * 100}%` }}>
                                    <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-emerald-400 shadow-[0_0_15px_emerald]"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col gap-8 overflow-y-auto custom-scrollbar pr-6 z-10 py-2">
                    <div className="grid grid-cols-2 gap-8">
                        <div className="bg-slate-900/40 p-8 rounded-[3.5rem] border-2 border-white/5 flex flex-col gap-6 shadow-extreme backdrop-blur-md">
                            <div className="flex items-center justify-between border-b-2 border-white/5 pb-4">
                                <div className="flex items-center gap-4">
                                    <Activity className="w-6 h-6 text-emerald-400" />
                                    <span className="text-[14px] font-black text-emerald-400 uppercase tracking-[0.4em]">TILT_EQ_DSP</span>
                                </div>
                                <input type="checkbox" checked={params.eq.enabled} onChange={(e)=>updateMaster('eq', 'enabled', e.target.checked)} className="w-5 h-5 accent-emerald-500 cursor-pointer" />
                            </div>
                            <MasterSlider label="MOJO_TILT_BAL" value={params.eq.tilt || 0.5} min={0} max={1} step={0.01} color="emerald" onChange={(v:any)=>updateMaster('eq','tilt',v)} />
                        </div>

                        <div className="bg-slate-900/40 p-8 rounded-[3.5rem] border-2 border-white/5 flex flex-col gap-6 shadow-extreme backdrop-blur-md">
                             <div className="flex items-center justify-between border-b-2 border-white/5 pb-4">
                                <div className="flex items-center gap-4">
                                    <Layers className="w-6 h-6 text-pink-400" />
                                    <span className="text-[14px] font-black text-pink-400 uppercase tracking-[0.4em]">BBD_CHORUS</span>
                                </div>
                                <input type="checkbox" checked={params.chorus?.enabled} onChange={(e)=>updateMaster('chorus', 'enabled', e.target.checked)} className="w-5 h-5 accent-pink-500 cursor-pointer" />
                            </div>
                            <div className="grid grid-cols-3 gap-6 pt-4">
                                <ControlKnob label="DEPTH" value={params.chorus?.depth || 0.3} min={0} max={1} onChange={(v:any)=>updateMaster('chorus','depth',v)} color="pink" />
                                <ControlKnob label="RATE_HZ" value={params.chorus?.rate || 0.5} min={0.1} max={5} onChange={(v:any)=>updateMaster('chorus','rate',v)} color="pink" />
                                <ControlKnob label="MIX_BAL" value={params.chorus?.mix || 0.15} min={0} max={1} onChange={(v:any)=>updateMaster('chorus','mix',v)} color="pink" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-900/40 p-8 rounded-[3.5rem] border-2 border-white/5 flex flex-col gap-6 shadow-extreme backdrop-blur-md">
                        <div className="flex items-center justify-between border-b-2 border-white/5 pb-4">
                            <div className="flex items-center gap-4">
                                <Waves className="w-6 h-6 text-amber-400" />
                                <span className="text-[14px] font-black text-amber-400 uppercase tracking-[0.4em]">RESISTOR_TAPE_SAT</span>
                            </div>
                            <input type="checkbox" checked={params.tape?.enabled} onChange={(e)=>updateMaster('tape', 'enabled', e.target.checked)} className="w-5 h-5 accent-amber-500 cursor-pointer" />
                        </div>
                        <div className="grid grid-cols-2 gap-8">
                           <MasterSlider label="DRIVE_GAIN" value={params.tape?.drive || 1.15} min={1.0} max={4.0} step={0.01} color="amber" onChange={(v:any)=>updateMaster('tape','drive',v)} />
                           <MasterSlider label="ASYM_BIAS" value={params.tape?.bias || 0.02} min={0} max={0.2} step={0.001} color="amber" onChange={(v:any)=>updateMaster('tape','bias',v)} />
                        </div>
                    </div>
                </div>

                <div className="w-44 bg-slate-950 p-8 rounded-[4rem] border-2 border-white/10 shadow-extreme flex flex-col items-center gap-8 z-10 relative">
                    <span className="text-[14px] font-black text-white tracking-[0.3em] uppercase glow-text italic">BUS_MASTER</span>
                    <div className="flex gap-5 items-center flex-1 h-full py-6">
                        <HighResVuMeter peak={stats.mPeaks[0]} rms={stats.mPeaks[0]*0.72} label="LEFT" />
                        <HighResVuMeter peak={stats.mPeaks[1]} rms={stats.mPeaks[1]*0.72} label="RIGHT" />
                    </div>
                    <div className="h-64 w-12 relative bg-slate-900 rounded-full border-2 border-white/10 overflow-hidden shadow-inner group/master-fader">
                        <input
                            type="range" min="0" max="1.5" step="0.01"
                            value={fromLin(params.output.gain)}
                            onChange={(e) => updateMaster('output', 'gain', toLin(parseFloat(e.target.value)))}
                            className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-ns-resize vertical-slider z-30 accent-cyan-400"
                            style={{ WebkitAppearance: 'slider-vertical' } as any}
                        />
                        <div className="absolute left-1/2 -translate-x-1/2 w-10 h-6 bg-slate-800 border-2 border-slate-600 rounded-lg pointer-events-none z-20 shadow-2xl transition-all group-hover/master-fader:border-white" style={{ bottom: `${(fromLin(params.output.gain) / 1.5) * 100}%` }}>
                             <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-white shadow-[0_0_15px_white]"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MixerConsole;
