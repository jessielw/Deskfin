<p align="center">
    <img height="180px" alt="Deskfins's logo with name" src="resources/icons/deskfin_with_name.svg" />
</p>

# Why Deskfin

Jellyfin no longer has an official desktop client. Deskfin is an unofficial
desktop client inspired by [jellyfin-mpv-shim](https://github.com/jellyfin/jellyfin-mpv-shim).

I wanted something deliberately thin: a stable cross-platform desktop wrapper
around the official Jellyfin Web interface, without taking on the maintenance
burden of building a second Jellyfin frontend or video engine.

## Electron

I considered a few other approaches first.

- **Qt WebEngine / libmpv:** close to the approach used by the former official
  desktop client. It offered deep integration, but also meant owning a large
  native playback stack that had become difficult to maintain.
- **PyWebView:** promising for small packages because it uses each operating
  system's built-in webview. The trade-off was inconsistent codec support and
  different injection behavior on every platform.
- **Rust/Tauri:** appealing for similar reasons, but it runs into the same
  webview and codec differences.

Electron was the best fit for the goal: one Chromium runtime that behaves the
same on Windows, macOS, and Linux, with broader built-in codec support than many
system webviews. It makes the app larger, but it keeps the behavior predictable
and avoids platform-specific workarounds.

## How Deskfin works

Deskfin loads the official Jellyfin Web interface directly. Inline playback is
the normal Jellyfin web player running inside Electron, so libraries, accounts,
queues, and ordinary playback stay owned by Jellyfin.

For videos that benefit from it, Deskfin can instead open an external MPV
window. It knows about that playback and reports progress, pause, stop, and
other relevant events back to Jellyfin.

## Why use a separate MPV window?

The point is to get the strengths of MPV without embedding and maintaining a
full native player inside Deskfin. MPV is optional, and Jellyfin Web remains the
fallback for Live TV, music, active recordings, SyncPlay, and anything else that
doesn't fit the external-player path cleanly.

## LLM Disclosure

The core of the codebase was written by me. I did use a local LLM as a development aid for tasks such as debugging, grammar and documentation reviews, researching topics I was rusty on, and generating portions of the test suite (because, let's be honest, nobody enjoys writing tests no matter how much they pretend to).

All architecture, design decisions, implementation, and final code review were performed by me. Any LLM suggestions were reviewed modified where necessary, and verified before being incorporated into the project.
