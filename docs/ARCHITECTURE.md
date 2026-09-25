# Architecture

SID OS is a client-only Vite application. There is no server component and no API key is required.

## Runtime flow

1. `index.tsx` mounts `App` into the root element.
2. `App.tsx` owns workstation state, window layout, import/export actions, and the audio-player lifecycle.
3. `services/sidService.ts` parses trace input, reconstructs frames, and sends sorted SID writes to an AudioWorklet.
4. `components/Visualizer.tsx` and the chip/logic/physical visualizers consume the player telemetry and render with Canvas or Three.js.
5. Tracker editing operates on immutable `TrackerProject` values in `services/editorService.ts`.
6. Export services serialize the current trace or tracker project to JSON, MIDI, and SWM files.

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
