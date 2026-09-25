
import { TrackerProject, ParsedTrace, TrackerRow, SidHeader, TrackerInstrument } from '../types';
import { midiNoteToFreq } from './sidService';

export const validateProject = (json: unknown): TrackerProject => {
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error("Invalid project JSON");
    const input = json as Record<string, unknown>;
    const isNibble = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 15;

    if (Array.isArray(input.instruments)) {
        input.instruments.forEach((inst: unknown, idx: number) => {
            if (!inst || typeof inst !== 'object' || Array.isArray(inst)) throw new Error(`Instrument ${idx}: expected an object`);
            const instrument = inst as Record<string, unknown>;
            for (const field of ['attack', 'decay', 'sustain', 'release']) {
                if (!isNibble(instrument[field])) {
                    throw new Error(`Instrument ${idx}: ${field} must be an integer from 0 to 15`);
                }
            }
        });
    }

    const project: TrackerProject = {
        meta: {
            title: typeof (input.meta as Record<string, unknown> | undefined)?.title === 'string' ? (input.meta as Record<string, string>).title : "Untitled",
            author: typeof (input.meta as Record<string, unknown> | undefined)?.author === 'string' ? (input.meta as Record<string, string>).author : "Unknown",
            released: typeof (input.meta as Record<string, unknown> | undefined)?.released === 'string' ? (input.meta as Record<string, string>).released : ""
        },
        instruments: Array.isArray(input.instruments) ? input.instruments as TrackerProject['instruments'] : [],
        patterns: Array.isArray(input.patterns) ? input.patterns as TrackerProject['patterns'] : [],
        subtunes: Array.isArray(input.subtunes) ? input.subtunes as TrackerProject['subtunes'] : [],
        chordTable: Array.isArray(input.chordTable) ? input.chordTable as TrackerProject['chordTable'] : [],
        tempoTable: Array.isArray(input.tempoTable) ? input.tempoTable as TrackerProject['tempoTable'] : [],
        frameSpeed: typeof input.frameSpeed === 'number' && Number.isFinite(input.frameSpeed) && input.frameSpeed > 0 ? Math.min(64, Math.max(1, Math.floor(input.frameSpeed))) : 6
    };
    if (project.instruments.length === 0) {
        project.instruments.push({
            id: 1, name: "DEFAULT", attack: 0, decay: 0, sustain: 15, release: 0,
            waveform: 0x10, pulseWidth: 2048, hardRestart: false
        });
    }
    if (project.subtunes.length === 0) {
        project.subtunes.push({ id: 0, tempo: 6, orderList: [0] });
    }
    return project;
};

export const renderProjectToTrace = (project: TrackerProject, clock: number): ParsedTrace => {
    // Fixed: Initialized frames as Uint8Array[] to match ParsedTrace definition
    const frames: Uint8Array[] = [];
    const events: any[] = [];
    const speed = Number.isFinite(project.frameSpeed) && (project.frameSpeed || 0) > 0 ? Math.min(64, Math.max(1, Math.floor(project.frameSpeed!))) : 6;
    const subtune = project.subtunes[0] || { id: 0, tempo: 6, orderList: [] };

    const channels = [0, 1, 2].map(() => ({
        activeInstId: 0, note: -1, freq: 0, targetFreq: 0, glideSpeed: 0, gate: false, hrTimer: 0,
        pw: 0, waveformOverride: -1, arpeggioX: 0, arpeggioY: 0
    }));

    let cutoff = 0, resonance = 0, filterMode = 0, volume = 15, filterRoute = 0;

    const pushFrame = (frameInRow: number, globalCycle: number) => {
        const regs = new Array(25).fill(0);
        channels.forEach((ch, i) => {
            const off = i * 7;
            const inst = project.instruments.find(ins => ins.id === ch.activeInstId);

            // Handle Portamento Glide
            if (ch.glideSpeed > 0 && Math.abs(ch.freq - ch.targetFreq) > ch.glideSpeed) {
                if (ch.freq < ch.targetFreq) ch.freq += ch.glideSpeed;
                else ch.freq -= ch.glideSpeed;
            } else if (ch.glideSpeed > 0) {
                ch.freq = ch.targetFreq;
            }

            // Handle Arpeggio (Simple 3-note cycle)
            let effectiveFreq = ch.freq;
            if ((ch.arpeggioX || ch.arpeggioY) && frameInRow > 0) {
                const step = frameInRow % 3;
                const baseMidi = Math.round(69 + 12 * Math.log2((ch.freq * clock) / 16777216 / 440));
                if (step === 1 && ch.arpeggioX) effectiveFreq = midiNoteToFreq(baseMidi + ch.arpeggioX, clock);
                else if (step === 2 && ch.arpeggioY) effectiveFreq = midiNoteToFreq(baseMidi + ch.arpeggioY, clock);
            }

            if (inst) {
                const isHrActive = ch.hrTimer > 0;
                regs[off + 5] = isHrActive ? 0x0F : (inst.attack << 4) | inst.decay;
                regs[off + 6] = isHrActive ? 0x00 : (inst.sustain << 4) | inst.release;
                regs[off + 2] = ch.pw & 0xFF;
                regs[off + 3] = (ch.pw >> 8) & 0x0F;
                let wf = ch.waveformOverride !== -1 ? ch.waveformOverride : inst.waveform;
                if (ch.gate && !isHrActive) wf |= 0x01; else wf &= 0xFE;
                regs[off + 4] = wf;
            }
            regs[off] = effectiveFreq & 0xFF;
            regs[off + 1] = (effectiveFreq >> 8) & 0xFF;
            if (ch.hrTimer > 0) ch.hrTimer--;
        });
        regs[21] = cutoff & 0xFF; regs[22] = (cutoff >> 8) & 0xFF;
        regs[23] = ((resonance & 0xF) << 4) | (filterRoute & 0x0F);
        regs[24] = ((filterMode & 0xF) << 4) | (volume & 0x0F);

        // Fixed: converted regs array to Uint8Array before pushing to frames
        frames.push(new Uint8Array(regs));
        // Map regs to cycle-accurate events for the player
        for(let r=0; r<25; r++) {
            events.push({ cycles: globalCycle, reg: r, val: regs[r] });
        }
    };

    let cyclesAccumulator = 0;
    const cyclesPerFrame = clock / 50;

    for (const patId of (Array.isArray(subtune.orderList) ? subtune.orderList : [])) {
        const pattern = project.patterns.find(p => p.id === patId);
        for (let r = 0; r < 64; r++) {
            const rowData = pattern ? pattern.rows[r] : null;
            if (rowData) {
                rowData.forEach((cell, chIdx) => {
                    const ch = channels[chIdx];
                    if (!ch || !cell || typeof cell.note !== 'string') return;
                    if (cell.inst > 0) {
                        ch.activeInstId = cell.inst;
                        const inst = project.instruments.find(i => i.id === cell.inst);
                        if (inst) ch.pw = inst.pulseWidth;
                    }
                    if (cell.note === '===') ch.gate = false;
                    else if (cell.note !== '---') {
                        const notes = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
                        const midi = (parseInt(cell.note.substring(2))+1)*12 + notes.indexOf(cell.note.substring(0,2));
                        if (midi < 0 || !Number.isFinite(midi)) return;
                        const newFreq = midiNoteToFreq(midi, clock);
                        if (cell.cmd === '1' || cell.cmd === '2' || cell.cmd === '3') {
                            ch.targetFreq = newFreq;
                            ch.glideSpeed = parseInt(cell.val, 16) || 10;
                        } else {
                            ch.freq = newFreq;
                            ch.glideSpeed = 0;
                            ch.gate = true;
                            const inst = project.instruments.find(i => i.id === ch.activeInstId);
                            if (inst?.hardRestart) ch.hrTimer = 1;
                        }
                    }
                    const val = parseInt(cell.val, 16) || 0;
                    if (cell.cmd === 'F') cutoff = Math.round((val / 255) * 2047);
                    if (cell.cmd === 'C') volume = val & 0xF;
                    if (cell.cmd === 'W') ch.waveformOverride = (val & 0xF) << 4;
                    if (cell.cmd === '0') { ch.arpeggioX = (val >> 4); ch.arpeggioY = (val & 0xF); }
                });
            }
            for(let s=0; s<speed; s++) {
                pushFrame(s, Math.floor(cyclesAccumulator));
                cyclesAccumulator += cyclesPerFrame;
            }
        }
    }

    return { header: { clock, song: project.meta.title }, frames, events };
};
