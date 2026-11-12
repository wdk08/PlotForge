# PlotForge 1.2.1

PlotForge is Forge Studios' local-first visual story planner. Open a project from the library to get a freeform canvas for notes, text, checklists, shapes, connections, images, audio, and video. A nested canvas is an element on its parent. Double-click its card to enter it, and use Back, breadcrumbs, or the canvas tree to return.

## Development

Use Node 20.19+ or 22.12+ and Rust 1.90+ with Tauri's platform prerequisites.

```sh
npm ci
npm start                    # Browser development at http://127.0.0.1:4173
npm run desktop:dev          # Native window with an isolated development profile
npm run build                # Browser application in dist/plotforge
npm run preview              # Serve that build at http://127.0.0.1:4174
npm run desktop:build        # Local native binary
```

The production browser application works offline after its first successful load on a secure origin or localhost. The desktop application bundles its web assets locally. Desktop project data is stored in the Tauri app-data directory for `com.plotforge.desktop`, with development using `com.plotforge.desktop.dev`. Browser storage and theme preferences use separate PlotForge development and production names. The project library, autosave, snapshots, and media are local to the current profile. Export a `.plf` to move a project between profiles or devices.

## Project files

A `.plf` starts with the four bytes `PLF\0`, a little-endian 32-bit JSON manifest length, the UTF-8 manifest, then binary media blobs in manifest order. Schema 1 stores project metadata, a root canvas ID, flat canvas records linked by nested canvas cards, local viewport state, settings, and per-board elements and connections. Media is embedded once per asset ID in the file. The app keeps media separately from autosave snapshots and retains assets for undo and recovery. Each portable file supports up to 2 GiB with individual assets up to 512 MiB.

Supported images include PNG, JPEG, GIF, and WebP. Audio and video playback uses the local web engine's codecs. PNG and PDF render the current canvas's full content with an image size limit of 4096 pixels per side and 10 million pixels total. PDF fits that image on one A4 page.

## Verification

```sh
npm test
npm run build
npx playwright install webkit
npm run test:browser           # Chrome and WebKit, with fresh browser profiles
npm run desktop:test           # Native storage tests in temporary directories
npm run desktop:smoke          # Local native window and binary IPC smoke test
```

PlotForge incorporates portions of ScriptForge, copyright (C) 2026 wdk08, under GPL-3.0-only. See `LICENSE` and the original attribution in `COPYRIGHT`. The browser and desktop frontend builds include notices for bundled web dependencies.
