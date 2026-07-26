# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MPV.net support
- Skip intro/outro through mpv/mpv.net
- View menu now includes standard zoom controls
- Added 'Open current page in browser' and 'Copy current page link'
- Links retain the Jellyfin route while removing credentials and auth tokens
- Added Help → Keyboard shortcuts

### Changed

- Children windows now open on the screen based on the parent Deskfin window

### Fixed

- Long executable description on hover/taskbar

## [0.1.0-beta.2] - 2026-07-24

### Fixed

- MPV launching when not in fullscreen mode could sometimes go rogue/not launch at all
