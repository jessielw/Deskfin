<p align="center">
    <img height="180px" alt="Deskfins's logo with name" src="resources/icons/deskfin_with_name.svg" />
</p>

<picture><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/jessielw/Deskfin/ci.yml?style=flat&logo=github&logoColor=white&label=CI"></picture>

# Why Deskfin

Jellyfin no longer has an official desktop client. Deskfin is an unofficial
desktop client inspired by [jellyfin-mpv-shim](https://github.com/jellyfin/jellyfin-mpv-shim).

I wanted something deliberately thin: a stable cross-platform desktop wrapper
around the official Jellyfin Web interface, without taking on the maintenance
burden of building a second Jellyfin frontend or video engine.

## Why Electron?

Deskfin began as an exploration of several different desktop technologies before
settling on Electron.

- **Qt WebEngine / libmpv:** Similar to the former official Jellyfin desktop
  client. It provided excellent native integration, but also required a much
  larger native playback stack that would have increased long-term maintenance.
- **PyWebView:** Produced very small builds by relying on each operating
  system's native webview. However, differences in codec support, JavaScript
  injection, and browser behavior meant additional platform-specific code.
- **Rust/Tauri:** An attractive option with a small runtime, but it shares the
  same dependency on system webviews and their platform-specific differences.

Electron provides a consistent Chromium runtime across Windows, macOS, and
Linux. That allows Deskfin to behave the same on every platform, simplifies
playback integration, and keeps the codebase focused on Jellyfin rather than
browser-specific workarounds.

While Electron applications are often associated with large downloads and high
memory usage, Deskfin is designed to remain lightweight. Compared to some native
desktop media clients, it has a significantly smaller installation size and
lower idle memory footprint while still providing a consistent cross-platform
experience.

## How Deskfin works

Deskfin loads the official Jellyfin Web interface directly. Inline playback is
the normal Jellyfin web player running inside Electron, so libraries, accounts,
queues, and ordinary playback stay owned by Jellyfin.

For videos that benefit from it, Deskfin can instead open an external MPV
window. It knows about that playback and reports progress, pause, stop, and
other relevant events back to Jellyfin.

On Windows, [mpv.net](https://github.com/mpvnet-player/mpv.net) can be used as a
drop-in alternative to MPV. Deskfin looks for regular MPV first, then mpv.net,
or you can select either executable in Settings. mpv.net keeps its own native
player window; Deskfin does not modify its configuration files.

When Jellyfin reports an Intro or Outro segment, the MPV window shows a native
skip prompt only while that segment is playing. Click the prompt or press
`Enter` to jump to the end of the segment (`Ctrl+Shift+I` is also available as
a fallback). This uses Jellyfin’s authenticated MediaSegments API, so it also
works with segment providers such as Intro Skipper without storing another
token in Deskfin.

## Why use a separate MPV window?

The point is to get the strengths of MPV without embedding and maintaining a
full native player inside Deskfin. MPV is optional, and Jellyfin Web remains the
fallback for Live TV, music, active recordings, SyncPlay, and anything else that
doesn't fit the external-player path cleanly.

## LLM Disclosure

The core of the codebase was written by me. I did use a local LLM as a development
aid for tasks such as debugging, grammar and documentation reviews, researching
topics I was rusty on, and generating portions of the test suite (because, let's be
honest, nobody enjoys writing tests no matter how much they pretend to).

All architecture, design decisions, implementation, and final code review were
performed by me. Any LLM suggestions were reviewed modified where necessary, and
verified before being incorporated into the project.
