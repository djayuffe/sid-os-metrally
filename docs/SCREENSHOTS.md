# Feature screenshot gallery

These repository-native SVG captures document the visual language and the primary feature groups of SID OS — Metrally. The live application was exercised over HTTP during the release audit; the images are intentionally lightweight so GitHub renders them quickly and offline clones retain the documentation.

## Workstation overview

![Workstation overview](screenshots/overview.svg)

The overview combines transport controls, the oscilloscope/vector visualizer, register audit, virtual filesystem, tracker kernel and status bar.

## Audio and mastering

![Audio mixer](screenshots/audio-mixer.svg)

The mixer documents the three SID voices, stereo balance, mute/solo controls and the mastering rack.

## Hardware diagnostics

![Hardware diagnostics](screenshots/diagnostics.svg)

The diagnostic family covers the SID die map, NMOS logic telemetry and the physical-package simulation. Browsers without WebGL retain the rest of the workstation and show a clear fallback in the affected panel.

## Import, edit and export

![Import, edit and export](screenshots/export-help.svg)

The data path is deliberately local: traces and projects are validated in the browser, edited in the tracker, and exported as MIDI, WAV, SWM or JSON.

## Re-capturing live UI screenshots

For a pixel-level capture of a particular session, run the app with `pnpm run dev`, load a representative trace, open the desired window, and use the browser’s screenshot command. Avoid capturing personal files or unrelated desktop content when publishing images.
