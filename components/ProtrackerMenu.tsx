
import React, { useState } from 'react';
import { Upload, Binary, Sliders, Monitor, HelpCircle, Play, Pause, Square, Disc, Settings, Volume2, Eye, Power } from 'lucide-react';
import { CLOCK_PAL, CLOCK_NTSC } from '../services/sidService';

interface ProtrackerMenuProps {
  onLoad: () => void;
  onExportJson: () => void;
  onExportProject: () => void;
  onExportSwm: () => void;
  onExportWav: () => void;
  onExportMidi: () => void;
  onHelp: () => void;
  onSettings: () => void;
  onPatternTools: () => void;
  onShutdown: () => void;
  onOpenMixer: () => void;
  vizMode: string;
  setVizMode: (m: 'STANDARD' | 'VECTOR' | 'FLUX') => void;
  crtEnabled: boolean;
  setCrtEnabled: (v: boolean) => void;
  clockFreq: number;
  setClockFreq: (f: number) => void;
  traceLoaded: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  playbackSpeed: number;
  setPlaybackSpeed: (s: number) => void;
  volume: number;
  setVolume: (v: number) => void;
}

const PtButton: React.FC<{ label: string, active?: boolean, onClick: () => void, icon?: React.ReactNode, disabled?: boolean, sub?: string }> = ({ label, active, onClick, icon, disabled, sub }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`
            relative h-8 px-2 flex flex-col items-center justify-center border-b transition-all active:border-b-0 active:translate-y-[0.5px] rounded
            ${active
                ? 'bg-cyan-500 text-black border-cyan-700'
                : 'bg-slate-900 border-black text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            }
            ${disabled ? 'opacity-20 cursor-not-allowed grayscale' : ''}
        `}
    >
        <div className="flex items-center gap-1.5 font-black text-[7px] tracking-widest uppercase text-nowrap">
            {icon && <span className={active ? 'text-black' : 'text-cyan-600'}>{icon}</span>}
            {label}
        </div>
        {sub && <div className={`text-[6px] font-black mt-0.5 ${active ? 'text-cyan-900' : 'text-slate-600'}`}>{sub}</div>}
    </button>
);

const PtGroup: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
    <div className="bg-black/30 border border-white/5 p-0.5 flex gap-1 relative pt-2.5 rounded-md">
        <div className="absolute top-0 left-1.5 px-1 text-[5px] text-slate-600 font-black uppercase tracking-widest">{label}</div>
        {children}
    </div>
);

const ProtrackerMenu: React.FC<ProtrackerMenuProps> = (props) => {
    const [vizMenuOpen, setVizMenuOpen] = useState(false);
    const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);

    return (
        <div className="w-full bg-[#0a0c10] border-b border-white/5 select-none flex flex-col shadow-xl relative z-[1000]">
            <div className="h-5 bg-slate-950 flex items-center justify-between px-3 text-[7px] font-mono text-slate-800">
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${props.isPlaying ? 'bg-red-500 animate-pulse' : 'bg-slate-900'}`}></div>
                    <span className="font-black tracking-[0.4em] uppercase">KERN_V6_DEV::<span className="text-cyan-950">HW_SYNK</span></span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="tracking-widest opacity-30">BUS_NATIVE_1.2</span>
                    <span className={props.isPlaying ? "text-emerald-950 font-black" : "opacity-20"}>{props.isPlaying ? "LINK_SYNC_ACTIVE" : "LINK_STANDBY"}</span>
                </div>
            </div>

            <div className="p-1 flex flex-wrap gap-1.5 items-center">
                <PtGroup label="DISK">
                    <PtButton label="LOAD" icon={<Upload className="w-2.5 h-2.5"/>} onClick={props.onLoad} />
                    <PtButton label="SAVE" icon={<Binary className="w-2.5 h-2.5"/>} onClick={props.onExportProject} />
                    <PtButton label="MIDI" onClick={props.onExportMidi} />
                    <PtButton label="SWM" onClick={props.onExportSwm} />
                </PtGroup>

                <PtGroup label="KERN">
                    <div className="relative">
                        <PtButton label="VIZ" icon={<Eye className="w-2.5 h-2.5"/>} onClick={() => setVizMenuOpen(!vizMenuOpen)} sub={props.vizMode} />
                        {vizMenuOpen && (
                            <div className="absolute top-full left-0 mt-0.5 w-24 bg-slate-950 border border-white/5 shadow-2xl p-0.5 z-[2000] flex flex-col gap-0.5 rounded animate-in fade-in slide-in-from-top-1">
                                {['STANDARD', 'VECTOR', 'FLUX'].map(m => (
                                    <button
                                        key={m}
                                        onClick={() => { props.setVizMode(m as any); setVizMenuOpen(false); }}
                                        className={`px-2 py-1 text-[7px] font-black text-left hover:bg-slate-900 transition-all rounded ${props.vizMode === m ? 'text-cyan-500 bg-cyan-500/5' : 'text-slate-700'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <PtButton label="CRT" icon={<Monitor className="w-2.5 h-2.5"/>} active={props.crtEnabled} onClick={() => props.setCrtEnabled(!props.crtEnabled)} />
                    <PtButton label="MIX" icon={<Sliders className="w-2.5 h-2.5"/>} onClick={props.onOpenMixer} />
                </PtGroup>

                <PtGroup label="LINK">
                    <PtButton label="" icon={<Square className="w-2.5 h-2.5 fill-current"/>} onClick={props.onStop} disabled={!props.traceLoaded} />
                    <PtButton label={props.isPlaying ? "PAUSE" : "PLAY"} active={props.isPlaying} icon={props.isPlaying ? <Pause className="w-2.5 h-2.5 fill-current"/> : <Play className="w-2.5 h-2.5 fill-current"/>} onClick={props.onTogglePlay} disabled={!props.traceLoaded} />
                    <PtButton label="WAV" icon={<Disc className="w-2.5 h-2.5 text-red-800 fill-current"/>} onClick={props.onExportWav} disabled={!props.traceLoaded} />
                    <PtButton label="SPD" sub={`${props.playbackSpeed.toFixed(2)}x`} onClick={() => {
                        const next = props.playbackSpeed >= 2 ? 0.5 : Math.min(2, props.playbackSpeed + 0.5);
                        props.setPlaybackSpeed(next);
                    }} />
                </PtGroup>

                <div className="flex-1"></div>

                <PtGroup label="HOST">
                    <PtButton label={props.clockFreq === CLOCK_PAL ? "PAL" : "NTSC"} onClick={() => props.setClockFreq(props.clockFreq === CLOCK_PAL ? CLOCK_NTSC : CLOCK_PAL)} />
                    <div className="relative">
                        <PtButton label="VOL" icon={<Volume2 className="w-2.5 h-2.5"/>} onClick={() => setVolumeMenuOpen(!volumeMenuOpen)} sub={`${Math.round(props.volume * 100)}%`} />
                        {volumeMenuOpen && (
                            <div className="absolute top-full right-0 mt-0.5 w-8 bg-slate-950 border border-white/5 shadow-2xl p-2 z-[2000] flex flex-col items-center h-32 rounded">
                                <input
                                    type="range" min="0" max="1" step="0.01" value={props.volume}
                                    onChange={(e) => props.setVolume(parseFloat(e.target.value))}
                                    className="h-full appearance-none bg-slate-800 w-1 rounded-full cursor-pointer accent-cyan-500"
                                    style={{ writingMode: 'bt-lr', WebkitAppearance: 'slider-vertical' } as any}
                                />
                                <button onClick={() => setVolumeMenuOpen(false)} className="absolute inset-0 z-[-1]" />
                            </div>
                        )}
                    </div>
                    <PtButton label="CFG" icon={<Settings className="w-2.5 h-2.5"/>} onClick={props.onSettings} />
                    <PtButton label="HELP" icon={<HelpCircle className="w-2.5 h-2.5"/>} onClick={props.onHelp} />
                    <button onClick={props.onShutdown} className="h-8 w-8 flex items-center justify-center bg-red-950/20 border border-red-900/30 rounded text-red-800 hover:text-red-500 transition-colors" title="Shut Down" aria-label="Shut down audio bus"><Power className="w-3.5 h-3.5"/></button>
                </PtGroup>
            </div>
        </div>
    );
};

export default ProtrackerMenu;
