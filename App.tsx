
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Activity, Cpu, Layout, Piano, Monitor, Database, Settings, Sliders, HardDrive, Terminal, Zap, Power, Volume2, Box, Shield } from 'lucide-react';
import { parseTraceFile, SidPlayer, CLOCK_PAL, midiNoteToFreq } from './services/sidService';
import { traceToTrackerProject } from './services/trackerService';
import { exportTraceToJson, exportProjectToJson } from './services/jsonExportService';
import { generateMidiFile } from './services/midiExportService';
import { generateSwmFile } from './services/swmExportService';
import { ParsedTrace, TrackerProject, EditorCursor, MasteringParams, TrackerInstrument, VWindow as VWindowType, VirtualFile, MixerParams } from './types';
import { updateOrderList, insertSequenceStep, deleteSequenceStep, setSequenceLoopPoint, transposePattern, clearPattern, updateProjectInstrument, createNewInstrument, deleteProjectInstrument, updatePatternCell, updatePatternCellHex } from './services/editorService';
import { renderProjectToTrace } from './services/projectLoaderService';
import { useTrackerInput } from './services/inputService';
import Visualizer from './components/Visualizer';
import ProtrackerMenu from './components/ProtrackerMenu';
import SwmSequenceEditor from './components/SwmSequenceEditor';
import CrtOverlay from './components/CrtOverlay';
import MidiExportEditor from './components/MidiExportEditor';
import HelpModal from './components/HelpModal';
import SettingsModal from './components/SettingsModal';
import PatternToolsModal from './components/PatternToolsModal';
import TrackerView from './components/TrackerView';
import MixerConsole from './components/MasteringMenu';
import ProtrackerInstEditor from './components/ProtrackerInstEditor';
import SidChipVisualizer from './components/SidChipVisualizer';
import NmosLogicVisualizer from './components/NmosLogicVisualizer';
import PhysicalSidVisualizer from './components/PhysicalSidVisualizer';
import AuditMonitor from './components/AuditMonitor';
import VWindow from './components/VWindow';
import SdEmulator from './components/SdEmulator';

const DesktopIcon: React.FC<{ label: string; icon: React.ReactNode; onClick: () => void; color?: string }> = ({ label, icon, onClick, color = "cyan" }) => (
    <button
        onClick={onClick}
        className="flex flex-col items-center justify-center gap-1 w-14 h-14 hover:bg-white/5 rounded-lg transition-all group active:scale-95"
    >
        <div className={`p-1.5 bg-${color}-500/10 border border-${color}-500/20 rounded-lg text-${color}-400 group-hover:border-${color}-500/50 transition-all shadow-sm`}>
            {icon}
        </div>
        <span className="text-[7px] font-black text-slate-500 tracking-tighter uppercase group-hover:text-white truncate w-full text-center">
            {label}
        </span>
    </button>
);

const CycleDisplay = memo(({ player, clockFreq }: { player: SidPlayer | null, clockFreq: number }) => {
    const cyRef = useRef<HTMLSpanElement>(null);
    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let raf = 0;
        const update = () => {
            if (player && cyRef.current && barRef.current) {
                const cy = Math.floor(player.getEstimatedCycles());
                cyRef.current.innerText = cy.toLocaleString().padStart(10, '0');
                barRef.current.style.width = `${(cy % 100000) / 1000}%`;
            }
            raf = requestAnimationFrame(update);
        };
        raf = requestAnimationFrame(update);
        return () => cancelAnimationFrame(raf);
    }, [player]);

    return (
        <div className="flex-1 flex items-center gap-4 pro-text">
            <div className="flex flex-col">
                <span className="pro-label">CLK</span>
                <span className="text-cyan-600 font-mono text-[8px]">{clockFreq === CLOCK_PAL ? 'PAL_985K' : 'NTSC_1.0M'}</span>
            </div>
            <div className="flex flex-col">
                <span className="pro-label">CYC</span>
                <span ref={cyRef} className="text-pink-600 font-mono text-[8px] tracking-tighter">0000000000</span>
            </div>
            <div className="flex-1 h-0.5 bg-slate-900 rounded-full overflow-hidden relative border border-white/5">
                <div ref={barRef} className="absolute top-0 left-0 h-full bg-cyan-500 shadow-[0_0_4px_rgba(34,211,238,0.8)]" style={{ width: '0%' }}></div>
            </div>
        </div>
    );
});

const App: React.FC = () => {
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [traceData, setTraceData] = useState<ParsedTrace | null>(null);
  const [trackerProject, setTrackerProject] = useState<TrackerProject | undefined>(undefined);
  const [isPlayingState, setIsPlayingState] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [showHex, setShowHex] = useState(false);
  const [vizMode, setVizMode] = useState<'STANDARD' | 'VECTOR' | 'FLUX'>('STANDARD');
  const [clockFreq, setClockFreq] = useState(CLOCK_PAL);
  const [sidModel, setSidModel] = useState<'6581' | '8580'>('6581');
  const [voiceMask, setVoiceMask] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [luminosity, setLuminosity] = useState(1.2);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [selectedInstId, setSelectedInstId] = useState(1);
  const [cursor, setCursor] = useState<EditorCursor>({ patternIdx: 0, row: 0, channel: 0, column: 0 });
  const [vFiles, setVFiles] = useState<VirtualFile[]>([]);
  const [activeZ, setActiveZ] = useState(100);

  const [masteringParams, setMasteringParams] = useState<MasteringParams>({
    eq: { lowGain: 1.1, highGain: 1.3, enabled: true, tilt: 0.53 },
    tape: { drive: 1.1, bias: 0.01, enabled: true },
    comp: { threshold: 0.5, ratio: 2.0, release: 0.1, enabled: true },
    exciter: { amount: 0.03, freq: 8500, enabled: true },
    reverb: { mix: 0.08, time: 350, feedback: 0.3, active: true },
    imager: { width: 1.05, enabled: true },
    limiter: { ceiling: 0.98, enabled: true },
    output: { gain: 1.0, enabled: true },
    final: { dcBlock: true, dcPole: 0.999, multiband: true, multibandMix: 0.4 },
    chorus: { enabled: true, depth: 0.3, rate: 0.5, mix: 0.15 }
  });

  const [mixerParams, setMixerParams] = useState<MixerParams>({
    voices: [
        { volume: 1.0, pan: -0.3, muted: false, solo: false },
        { volume: 1.0, pan: 0.3, muted: false, solo: false },
        { volume: 1.0, pan: 0.0, muted: false, solo: false }
    ],
    masterVolume: 1.0
  });

  const [windows, setWindows] = useState<Record<string, VWindowType>>({
      'viz': { id: 'viz', title: 'ACC_CORE_VIZ', icon: 'Activity', x: 220, y: 40, w: 550, h: 320, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 101 },
      'chip': { id: 'chip', title: 'SILICON_DIE', icon: 'Cpu', x: 780, y: 40, w: 280, h: 320, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 102 },
      'nmos': { id: 'nmos', title: 'NMOS_TRANS_LOGIC', icon: 'Zap', x: 30, y: 40, w: 180, h: 320, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 103 },
      'phys': { id: 'phys', title: 'PHYS_PACKAGE_SIM', icon: 'Box', x: 780, y: 370, w: 280, h: 280, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 104 },
      'audit': { id: 'audit', title: 'SYS_INTEGRITY_AUDIT', icon: 'Shield', x: 350, y: 200, w: 400, h: 450, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 110 },
      'tracker': { id: 'tracker', title: 'PATTERN_KERNEL', icon: 'Layout', x: 220, y: 370, w: 550, h: 280, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 105 },
      'sd': { id: 'sd', title: 'VIRT_FS', icon: 'HardDrive', x: 30, y: 370, w: 180, h: 280, isOpen: true, isMinimized: false, isMaximized: false, zIndex: 106 },
      'inst': { id: 'inst', title: 'SYNTH_ENGINE', icon: 'Piano', x: 350, y: 120, w: 600, h: 380, isOpen: false, isMinimized: false, isMaximized: false, zIndex: 107 },
      'mixer': { id: 'mixer', title: 'DSP_MIXER_RACK', icon: 'Sliders', x: 250, y: 80, w: 900, h: 520, isOpen: false, isMinimized: false, isMaximized: false, zIndex: 108 }
  });

  const [showMidiModal, setShowMidiModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPatternTools, setShowPatternTools] = useState(false);

  const playerRef = useRef<SidPlayer | null>(null);

  useEffect(() => {
      const statusPoll = setInterval(() => {
          if (playerRef.current) setIsPlayingState(playerRef.current.isPlaying);
      }, 50);
      return () => { playerRef.current?.destroy(); playerRef.current = null; clearInterval(statusPoll); };
  }, []);

  const focusWindow = (id: string) => {
      setActiveZ(z => z + 1);
      setWindows(prev => ({ ...prev, [id]: { ...prev[id], zIndex: activeZ + 1, isOpen: true, isMinimized: false } }));
  };

  const toggleMaximize = (id: string) => {
      setWindows(prev => ({ ...prev, [id]: { ...prev[id], isMaximized: !prev[id].isMaximized } }));
      if (!windows[id].isMaximized) focusWindow(id);
  };

  const enableAudio = async () => {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
        alert('This browser does not provide Web Audio support.');
        return;
    }
    try {
        const player = new SidPlayer(new AudioCtx());
        playerRef.current = player;
        await player.init();
        player.setMasteringParams(masteringParams);
        // Fix: Ensure SidPlayer correctly handles mixerParams
        player.setMixerParams(mixerParams);
        player.setVoiceMask(voiceMask);
        player.gainNode.gain.setTargetAtTime(volume, player.ctx.currentTime, 0.05);
        await player.play();
        player.pause();
        setIsAudioEnabled(true);
    } catch (error) {
        playerRef.current?.destroy();
        playerRef.current = null;
        console.error('Unable to initialize audio engine', error);
        alert('Audio initialization failed. Check browser audio permissions and try again.');
    }
  };

  const onFileUpload = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseTraceFile(text);
      if (parsed && parsed.events && parsed.events.length > 0) {
        setTraceData(parsed);
        if (playerRef.current) {
          playerRef.current.setData(parsed.events, parsed.header.clock || CLOCK_PAL);
        }
        const proj = traceToTrackerProject(parsed);
        setTrackerProject(proj);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-screen bg-[#010204] text-slate-400 overflow-hidden relative font-sans selection:bg-cyan-500/30">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.05] pointer-events-none"></div>

      {crtEnabled && <CrtOverlay />}

      {!isAudioEnabled && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 backdrop-blur-xl">
              <button
                onClick={enableAudio}
                className="group flex flex-col items-center gap-6 p-12 bg-cyan-500/5 border border-cyan-500/20 rounded-[3rem] hover:border-cyan-500/50 transition-all active:scale-95"
              >
                  <div className="p-8 bg-cyan-500/10 rounded-full border-2 border-cyan-500/40 shadow-[0_0_80px_rgba(34,211,238,0.2)] group-hover:shadow-[0_0_120px_rgba(34,211,238,0.4)] transition-all">
                      <Power className="w-16 h-16 text-cyan-400" />
                  </div>
                  <div className="flex flex-col items-center gap-2">
                      <span className="text-2xl font-black text-white tracking-[0.4em] uppercase">SYSTEM_READY</span>
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">TAP_TO_ENABLE_AUDIO_BUS</span>
                  </div>
              </button>
          </div>
      )}

      <ProtrackerMenu
        onLoad={() => focusWindow('sd')}
        onExportProject={() => exportProjectToJson(trackerProject)} onExportMidi={() => setShowMidiModal(true)} onExportSwm={() => trackerProject && generateSwmFile(trackerProject)}
        onHelp={() => setShowHelpModal(false)} onSettings={() => setShowSettingsModal(true)} onOpenMixer={() => focusWindow('mixer')} onPatternTools={() => setShowPatternTools(true)}
        viewMode="PRO_STATION" setViewMode={() => {}} vizMode={vizMode} setVizMode={setVizMode as any} crtEnabled={crtEnabled} setCrtEnabled={setCrtEnabled}
        clockFreq={clockFreq} setClockFreq={setClockFreq} lfoConfig={{enabled: false, sync: false, rate: 1, depth: 0, waveform: 'sawtooth', target: 'none'}} setLfoConfig={()=>{}}
        traceLoaded={!!traceData} isPlaying={isPlayingState} onTogglePlay={async () => {
            if (playerRef.current && isAudioEnabled) {
                isPlayingState ? playerRef.current.pause() : await playerRef.current.play();
            }
        }}
        onStop={() => { if(isAudioEnabled) { playerRef.current?.pause(); playerRef.current?.seek(0); } }}
        playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed} volume={volume} setVolume={setVolume} editorStep={1} setEditorStep={()=>{}}
        isFullscreen={false} onToggleFullscreen={() => {}} hqEnabled={true} setHqEnabled={()=>{}} onExportJson={() => exportTraceToJson(traceData)}
        onExportWav={() => alert("WAV RENDER STARTING...")}
      />

      <div className="flex-1 relative overflow-hidden">
          <div className="absolute top-4 left-4 flex flex-col gap-2 z-0">
              <DesktopIcon label="CORE_DSP" icon={<Activity className="w-4 h-4"/>} onClick={() => focusWindow('viz')} color="cyan" />
              <DesktopIcon label="SYS_AUDIT" icon={<Shield className="w-4 h-4"/>} onClick={() => focusWindow('audit')} color="blue" />
              <DesktopIcon label="SIL_DIE" icon={<Cpu className="w-4 h-4"/>} onClick={() => focusWindow('chip')} color="emerald" />
              <DesktopIcon label="NMOS_LOGIC" icon={<Zap className="w-4 h-4"/>} onClick={() => focusWindow('nmos')} color="yellow" />
              <DesktopIcon label="PHYS_SID" icon={<Box className="w-4 h-4"/>} onClick={() => focusWindow('phys')} color="purple" />
              <DesktopIcon label="KERN_SEQ" icon={<Layout className="w-4 h-4"/>} onClick={() => focusWindow('tracker')} color="pink" />
              <DesktopIcon label="SD_DISK" icon={<HardDrive className="w-4 h-4"/>} onClick={() => focusWindow('sd')} color="amber" />
              <DesktopIcon label="SYNTH_MAP" icon={<Piano className="w-4 h-4"/>} onClick={() => focusWindow('inst')} color="indigo" />
              <DesktopIcon label="DSP_MIXER" icon={<Sliders className="w-4 h-4"/>} onClick={() => focusWindow('mixer')} color="rose" />
          </div>

          {(Object.values(windows) as VWindowType[]).map((win) => {
              if (!win.isOpen || win.isMinimized) return null;
              let content = null; let icon = null;
              switch(win.id) {
                  case 'viz': icon = <Activity className="w-2.5 h-2.5"/>; content = <Visualizer player={playerRef.current} isPlaying={isPlayingState} header={traceData?.header} mode={vizMode} voiceMask={voiceMask} luminosity={luminosity} sidModel={sidModel} />; break;
                  case 'chip': icon = <Cpu className="w-2.5 h-2.5"/>; content = <SidChipVisualizer player={playerRef.current} model={sidModel} isPlaying={isPlayingState} />; break;
                  case 'nmos': icon = <Zap className="w-2.5 h-2.5"/>; content = <NmosLogicVisualizer player={playerRef.current} isPlaying={isPlayingState} />; break;
                  case 'phys': icon = <Box className="w-2.5 h-2.5"/>; content = <PhysicalSidVisualizer player={playerRef.current} isPlaying={isPlayingState} model={sidModel} />; break;
                  case 'audit': icon = <Shield className="w-2.5 h-2.5"/>; content = <AuditMonitor player={playerRef.current} isPlaying={isPlayingState} />; break;
                  case 'tracker': icon = <Layout className="w-2.5 h-2.5"/>; content = traceData ? (
                        <div className="flex h-full">
                            <div className="w-32 shrink-0 border-r border-white/5 bg-black/40">
                                {trackerProject && <SwmSequenceEditor project={trackerProject} activeStep={cursor.patternIdx} onUpdateStep={(s, p) => setTrackerProject(updateOrderList(trackerProject, s, p))} onInsert={(s) => setTrackerProject(insertSequenceStep(trackerProject, s))} onDelete={(s) => setTrackerProject(deleteSequenceStep(trackerProject, s))} onSeek={(f) => playerRef.current?.seek(f * (clockFreq/50))} onSetLoop={(s) => setTrackerProject(setSequenceLoopPoint(trackerProject, s))} />}
                            </div>
                            <div className="flex-1 min-0">
                                <TrackerView showHex={showHex} trace={traceData} player={playerRef.current} project={trackerProject} clock={clockFreq} cursor={cursor} onCursorMove={setCursor} voiceMask={voiceMask} onToggleVoice={(i) => setVoiceMask(v => { const n=[...v] as [boolean,boolean,boolean]; n[i]=!n[i]; return n; })} />
                            </div>
                        </div>
                    ) : <div className="h-full flex flex-col items-center justify-center text-slate-800 font-black tracking-widest uppercase gap-1"><Database className="w-6 h-6 opacity-10 animate-pulse"/><p className="text-[7px]">WAIT_DATA_MOUNT</p></div>; break;
                  case 'sd': icon = <HardDrive className="w-2.5 h-2.5"/>; content = <SdEmulator files={vFiles} onMount={(file) => {
                    const parsed = parseTraceFile(file.data as string);
                    if (parsed && parsed.events) {
                        setTraceData(parsed);
                        if (playerRef.current) playerRef.current.setData(parsed.events, parsed.header.clock || CLOCK_PAL);
                    }
                  }} onDelete={(id) => setVFiles(prev => prev.filter(f => f.id !== id))} onUpload={onFileUpload} />; break;
                  case 'inst': icon = <Piano className="w-2.5 h-2.5"/>; content = trackerProject ? ( <ProtrackerInstEditor instruments={trackerProject.instruments} selectedId={selectedInstId} onSelect={setSelectedInstId} onUpdate={(id, changes) => setTrackerProject(updateProjectInstrument(trackerProject, id, changes))} onTest={()=>{}} onCreate={() => setTrackerProject(createNewInstrument(trackerProject))} onDelete={(id) => setTrackerProject(deleteProjectInstrument(trackerProject, id))} /> ) : <div className="h-full flex items-center justify-center text-[7px] text-slate-700 uppercase">SYNTH_IDLE</div>; break;
                  case 'mixer': icon = <Sliders className="w-2.5 h-2.5"/>; content = <MixerConsole player={playerRef.current} params={masteringParams} onUpdate={setMasteringParams} mixerParams={mixerParams} onUpdateMixer={setMixerParams} onClose={() => setWindows(p => ({ ...p, mixer: { ...p.mixer, isOpen: false } }))} />; break;
              }
              return (
                  <VWindow key={win.id} id={win.id} title={win.title} icon={icon} initialX={win.x} initialY={win.y} initialW={win.w} initialH={win.h} zIndex={win.zIndex} isMaximized={win.isMaximized} onFocus={focusWindow} onMaximize={toggleMaximize} onMinimize={(id) => setWindows(p=>({...p, [id]:{...p[id], isMinimized: true}}))} onClose={(id) => setWindows(p=>({...p, [id]:{...p[id], isOpen: false}}))}>
                      {content}
                  </VWindow>
              );
          })}
      </div>

      <div className="h-7 bg-slate-950 border-t border-white/5 flex items-center px-2 gap-2 shrink-0 z-[500] shadow-[0_-5px_15px_rgba(0,0,0,0.5)]">
          <div className="flex gap-1 border-r border-white/10 pr-2 mr-1">
              {(Object.values(windows) as VWindowType[]).sort((a,b) => a.id.localeCompare(b.id)).map(win => (
                  <button key={win.id} onClick={() => { if (win.isOpen && !win.isMinimized && win.zIndex === activeZ) { setWindows(p => ({ ...p, [win.id]: { ...p[win.id], isMinimized: true } })); } else { focusWindow(win.id); } }} className={`h-5 w-5 flex items-center justify-center rounded border transition-all active:scale-90 ${win.isOpen && !win.isMinimized ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.2)]' : 'bg-slate-900 border-slate-800 text-slate-600'}`} title={win.title}>
                      {win.id === 'viz' && <Activity className="w-2.5 h-2.5"/>}
                      {win.id === 'chip' && <Cpu className="w-2.5 h-2.5"/>}
                      {win.id === 'nmos' && <Zap className="w-2.5 h-2.5"/>}
                      {win.id === 'phys' && <Box className="w-2.5 h-2.5"/>}
                      {win.id === 'audit' && <Shield className="w-2.5 h-2.5"/>}
                      {win.id === 'tracker' && <Layout className="w-2.5 h-2.5"/>}
                      {win.id === 'sd' && <HardDrive className="w-2.5 h-2.5"/>}
                      {win.id === 'inst' && <Piano className="w-2.5 h-2.5"/>}
                      {win.id === 'mixer' && <Sliders className="w-2.5 h-2.5"/>}
                  </button>
              ))}
          </div>
          <CycleDisplay player={playerRef.current} clockFreq={clockFreq} />
          <div className="flex items-center gap-2 pl-2 border-l border-white/10 pro-text">
              <div className="flex flex-col items-end"><span className="pro-label">BUS</span><span className="text-emerald-600 font-mono text-[8px]">HW_LOCK</span></div>
              <div className="h-4 w-4 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center animate-pulse"><Monitor className="w-2 h-2 text-emerald-500" /></div>
          </div>
      </div>

      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}
      {showMidiModal && traceData && <Modal title="MIDI_PIPE" onClose={() => setShowMidiModal(false)}><MidiExportEditor initialBpm={120} initialPpq={480} initialDuration="smart" onExport={(bpm, ppq, dur, proj, chans) => { const blob = generateMidiFile(traceData, { bpm, ppq, duration: dur, channels: chans }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([blob], { type: 'audio/midi' })); a.download = 'export.mid'; a.click(); setShowMidiModal(false); }} onClose={() => setShowMidiModal(false)} /></Modal>}
      {showSettingsModal && <Modal title="SYS_CFG" onClose={() => setShowSettingsModal(false)}><SettingsModal onClose={() => setShowSettingsModal(false)} crtEnabled={crtEnabled} setCrtEnabled={setCrtEnabled} clockFreq={clockFreq} setClockFreq={setClockFreq} luminosity={luminosity} setLuminosity={setLuminosity} sidModel={sidModel} setSidModel={setSidModel} showHex={showHex} setShowHex={setShowHex} fpsOverride={null} setFpsOverride={()=>{}} /></Modal>}
      {showPatternTools && trackerProject && <Modal title="PAT_UTIL" onClose={() => setShowPatternTools(false)}><PatternToolsModal channel={cursor.channel} onTranspose={(s, w) => setTrackerProject(transposePattern(trackerProject, trackerProject.subtunes[0].orderList[cursor.patternIdx], cursor.channel, s, w))} onClear={(w) => setTrackerProject(clearPattern(trackerProject, trackerProject.subtunes[0].orderList[cursor.patternIdx], cursor.channel, w))} onClose={() => setShowPatternTools(false)} /></Modal>}
    </div>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-2 animate-in fade-in duration-150" onClick={onClose}>
        <div className="bg-[#0b0d10] border border-slate-800 rounded-lg shadow-[0_0_80px_rgba(0,0,0,0.9)] max-w-sm w-full flex flex-col overflow-hidden ring-1 ring-white/10" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900/90 p-2 border-b border-slate-800 flex justify-between items-center shrink-0">
                <h2 className="text-cyan-400 font-black tracking-widest text-[8px] uppercase flex items-center gap-1.5"><Terminal className="w-3 h-3"/> {title}</h2>
                <button onClick={onClose} className="text-slate-500 hover:text-red-400 transition-all text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded hover:bg-red-500/10">EXIT</button>
            </div>
            <div className="p-4 overflow-y-auto custom-scrollbar">{children}</div>
        </div>
    </div>
);

export default App;
