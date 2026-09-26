# Architecture

SID OS is a client-only Vite application. There is no server component and no API key is required.

## Runtime flow

1. `index.tsx` mounts `App` into the root element.
2. `App.tsx` owns workstation state, window layout, import/export actions, and the audio-player lifecycle.
3. `services/sidService.ts` parses trace input, reconstructs frames, and sends sorted SID writes to an AudioWorklet.
4. `components/Visualizer.tsx` and the chip/logic/physical visualizers consume the player telemetry and render with Canvas or Three.js.
5. Tracker editing operates on immutable `TrackerProject` values in `services/editorService.ts`.
6. Export services serialize the current trace or tracker project to JSON, MIDI, and SWM files.

## Feature boundaries

## Public feature contracts

| Contract | Input | Output/state | Safety behavior |
| --- | --- | --- | --- |
| Trace loader | Pipe text, JSON, JSONL | Stable `SidEvent[]` plus clock | Rejects invalid cycles and normalizes register/value bytes |
| SID player | Events and PAL/NTSC clock | AudioWorklet stereo output and telemetry | Bounds speed, seek, model, mixer, and mastering values |
| Project loader | Tracker JSON | Validated `TrackerProject` | Fills safe defaults and validates ADSR nibbles |
| Editor | Existing project plus operation | New immutable project | Does not mutate React-owned source state |
| Exporters | Trace, project, or rendered buffer | WAV, MIDI, SWM, JSON downloads | Validates format limits and reports export errors |

These contracts are intentionally independent of the visual windows. A browser
without WebGL can still load, play, edit, mix, diagnose, and export data.

### Transport and audio

`App.tsx` owns the single `SidPlayer` instance. AudioContext creation is deferred until `SYSTEM_READY`; later state changes are sent to the worklet through control messages (`DATA`, `PLAY`, `SEEK`, `SPEED`, `MODEL`, `MASK`, `MASTER`, `MIXER`, and `LIVE`). The worklet advances SID cycles at the selected PAL/NTSC clock, applies register writes in stable order, and posts telemetry snapshots for the UI.

### Trace and project data

`parseTraceFile` accepts pipe-delimited text and JSON event records, rejects invalid cycles/registers, preserves an optional clock header, and reconstructs frame snapshots. `validateProject` fills safe defaults for missing tracker metadata and validates ADSR nibbles. `renderProjectToTrace` converts tracker rows into SID register frames and cycle events without mutating the source project.

### Editing and windows

The tracker, sequence editor, pattern tools, instrument editor, mixer and visualizers are independent windows managed by `VWindow`. Editor operations in `editorService.ts` return new project values, keeping React state predictable for callers.

### Export contracts

- JSON export preserves the validated trace/project object.
- MIDI export emits a type-1 Standard MIDI File with tempo, voice tracks, pitch-bend and controller data; edited projects and raw traces use separate paths.
- WAV export renders an offline `AudioBuffer` and writes a little-endian RIFF/WAVE container.
- SWM export packs patterns, sequences, instruments, chord data and tempo tables into the `SWM1` layout.

### Data ownership and lifecycle

`App.tsx` owns the active trace, tracker project, audio player, window state,
and export actions. Services are pure or lifecycle-scoped: parsers and editor
operations return values, while `SidPlayer` owns the AudioWorklet connection.
Unmounting pauses and disconnects the player, releases the gain node, and
closes the audio context. Object URLs used by downloads are revoked after the
browser has had time to begin the transfer.

## Audio lifecycle

Audio is created only after the user activates the `SYSTEM_READY` button. This satisfies browser autoplay policies. The `SidPlayer` worklet is disconnected and its context is closed when the React app unmounts.

## Input safety

Trace imports accept only finite, non-negative cycle values and SID register ranges. Project imports validate their object shape and ADSR nibble values before filling safe defaults. Malformed rows or channels outside the three SID voices are ignored during rendering.

## Development commands

```sh
pnpm install
pnpm run dev
pnpm exec tsc --noEmit
pnpm run build
```

Open the Vite URL, not `index.html` directly. Direct `file://` loading cannot resolve Vite's module graph or dependency packages.

## Browser capability fallbacks

Web Audio is required for playback and WAV export. Three.js panels check for WebGL before creating a renderer and replace an unavailable canvas with a status message. The tracker, audit, mixer, file import and data export remain usable when WebGL is unavailable.

## Privacy and deployment

The app is static and client-only. Vite serves the development module graph; production hosting can be any static HTTP server. Imported traces, generated audio and exported files stay in the browser unless the user explicitly saves them. No telemetry endpoint, API key or remote persistence layer is used.
