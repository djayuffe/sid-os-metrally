# SID OS — Metrally

SID OS is a browser-based Commodore 64 SID workstation. It loads register traces, replays them through a Web Audio SID model, and provides tracker editing, visualization, mastering, MIDI/SWM/JSON export, and hardware-oriented diagnostics in one CRT-style interface.

## Features

- PAL and NTSC clock-aware SID trace playback.
- Text and JSON trace import with register, cycle, and frame reconstruction.
- Tracker conversion and pattern editing with instruments, arpeggios, portamento, loops, and tempo tables.
- SID chip, NMOS logic, physical-package, waveform, raster, and audit visualizers.
- ProTracker-style instrument editing and live voice controls.
- Mastering rack with EQ, tape, compressor, exciter, reverb, stereo imaging, limiter, and chorus controls.
- MIDI, SWM, and project/trace JSON export.
- Local virtual SD workspace for mounting trace files in the UI.

## Run locally

Prerequisites: Node.js 20 or newer and pnpm (npm also works with the same scripts).

```sh
pnpm install
pnpm run dev
```

Open the URL printed by Vite. The first screen requires a user click to enable Web Audio. No API key is required; the application runs entirely in the browser.

Production build and preview:

```sh
pnpm run build
pnpm run preview
```

## Input formats

Text traces use one write per line:

```text
<cycle>|<SID register hex>|<value hex>
```

JSON input may be an event array or an object containing `events`/`writeLog`, with `cycles` (or `cycle`), `reg` (or `addr`), and `val` (or `value`) fields. Invalid or out-of-range records are ignored.

## Project map

- `App.tsx` — workstation shell and window orchestration.
- `services/sidService.ts` — trace parsing, frame reconstruction, and AudioWorklet SID playback.
- `services/projectLoaderService.ts` — project validation and tracker-to-trace rendering.
- `services/editorService.ts` — immutable tracker editing operations.
- `services/*ExportService.ts` — JSON, MIDI, and SWM exports.
- `components/` — visualizers, editors, dialogs, and virtual filesystem UI.
- `sid_gpu_engine.ts`, `sid_visual_sim.ts` — Three.js visual simulation support.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
