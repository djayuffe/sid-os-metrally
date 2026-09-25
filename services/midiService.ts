
import { ParsedTrace } from '../types';

// --- Constants ---
const CLOCK_PAL = 985248;
const CLOCK_NTSC = 1022727;
const MIDI_NOTE_A4 = 69;
const FREQ_A4 = 440;

export type NoteDuration = 'smart' | 'raw' | '1/4' | '1/8' | '1/16' | '1/32';

export interface MidiExportOptions {
  bpm: number;
  ppq: number;
  duration: NoteDuration;
}

// --- Helpers ---

// Convert SID frequency register to MIDI Note Number
const freqToMidiNote = (freqReg: number, clockFreq: number): number => {
  // SID Freq Formula: Fout = (Fn * Fclk) / 16777216
  const freqHz = (freqReg * clockFreq) / 16777216;

  if (freqHz <= 0) return -1;

  // MIDI Note Formula: n = 69 + 12 * log2(f / 440)
  const note = MIDI_NOTE_A4 + 12 * Math.log2(freqHz / FREQ_A4);
  return Math.round(note);
};

// Write a variable-length quantity (standard MIDI format)
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

// Write a 32-bit integer (big-endian)
const writeUint32 = (val: number, bytes: number[]) => {
  bytes.push((val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
};

// Write a 16-bit integer (big-endian)
const writeUint16 = (val: number, bytes: number[]) => {
  bytes.push((val >> 8) & 0xFF, val & 0xFF);
};

// Write string as bytes
const writeString = (str: string, bytes: number[]) => {
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
};

// --- Main Export Function ---

export const generateMidiFile = (trace: ParsedTrace, options: MidiExportOptions): Uint8Array => {
  const { bpm, ppq, duration } = options;

  const isNtsc = (trace.header.clock || CLOCK_PAL) >= 1000000;
  const clockFreq = isNtsc ? CLOCK_NTSC : CLOCK_PAL;
  const fps = isNtsc ? 60 : 50;

  // Calculate delta ticks per frame
  // Ticks per second = (BPM * PPQ) / 60
  const ticksPerSecond = (bpm * ppq) / 60;
  const ticksPerFrame = ticksPerSecond / fps;

  // Calculate Quantization Grid
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

  // Iterate over 3 voices
  for (let v = 0; v < 3; v++) {
    const trackBytes: number[] = [];
    let currentTick = 0;
    let lastEventTick = 0;
    let activeNote = -1;
    let lastGate = false;

    // Track Name Event
    writeVLQ(0, trackBytes); // Delta 0
    trackBytes.push(0xFF, 0x03); // Meta Event: Track Name
    const name = `SID Voice ${v + 1}`;
    writeVLQ(name.length, trackBytes);
    writeString(name, trackBytes);

    // Set Tempo Event (only on first track usually, but let's assume type 1 file)
    // Tempo is microseconds per quarter note. 60,000,000 / BPM
    if (v === 0) {
        writeVLQ(0, trackBytes);
        trackBytes.push(0xFF, 0x51, 0x03);
        const usPerQuarter = Math.round(60000000 / bpm);
        trackBytes.push((usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
    }

    const regOffset = v * 7;
    let frameTickAccumulator = 0;

    for (let f = 0; f < trace.frames.length; f++) {
      const frame = trace.frames[f];
      // Safety check for frame size
      if (!frame || frame.length < 25) continue;

      // Frame Timing Logic
      frameTickAccumulator += ticksPerFrame;
      let eventTick = Math.round(frameTickAccumulator);

      // Apply Quantization
      if (quantizeTicks > 0) {
          eventTick = Math.round(eventTick / quantizeTicks) * quantizeTicks;
      }

      // Skip if time hasn't advanced
      if (eventTick <= currentTick && f < trace.frames.length - 1) continue;

      const freqReg = frame[regOffset] | (frame[regOffset + 1] << 8);
      const gate = (frame[regOffset + 4] & 0x01) !== 0;
      const note = freqToMidiNote(freqReg, clockFreq);
      const deltaTime = eventTick - lastEventTick;

      if (gate && !lastGate) {
        // Attack
        if (note >= 0 && note <= 127) {
          if (deltaTime > 0 || lastEventTick === 0) {
              writeVLQ(deltaTime, trackBytes);
              trackBytes.push(0x90 | v, note, 100); // Note On, Channel=v, Vel=100
              lastEventTick = eventTick;
              activeNote = note;
          }
        }
      } else if (!gate && lastGate) {
        // Release
        if (activeNote !== -1) {
          if (deltaTime > 0) {
              writeVLQ(deltaTime, trackBytes);
              trackBytes.push(0x80 | v, activeNote, 0); // Note Off
              lastEventTick = eventTick;
              activeNote = -1;
          }
        }
      } else if (gate && lastGate) {
        // Sustain - Check for pitch change (Legato)
        if (note >= 0 && note <= 127 && note !== activeNote && activeNote !== -1) {
           if (deltaTime > 0) {
               writeVLQ(deltaTime, trackBytes);
               trackBytes.push(0x80 | v, activeNote, 0); // Off old
               trackBytes.push(0x00); // Delta 0
               trackBytes.push(0x90 | v, note, 100); // On new
               lastEventTick = eventTick;
               activeNote = note;
           }
        }
      }

      lastGate = gate;
      currentTick = eventTick;
    }

    // End of Track
    writeVLQ(Math.max(0, currentTick - lastEventTick), trackBytes);
    trackBytes.push(0xFF, 0x2F, 0x00);
    tracks.push(trackBytes);
  }

  // --- Construct Final File ---
  const fileBytes: number[] = [];

  // Header Chunk
  writeString("MThd", fileBytes);
  writeUint32(6, fileBytes); // Header length
  writeUint16(1, fileBytes); // Format 1 (Multiple tracks)
  writeUint16(tracks.length, fileBytes); // Number of tracks (3)
  writeUint16(ppq, fileBytes); // Time division

  // Track Chunks
  tracks.forEach(track => {
    writeString("MTrk", fileBytes);
    writeUint32(track.length, fileBytes);
    fileBytes.push(...track);
  });

  return new Uint8Array(fileBytes);
};
