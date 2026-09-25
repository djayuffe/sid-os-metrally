
import { ParsedTrace, TrackerProject } from '../types';
import { CLOCK_PAL, CLOCK_NTSC } from './sidService';

const MIDI_NOTE_A4 = 69;
const FREQ_A4 = 440;

export type NoteDuration = 'smart' | 'raw' | '1/4' | '1/8' | '1/16' | '1/32';

export interface MidiExportOptions {
  bpm: number;
  ppq: number;
  duration: NoteDuration;
  channels: [boolean, boolean, boolean];
}

const getSidFreq = (freqReg: number, clockFreq: number) => (freqReg * clockFreq) / 16777216;

const freqToMidiNote = (freqHz: number): number => {
  if (freqHz <= 0) return -1;
  const note = MIDI_NOTE_A4 + 12 * Math.log2(freqHz / FREQ_A4);
  return Math.round(note);
};

const calculatePitchBend = (actualFreq: number, noteFreq: number): number => {
    if (actualFreq <= 0 || noteFreq <= 0) return 8192;
    const semi = 12 * Math.log2(actualFreq / noteFreq);
    let bend = Math.round(8192 + (semi * 4096));
    return Math.max(0, Math.min(16383, bend));
};

const noteNameToMidi = (note: string): number => {
    if (!note || note === '---' || note === '===') return -1;
    const names = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
    const name = note.substring(0, 2);
    const oct = parseInt(note.substring(2));
    if (isNaN(oct)) return -1;
    const idx = names.indexOf(name);
    if (idx === -1) return -1;
    return oct * 12 + idx; // C-0 = MIDI 0
};

const writeVLQ = (value: number, bytes: number[]) => {
  let buffer = value & 0x7f;
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
};

const writeUint32 = (val: number, bytes: number[]) => {
  bytes.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
};

const writeUint16 = (val: number, bytes: number[]) => {
  bytes.push((val >> 8) & 0xFF, val & 0xFF);
};

const writeString = (str: string, bytes: number[]) => {
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
};

export const generateMidiFile = (trace: ParsedTrace, options: MidiExportOptions): Uint8Array => {
  const bpm = Number.isFinite(options?.bpm) ? Math.min(999, Math.max(1, options.bpm)) : 120;
  const ppq = Number.isInteger(options?.ppq) ? Math.min(32767, Math.max(24, options.ppq)) : 480;
  const duration = options?.duration || 'smart';
  const channels: [boolean, boolean, boolean] = [Boolean(options?.channels?.[0]), Boolean(options?.channels?.[1]), Boolean(options?.channels?.[2])];

  const isNtsc = (trace.header.clock || CLOCK_PAL) >= 1000000;
  const clockFreq = isNtsc ? CLOCK_NTSC : CLOCK_PAL;
  const fps = isNtsc ? 60 : 50;
  const ticksPerSecond = (bpm * ppq) / 60;
  const ticksPerFrame = ticksPerSecond / fps;

  let quantizeTicks = 0;
  if (duration !== 'smart' && duration !== 'raw') {
      switch(duration) {
          case '1/4': quantizeTicks = ppq; break;
          case '1/8': quantizeTicks = ppq / 2; break;
          case '1/16': quantizeTicks = ppq / 4; break;
          case '1/32': quantizeTicks = ppq / 8; break;
      }
  }

  const tracks: number[][] = [];

  for (let v = 0; v < 3; v++) {
    if (!channels[v]) continue;

    const trackBytes: number[] = [];
    let currentTick = 0;
    let lastEventTick = 0;

    let activeNote = -1;
    let activeNoteBaseFreq = 0;
    let lastGate = false;
    let lastPb = 8192;
    let lastCutoff = -1;
    let lastRes = -1;
    let lastPw = -1;
    let lastVol = -1;
    let lastMode = -1;

    writeVLQ(0, trackBytes);
    trackBytes.push(0xFF, 0x03);
    const name = `SID Voice ${v + 1}`;
    writeVLQ(name.length, trackBytes);
    writeString(name, trackBytes);

    if (tracks.length === 0) {
        writeVLQ(0, trackBytes);
        trackBytes.push(0xFF, 0x51, 0x03);
        const usPerQuarter = Math.round(60000000 / bpm);
        trackBytes.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
    }

    const regOffset = v * 7;
    let frameTickAccumulator = 0;

    for (let f = 0; f < trace.frames.length; f++) {
      const frame = trace.frames[f];
      if (!frame || frame.length < 25) continue;

      let eventTick = Math.round(frameTickAccumulator);
      frameTickAccumulator += ticksPerFrame;

      if (quantizeTicks > 0) eventTick = Math.round(eventTick / quantizeTicks) * quantizeTicks;
      if (eventTick < currentTick) eventTick = currentTick;

      const freqReg = frame[regOffset] | (frame[regOffset + 1] << 8);
      const pwReg = frame[regOffset + 2] | ((frame[regOffset + 3] & 0x0F) << 8);
      const gate = (frame[regOffset + 4] & 0x01) !== 0;
      const cutoffReg = (frame[21] | (frame[22] << 8)) & 0x7FF;

      const exactFreq = getSidFreq(freqReg, clockFreq);
      const note = freqToMidiNote(exactFreq);
      const deltaTime = eventTick - lastEventTick;

      if (gate && !lastGate) {
        if (note >= 0 && note <= 127) {
          writeVLQ(Math.max(0, deltaTime), trackBytes);
          trackBytes.push(0x90 | v, note, 100);
          lastEventTick = eventTick;
          activeNote = note;
          activeNoteBaseFreq = 440 * Math.pow(2, (note - 69) / 12);
          lastPb = 8192;
          writeVLQ(0, trackBytes);
          trackBytes.push(0xE0 | v, 0x00, 0x40);
        }
      } else if (!gate && lastGate) {
        if (activeNote !== -1) {
          writeVLQ(Math.max(0, deltaTime), trackBytes);
          trackBytes.push(0x80 | v, activeNote, 0);
          lastEventTick = eventTick;
          activeNote = -1;
        }
      } else if (gate && lastGate) {
        // Legato Slide detection enhancement
        if (note >= 0 && note <= 127 && note !== activeNote && activeNote !== -1) {
            const semiDiff = Math.abs(note - activeNote);
            const freqDiff = Math.abs(exactFreq - activeNoteBaseFreq);

            if (semiDiff > 1 || (semiDiff === 1 && freqDiff > 100)) {
                writeVLQ(Math.max(0, deltaTime), trackBytes);
                trackBytes.push(0x80 | v, activeNote, 0); // Off old
                writeVLQ(0, trackBytes);
                trackBytes.push(0x90 | v, note, 100); // On new
                lastEventTick = eventTick;
                activeNote = note;
                activeNoteBaseFreq = 440 * Math.pow(2, (note - 69) / 12);

                writeVLQ(0, trackBytes);
                trackBytes.push(0xE0 | v, 0x00, 0x40);
                lastPb = 8192;
            }
        }
      }

      const checkDelta = () => {
          const dt = eventTick - lastEventTick;
          writeVLQ(Math.max(0, dt), trackBytes);
          lastEventTick = eventTick;
      };

      if (activeNote !== -1 && gate) {
          const pb = calculatePitchBend(exactFreq, activeNoteBaseFreq);
          if (Math.abs(pb - lastPb) >= 4) {
              checkDelta();
              trackBytes.push(0xE0 | v, pb & 0x7F, (pb >> 7) & 0x7F);
              lastPb = pb;
          }
      }

      const ccCutoff = Math.floor((cutoffReg / 2047.0) * 127);
      if (ccCutoff !== lastCutoff) {
          checkDelta();
          trackBytes.push(0xB0 | v, 74, ccCutoff);
          lastCutoff = ccCutoff;
      }

      const resVal = (frame[23] >> 4) & 0x0F;
      const ccRes = Math.floor((resVal / 15) * 127);
      if (ccRes !== lastRes) {
          checkDelta();
          trackBytes.push(0xB0 | v, 71, ccRes);
          lastRes = ccRes;
      }

      const ccPw = Math.floor((pwReg / 4095) * 127);
      if (ccPw !== lastPw) {
          checkDelta();
          trackBytes.push(0xB0 | v, 70, ccPw);
          lastPw = ccPw;
      }

      const volVal = frame[24] & 0x0F;
      const ccVol = Math.floor((volVal / 15) * 127);
      if (ccVol !== lastVol) {
          checkDelta();
          trackBytes.push(0xB0 | v, 7, ccVol);
          lastVol = ccVol;
      }

      const modeVal = (frame[24] >> 4) & 0x0F;
      if (modeVal !== lastMode) {
          checkDelta();
          trackBytes.push(0xB0 | v, 80, modeVal);
          lastMode = modeVal;
      }

      lastGate = gate;
      currentTick = eventTick;
    }

    writeVLQ(Math.max(0, currentTick - lastEventTick), trackBytes);
    trackBytes.push(0xFF, 0x2F, 0x00);
    tracks.push(trackBytes);
  }

  if (tracks.length === 0) {
    const tempoTrack: number[] = [];
    writeVLQ(0, tempoTrack); tempoTrack.push(0xFF, 0x51, 0x03);
    const usPerQuarter = Math.round(60000000 / bpm);
    tempoTrack.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
    writeVLQ(0, tempoTrack); tempoTrack.push(0xFF, 0x2F, 0x00);
    tracks.push(tempoTrack);
  }
  return buildMidiFile(tracks, ppq);
};

export const generateMidiFromProject = (project: TrackerProject, options: MidiExportOptions): Uint8Array => {
    const bpm = Number.isFinite(options?.bpm) ? Math.min(999, Math.max(1, options.bpm)) : 120;
    const ppq = Number.isInteger(options?.ppq) ? Math.min(32767, Math.max(24, options.ppq)) : 480;
    const channels: [boolean, boolean, boolean] = [Boolean(options?.channels?.[0]), Boolean(options?.channels?.[1]), Boolean(options?.channels?.[2])];
    const framesPerRow = Number.isFinite(project.frameSpeed) && (project.frameSpeed || 0) > 0 ? project.frameSpeed! : 1;
    const fps = 50;
    const ticksPerSecond = (bpm * ppq) / 60;
    const ticksPerRow = Math.round((ticksPerSecond / fps) * framesPerRow);

    const tracks: number[][] = [];

    for (let ch = 0; ch < 3; ch++) {
        if (!channels[ch]) continue;

        const trackBytes: number[] = [];
        let currentTick = 0;
        let lastEventTick = 0;
        let activeNote = -1;

        writeVLQ(0, trackBytes);
        trackBytes.push(0xFF, 0x03);
        const name = `Channel ${ch + 1}`;
        writeVLQ(name.length, trackBytes);
        writeString(name, trackBytes);

        if (tracks.length === 0) {
            writeVLQ(0, trackBytes);
            trackBytes.push(0xFF, 0x51, 0x03);
            const usPerQuarter = Math.round(60000000 / bpm);
            trackBytes.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
        }

        const orderList = project.subtunes[0]?.orderList || [];
        for (const patId of orderList) {
            const pattern = project.patterns.find(p => p.id === patId);
            if (!pattern) {
                currentTick += ticksPerRow * 64;
                continue;
            }

            for (let r = 0; r < 64; r++) {
                const row = (pattern.rows && pattern.rows[r] && pattern.rows[r][ch])
                    ? pattern.rows[r][ch]
                    : { note: '---', inst: 0, vol: '..', cmd: '...', val: '..' };
                const eventTick = currentTick;
                const deltaTime = eventTick - lastEventTick;

                if (row) {
                    const midiNote = noteNameToMidi(row.note);
                    if (midiNote !== -1) {
                        writeVLQ(Math.max(0, deltaTime), trackBytes);
                        if (activeNote !== -1) {
                            trackBytes.push(0x80 | ch, activeNote, 0);
                            trackBytes.push(0x00);
                        }
                        trackBytes.push(0x90 | ch, midiNote, 100);
                        lastEventTick = eventTick;
                        activeNote = midiNote;
                    } else if (row.note === '===') {
                        if (activeNote !== -1) {
                            writeVLQ(Math.max(0, deltaTime), trackBytes);
                            trackBytes.push(0x80 | ch, activeNote, 0);
                            lastEventTick = eventTick;
                            activeNote = -1;
                        }
                    }
                }
                currentTick += ticksPerRow;
            }
        }

        if (activeNote !== -1) {
            const dt = currentTick - lastEventTick;
            writeVLQ(Math.max(0, dt), trackBytes);
            trackBytes.push(0x80 | ch, activeNote, 0);
            lastEventTick = currentTick;
        }

        writeVLQ(Math.max(0, currentTick - lastEventTick), trackBytes);
        trackBytes.push(0xFF, 0x2F, 0x00);
        tracks.push(trackBytes);
    }

    if (tracks.length === 0) {
        const tempoTrack: number[] = [];
        writeVLQ(0, tempoTrack); tempoTrack.push(0xFF, 0x51, 0x03);
        const usPerQuarter = Math.round(60000000 / bpm);
        tempoTrack.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
        writeVLQ(0, tempoTrack); tempoTrack.push(0xFF, 0x2F, 0x00);
        tracks.push(tempoTrack);
    }
    return buildMidiFile(tracks, ppq);
};

const buildMidiFile = (tracks: number[][], ppq: number): Uint8Array => {
    const fileBytes: number[] = [];
    writeString("MThd", fileBytes);
    writeUint32(6, fileBytes);
    writeUint16(1, fileBytes);
    writeUint16(tracks.length, fileBytes);
    writeUint16(ppq, fileBytes);

    tracks.forEach(track => {
        writeString("MTrk", fileBytes);
        writeUint32(track.length, fileBytes);
        fileBytes.push(...track);
    });
    return new Uint8Array(fileBytes);
};
