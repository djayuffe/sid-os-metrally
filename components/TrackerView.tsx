import React, { memo, useRef, useEffect, useMemo, useState } from 'react';
import { ParsedTrace, TrackerProject, EditorCursor, TrackerRow as TrackerRowType, SidEvent } from '../types';
import { getNoteName, generateWaveformPoints, SidPlayer } from '../services/sidService';
import { Layout, Monitor, Database, Shield, Zap, Maximize2, Cpu } from 'lucide-react';

const REG_LABELS: Record<number, string> = {
    0x00: "V1_FREQ_LO", 0x01: "V1_FREQ_HI", 0x02: "V1_PW_LO", 0x03: "V1_PW_HI",
    0x04: "V1_CTRL", 0x05: "V1_AD", 0x06: "V1_SR",
    0x07: "V2_FREQ_LO", 0x08: "V2_FREQ_HI", 0x09: "V2_PW_LO", 0x0A: "V2_PW_HI",
    0x0B: "V2_CTRL", 0x0C: "V2_AD", 0x0D: "V2_SR",
    0x0E: "V3_FREQ_LO", 0x0F: "V3_FREQ_HI", 0x10: "V3_PW_LO", 0x11: "V3_PW_HI",
    0x12: "V3_CTRL", 0x13: "V3_AD", 0x14: "V3_SR",
    0x15: "FLT_CUT_LO", 0x16: "FLT_CUT_HI", 0x17: "FLT_RES_RT", 0x18: "FLT_MODE_VOL",
    0x1B: "OSC3_READ", 0x1C: "ENV3_READ"
};

function binarySearchEvents(events: SidEvent[], targetCycles: number): number {
    let low = 0, high = events.length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid].cycles < targetCycles) low = mid + 1;
        else if (events[mid].cycles > targetCycles) high = mid - 1;
        else return mid;
    }
    return low;
}

const MicroScope = memo(({ regs, vIdx, color }: { regs: Uint8Array | number[] | null, vIdx: number, color: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !regs) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const off = vIdx * 7;
        const ctrl = regs[off+4];
        const pw = regs[off+2] | ((regs[off+3] & 0x0F) << 8);
        const freq = regs[off] | (regs[off+1] << 8);
        const points = generateWaveformPoints(ctrl, pw, freq, 40, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath(); ctx.lineWidth = 2.5; ctx.strokeStyle = color;
        points.forEach((p, i) => {
            const x = (i / points.length) * canvas.width;
            const y = canvas.height / 2 - (p * canvas.height / 2 * 0.85);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }, [regs, vIdx, color]);
    return <canvas ref={canvasRef} width={50} height={18} className="bg-black/60 rounded border border-slate-800" />;
});

const TrackerRow = memo(({
    rowIndex, displayIndex, regs, rowData, isCurrent, clock, isProject, cursor, patternIndex, onCursorMove, voiceMask, showHex
}: any) => {
    const h = (v: number, pad: number = 2) => v.toString(16).toUpperCase().padStart(pad, '0');

    const renderVoice = (colorClass: string, vIdx: number) => {
        const isMuted = voiceMask && !voiceMask[vIdx];
        const mutedClass = isMuted ? 'opacity-10 grayscale' : '';
        const bgGlow = isCurrent ? (vIdx === 0 ? 'bg-cyan-500/10' : vIdx === 1 ? 'bg-pink-500/10' : 'bg-amber-500/10') : '';

        let d = rowData?.[vIdx];
        if (!d && regs && regs.length >= 25) {
            const off = vIdx * 7;
            const freq = regs[off] | (regs[off+1] << 8);
            const ctrl = regs[off+4];
            const ad = regs[off+5];
            const sr = regs[off+6];
            const noteName = getNoteName(freq, clock);
            d = {
                note: (ctrl & 1) ? noteName : (noteName !== '---' ? '===' : '---'),
                inst: ctrl, vol: h(ad), cmd: h(sr >> 4, 1), val: h(sr & 0x0F, 1).padStart(2, '0')
            };
        }

        if (d) {
            const isCursorRow = cursor && patternIndex !== undefined && cursor.patternIdx === patternIndex && cursor.row === rowIndex;
            const isCursorVoice = isCursorRow && cursor?.channel === vIdx;

            return (
                <div className={`flex items-center gap-2 border-r border-slate-800/40 pr-3 font-mono h-full transition-all ${bgGlow} ${mutedClass}`}>
                    <span onClick={() => patternIndex !== undefined && onCursorMove?.({ patternIdx: patternIndex, row: rowIndex, channel: vIdx, column: 0 })}
                        className={`w-12 cursor-pointer text-center transition-all ${d.note === '---' ? 'text-slate-800' : d.note === '===' ? 'text-slate-600' : `${colorClass} font-black font-2xl`} ${isCursorVoice && cursor?.column===0 ? 'bg-cyan-500 text-black shadow-[0_0_12px_cyan] rounded-sm' : ''}`}>{d.note}</span>
                    <span className={`w-7 text-center ${d.inst > 0 ? colorClass : 'text-slate-800/50'}`}>{d.inst > 0 ? h(d.inst, 2) : '..'}</span>
                    <span className={`w-7 text-center ${d.vol !== '..' ? 'text-emerald-500' : 'text-slate-800/50'}`}>{d.vol}</span>
                    <span className={`w-4 text-center ${d.cmd !== '...' ? 'text-amber-500' : 'text-slate-800/50'}`}>{d.cmd === '...' ? '.' : d.cmd}</span>
                    <span className={`w-7 text-center ${d.val !== '..' ? 'text-amber-400' : 'text-slate-800/50'}`}>{d.val}</span>
                </div>
            );
        }
        return <div className="w-[150px] text-slate-900 font-black">--- .. .. . ..</div>;
    };

    return (
        <div className={`flex items-center font-mono text-[10px] h-full transition-all duration-100 px-3 border-l-4 ${isCurrent ? 'bg-cyan-500/15 border-cyan-500 shadow-[0_0_40px_rgba(34,211,238,0.15)] scale-[1.03] z-40' : 'hover:bg-slate-800/10 border-transparent'}`}>
             <div className={`w-14 text-right border-r border-slate-800 pr-4 mr-4 ${isCurrent ? 'text-cyan-400 font-black scale-110' : 'text-slate-700'}`}>{h(displayIndex, isProject ? 2 : 4)}</div>
             <div className="flex gap-5 h-full items-center">
                 {renderVoice('text-cyan-400', 0)}
                 {renderVoice('text-pink-400', 1)}
                 {renderVoice('text-amber-400', 2)}
             </div>
        </div>
    );
});

interface TrackerViewProps {
  trace: ParsedTrace;
  player: SidPlayer | null;
  project?: TrackerProject;
  clock: number;
  cursor: EditorCursor;
  onCursorMove: (c: EditorCursor) => void;
  voiceMask: [boolean, boolean, boolean];
  onToggleVoice: (i: number) => void;
  showHex: boolean;
}

const TrackerView: React.FC<TrackerViewProps> = memo(({ trace, player, project, clock, cursor, onCursorMove, voiceMask, onToggleVoice, showHex }) => {
    const [currentCycles, setCurrentCycles] = useState(0);
    const [currentFrame, setCurrentFrame] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const ROW_HEIGHT = 22;

    useEffect(() => {
        let raf = 0;
        const update = () => {
            if (player) {
                const cy = player.getEstimatedCycles();
                const frame = Math.floor(cy / (clock / 50));
                setCurrentCycles(cy);
                setCurrentFrame(frame);
            }
            raf = requestAnimationFrame(update);
        };
        raf = requestAnimationFrame(update);
        return () => cancelAnimationFrame(raf);
    }, [player, clock]);

    const visibleEvents = useMemo(() => {
        const events = trace.events;
        const endIndex = binarySearchEvents(events, currentCycles);
        return events.slice(Math.max(0, endIndex - 50), endIndex);
    }, [trace.events, currentCycles]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [visibleEvents.length]);

    const speed = project?.frameSpeed || 6;
    const currentRowGlobal = Math.floor(currentFrame / speed);
    const rows = [];
    const rowRange = 30;

    for (let i = -rowRange; i <= rowRange; i++) {
        const target = currentRowGlobal + i;
        const isProjectMode = !!project;
        const maxRows = isProjectMode ? (project.subtunes[0].orderList.length * 64) : trace.frames.length;
        if (target < 0 || target >= maxRows) continue;

        let rowData: TrackerRowType[] | null = null;
        let regs: Uint8Array | number[] | null = null;
        let displayIndex = target;
        let rowInPattern = 0;
        let patternIdxInOrderList = -1;

        if (isProjectMode) {
            patternIdxInOrderList = Math.floor(target / 64);
            rowInPattern = target % 64;
            const patId = project.subtunes[0].orderList[patternIdxInOrderList];
            const pattern = project.patterns.find(p => p.id === patId);
            if (pattern) rowData = pattern.rows[rowInPattern];
            displayIndex = rowInPattern;
            const approxFrame = target * speed;
            if (approxFrame < trace.frames.length) regs = trace.frames[approxFrame];
        } else {
            regs = trace.frames[target];
        }

        rows.push(
            <div key={target} className="absolute w-full" style={{ top: '50%', marginTop: `${i * ROW_HEIGHT - ROW_HEIGHT/2}px`, height: `${ROW_HEIGHT}px` }}>
                <TrackerRow
                    rowIndex={isProjectMode ? rowInPattern : target}
                    displayIndex={displayIndex}
                    regs={regs}
                    rowData={rowData}
                    isCurrent={i === 0}
                    clock={clock}
                    isProject={isProjectMode}
                    cursor={cursor}
                    patternIndex={isProjectMode ? patternIdxInOrderList : undefined}
                    onCursorMove={onCursorMove}
                    voiceMask={voiceMask}
                    showHex={showHex}
                />
            </div>
        );
    }

    const currentRegs: Uint8Array | number[] = trace.frames[currentFrame] || new Array(25).fill(0);
    const osc3 = player?.volatileRegs[0x1B] || 0;
    const env3 = player?.volatileRegs[0x1C] || 0;

    return (
        <div ref={containerRef} className="flex h-full bg-[#010204] overflow-hidden select-none font-mono group/full gpu-sync">
            <div className="flex-1 flex flex-col border-r border-slate-800 min-w-0">
                <div className="h-10 bg-slate-900/95 flex items-center px-4 border-b border-slate-800 justify-between shrink-0 shadow-lg z-20">
                    <div className="flex items-center gap-4">
                        <div className="bg-cyan-500/20 p-1.5 rounded-lg border border-cyan-500/40">
                            <Layout className="w-4 h-4 text-cyan-400 animate-pulse" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[11px] font-black text-white uppercase tracking-[0.3em]">SIM_CORE_ARRAY</span>
                            <span className="text-[7px] text-cyan-600 font-bold uppercase -mt-0.5">BUS_ADDRESS_SPACE_MAPPED</span>
                        </div>
                    </div>

                    {/* Real-time Read-Back Registers */}
                    <div className="flex gap-4 items-center bg-black/40 px-4 py-1 rounded-full border border-white/5">
                        <div className="flex flex-col">
                            <span className="text-[6px] text-slate-500 uppercase font-black tracking-widest">OSC3_READ</span>
                            <span className="text-[10px] text-cyan-400 font-mono font-black">${osc3.toString(16).toUpperCase().padStart(2,'0')}</span>
                        </div>
                        <div className="w-px h-4 bg-white/10"></div>
                        <div className="flex flex-col">
                            <span className="text-[6px] text-slate-500 uppercase font-black tracking-widest">ENV3_READ</span>
                            <span className="text-[10px] text-pink-400 font-mono font-black">${env3.toString(16).toUpperCase().padStart(2,'0')}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {[0,1,2].map(i => (
                            <div key={i} className="flex items-center gap-2 bg-black/60 px-3 py-1 rounded-lg border border-white/5 shadow-inner">
                                <MicroScope regs={currentRegs} vIdx={i} color={['#22d3ee', '#f472b6', '#fbbf24'][i]} />
                                <button onClick={() => onToggleVoice?.(i)} className={`text-[9px] font-black w-10 h-5 flex items-center justify-center rounded transition-all ${voiceMask?.[i] ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-500/50 shadow-[0_0_12px_cyan]' : 'bg-slate-800 text-slate-600 border border-slate-700'}`}>CH{i+1}</button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex-1 relative overflow-hidden bg-[radial-gradient(circle_at_top,rgba(15,23,42,1)_0%,rgba(2,6,23,1)_100%)]">
                    <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#22d3ee 1px, transparent 1px)', backgroundSize: '100% 22px' }}></div>
                    <div className="absolute top-1/2 left-0 right-0 h-8 -mt-4 bg-cyan-500/20 border-y border-cyan-500/40 pointer-events-none z-10 shadow-[0_0_40px_rgba(34,211,238,0.2)]"></div>
                    <div className="relative h-full">{rows}</div>
                </div>
            </div>

            <div className="w-[340px] flex flex-col bg-[#020306] shrink-0 border-l border-slate-800/80 shadow-2xl overflow-hidden relative">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_right,rgba(16,185,129,0.03)_0%,transparent_70%)] pointer-events-none"></div>
                <div className="h-10 bg-slate-900/95 flex items-center px-4 border-b border-slate-800 gap-4 shrink-0 shadow-lg z-20">
                    <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                        <Monitor className="w-4 h-4 text-emerald-500 animate-pulse" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-white uppercase tracking-[0.2em]">REGISTER_STREAM</span>
                        <span className="text-[7px] text-emerald-600 font-bold uppercase -mt-0.5">IO_PORT_ACTIVITY_LOG</span>
                    </div>
                </div>
                <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1 font-mono text-[10px] bg-[linear-gradient(rgba(16,185,129,0.02)_1px,transparent_1px)] bg-[size:100%_24px]">
                    {visibleEvents.map((e, idx) => {
                        const isRecent = idx > visibleEvents.length - 8;
                        const label = REG_LABELS[e.reg] || `ADDR_$${e.reg.toString(16).toUpperCase()}`;
                        return (
                            <div key={`${e.cycles}-${idx}`} className={`flex items-center gap-4 py-1 rounded px-2 transition-all ${isRecent ? 'bg-emerald-500/5 border border-emerald-500/10 translate-x-1' : 'opacity-40'}`}>
                                <span className={`text-[8px] font-black w-14 ${isRecent ? 'text-emerald-400' : 'text-emerald-900'}`}>{e.cycles.toString().slice(-6)}</span>
                                <div className="flex items-center gap-2 flex-1">
                                    <Zap className={`w-2 h-2 ${isRecent ? 'text-amber-400' : 'text-slate-800'}`} />
                                    <span className={`truncate font-black tracking-tight ${isRecent ? 'text-white' : 'text-slate-700'}`}>{label}</span>
                                </div>
                                <span className={`font-black bg-black border px-1.5 rounded ${isRecent ? 'text-cyan-400 border-cyan-500/40 shadow-[0_0_8px_cyan]' : 'text-emerald-950 border-white/5'}`}>${e.val.toString(16).toUpperCase().padStart(2, '0')}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

export default TrackerView;
