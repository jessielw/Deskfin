"use strict";

// This function is serialized by Electron and executed in the page's Main World.
// We must keep it self contained: closure variables and Node globals are not available there.
function installPlayer(config) {
  "use strict";

  const server = new URL(config.serverUrl);
  const basePath = server.pathname.replace(/\/$/, "");
  if (
    location.origin !== server.origin ||
    !location.pathname.startsWith(`${basePath}/web`)
  ) {
    return {
      installed: false,
      reason: "outside configured Jellyfin Web scope",
    };
  }
  if (window.__jellyfinDcElectronInstalled) {
    return { installed: true, reason: "already installed" };
  }
  window.__jellyfinDcElectronInstalled = true;

  const bridge = window.jellyfinDesktop;
  const state = { backend: config.backend, startFullscreen: true };
  let activeMpvPlayer = null;
  bridge.on("mode", (payload) => {
    if (["web", "mpv"].includes(payload?.value)) state.backend = payload.value;
  });
  const bridgeReady = bridge
    .status()
    .then((status) => {
      state.backend = status.backend || config.backend;
      state.startFullscreen = status.startFullscreen !== false;
    })
    .catch((error) => {
      console.warn("[Deskfin] Native bridge initialization failed:", error);
    });

  const invoke = (method, ...args) => {
    if (!bridge || typeof bridge[method] !== "function") {
      return Promise.reject(new Error("Native MPV bridge is unavailable"));
    }
    return Promise.resolve(bridge[method](...args));
  };
  bridge.on("shutdown", (payload) => {
    const requestId = payload?.requestId;
    if (typeof requestId !== "string" || !requestId) return;
    if (activeMpvPlayer) {
      activeMpvPlayer._prepareForShutdown(requestId).catch((error) => {
        console.warn("[Deskfin] Playback shutdown failed:", error);
      });
    } else {
      invoke("shutdownReady", requestId).catch((error) => {
        console.warn(
          "[Deskfin] Could not acknowledge playback shutdown:",
          error,
        );
      });
    }
  });

  const mpvProfile = {
    Name: "Deskfin Electron MPV",
    MaxStreamingBitrate: 140000000,
    MaxStaticBitrate: 140000000,
    MusicStreamingTranscodingBitrate: 1280000,
    TimelineOffsetSeconds: 5,
    TranscodingProfiles: [
      {
        Container: "ts",
        Type: "Video",
        Protocol: "hls",
        AudioCodec: "aac,mp3,ac3,opus,flac,vorbis",
        VideoCodec: "h264,mpeg4,mpeg2video",
        MaxAudioChannels: "8",
      },
    ],
    DirectPlayProfiles: [{ Type: "Video" }],
    ResponseProfiles: [],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: "srt", Method: "External" },
      { Format: "srt", Method: "Embed" },
      { Format: "ass", Method: "External" },
      { Format: "ass", Method: "Embed" },
      { Format: "ssa", Method: "External" },
      { Format: "ssa", Method: "Embed" },
      { Format: "sub", Method: "External" },
      { Format: "sub", Method: "Embed" },
      { Format: "vtt", Method: "External" },
      { Format: "pgssub", Method: "Embed" },
      { Format: "pgs", Method: "Embed" },
      { Format: "dvdsub", Method: "Embed" },
      { Format: "dvbsub", Method: "Embed" },
    ],
  };

  function isEligibleVideo(item, options, playbackManager) {
    if (state.backend !== "mpv" || item?.MediaType !== "Video") return false;
    if (
      !Number.isFinite(item.RunTimeTicks) ||
      item.RunTimeTicks <= 0 ||
      item.IsLive
    )
      return false;
    if (["TvChannel", "LiveTvChannel", "LiveTvProgram"].includes(item.Type))
      return false;
    const recordingStatus = String(
      item.RecordingStatus || item.Status || "",
    ).toLowerCase();
    if (["inprogress", "recording"].includes(recordingStatus)) return false;
    if (playbackManager?.syncPlayEnabled || options?.syncPlay === true)
      return false;
    return true;
  }

  function relativeTrack(streams, jellyfinIndex, type) {
    if (!Number.isInteger(jellyfinIndex) || jellyfinIndex < 0) return 0;
    let relative = 1;
    for (const stream of streams || []) {
      if (stream.Type !== type || stream.IsExternal) continue;
      if (stream.Index === jellyfinIndex) return relative;
      relative += 1;
    }
    return 0;
  }

  function jellyfinTrackIndex(streams, mpvIndex, type) {
    if (mpvIndex === false || mpvIndex === "no" || mpvIndex == null) return -1;
    const wanted = Number(mpvIndex);
    if (!Number.isInteger(wanted) || wanted <= 0) return null;
    let relative = 0;
    for (const stream of streams || []) {
      if (stream.Type !== type || stream.IsExternal) continue;
      relative += 1;
      if (relative === wanted) return stream.Index;
    }
    return null;
  }

  function selectedTracks(options) {
    const source = options.mediaSource || {};
    const streams = source.MediaStreams || [];
    if (options.playMethod === "Transcode") {
      return {
        audioTrack: 1,
        subtitleTrack: 0,
        externalAudioUrl: null,
        externalSubtitleUrl: null,
      };
    }
    const audioIndex = source.DefaultAudioStreamIndex ?? -1;
    const subtitleIndex = source.DefaultSubtitleStreamIndex ?? -1;
    const audio = streams.find(
      (stream) => stream.Index === audioIndex && stream.Type === "Audio",
    );
    const subtitle = streams.find(
      (stream) => stream.Index === subtitleIndex && stream.Type === "Subtitle",
    );
    const absolute = (value) =>
      value ? new URL(value, options.url).href : null;
    return {
      audioTrack: audio?.IsExternal
        ? 0
        : relativeTrack(streams, audioIndex, "Audio"),
      subtitleTrack: subtitle?.IsExternal
        ? 0
        : relativeTrack(streams, subtitleIndex, "Subtitle"),
      externalAudioUrl: audio?.IsExternal ? absolute(audio.DeliveryUrl) : null,
      externalSubtitleUrl:
        subtitle?.DeliveryMethod === "External"
          ? absolute(subtitle.DeliveryUrl)
          : null,
    };
  }

  function normalizeMediaSegments(payload) {
    const items = Array.isArray(payload?.Items) ? payload.Items : [];
    return items
      .map((segment) => {
        const type = String(segment?.Type || "");
        const startTicks = Number(
          segment?.StartTicks ?? segment?.StartPositionTicks,
        );
        const endTicks = Number(segment?.EndTicks ?? segment?.EndPositionTicks);
        if (
          !["Intro", "Outro"].includes(type) ||
          !Number.isFinite(startTicks) ||
          !Number.isFinite(endTicks) ||
          startTicks < 0 ||
          endTicks <= startTicks
        ) {
          return null;
        }
        return {
          type,
          startSeconds: startTicks / 10000000,
          endSeconds: endTicks / 10000000,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.startSeconds - right.startSeconds)
      .slice(0, 100);
  }

  async function fetchMediaSegments(item) {
    const itemId = String(item?.Id || "");
    if (!itemId) return [];

    const connectionManager =
      window.ConnectionManager || window.connectionManager;
    let apiClient = null;
    if (connectionManager?.getApiClient) {
      try {
        apiClient = connectionManager.getApiClient(item?.ServerId || item);
      } catch {
        try {
          apiClient = connectionManager.getApiClient();
        } catch {
          apiClient = null;
        }
      }
    }
    apiClient = apiClient || window.ApiClient || null;
    if (!apiClient) return [];

    const path = `MediaSegments/${encodeURIComponent(itemId)}`;
    const rawUrl =
      typeof apiClient.getUrl === "function"
        ? apiClient.getUrl(path)
        : new URL(`${basePath}/${path}`, server).href;
    const url = new URL(rawUrl, location.href);
    ["Intro", "Outro"].forEach((type) =>
      url.searchParams.append("includeSegmentTypes", type),
    );

    try {
      if (typeof apiClient.getJSON === "function") {
        return normalizeMediaSegments(await apiClient.getJSON(url.href));
      }

      const headers = {};
      const token =
        typeof apiClient.accessToken === "function"
          ? apiClient.accessToken()
          : "";
      if (token) headers["X-Emby-Token"] = token;
      const response = await fetch(url.href, { headers });
      if (!response.ok) return [];
      return normalizeMediaSegments(await response.json());
    } catch (error) {
      console.debug("[Deskfin] MediaSegments unavailable:", error);
      return [];
    }
  }

  function playbackTitle(options) {
    const item = options.item || {};
    const fallback = options.title || item.Name || "";
    if (item.Type !== "Episode" || !item.SeriesName) return fallback;

    const season = Number.isInteger(item.ParentIndexNumber)
      ? `S${String(item.ParentIndexNumber).padStart(2, "0")}`
      : "";
    const episode = Number.isInteger(item.IndexNumber)
      ? `E${String(item.IndexNumber).padStart(2, "0")}`
      : "";
    const episodeLabel = [season + episode, item.Name]
      .filter(Boolean)
      .join(" · ");
    return [item.SeriesName, episodeLabel].filter(Boolean).join(" — ");
  }

  function showMpvRecovery(item, reason, actions) {
    document.getElementById("jellyfin-dc-electron-recovery")?.remove();
    if (!document.body) return;

    const host = document.createElement("div");
    host.id = "jellyfin-dc-electron-recovery";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { position: fixed; inset: 0; z-index: 2147483647; display: grid;
          place-items: center; padding: 1.5rem; box-sizing: border-box;
          background: rgb(0 0 0 / 65%); font: 16px system-ui, sans-serif; }
        section { width: min(31rem, 100%); box-sizing: border-box; padding: 1.5rem;
          border: 1px solid rgb(255 255 255 / 16%); border-radius: .8rem;
          color: #fff; background: #202026; box-shadow: 0 1rem 4rem #000a; }
        h2 { margin: 0 0 .75rem; font-size: 1.35rem; }
        p { margin: .6rem 0; line-height: 1.45; overflow-wrap: anywhere; }
        #reason { color: #cfcfd6; font-size: .9rem; }
        #status { color: #ffb4ab; min-height: 1.3rem; }
        footer { display: flex; justify-content: flex-end; gap: .7rem; margin-top: 1rem; }
        button { border: 0; border-radius: .45rem; padding: .65rem .9rem;
          color: #fff; background: #45454f; font: inherit; cursor: pointer; }
        #retry, #web { background: #7f56d9; font-weight: 700; }
        button:disabled { cursor: wait; opacity: .65; }
      </style>
      <section role="dialog" aria-modal="true" aria-labelledby="title">
        <h2 id="title">MPV playback failed</h2>
        <p id="message"></p>
        <p id="reason"></p>
        <p id="status" role="alert"></p>
        <footer><button id="cancel">Cancel</button>
          <button id="browser">Browser</button>
          <button id="web">Play Here</button>
          <button id="retry">Retry MPV</button></footer>
      </section>`;

    const itemId = String(item?.Id || "");
    const serverId = String(item?.ServerId || "");
    const params = new URLSearchParams({ id: itemId });
    if (serverId) params.set("serverId", serverId);
    const itemUrl = `${server.origin}${basePath}/web/#/details?${params}`;
    const buttons = [...root.querySelectorAll("button")];
    const retry = root.getElementById("retry");
    const web = root.getElementById("web");
    const browser = root.getElementById("browser");
    const cancel = root.getElementById("cancel");
    const close = () => host.remove();
    let busy = false;
    root.getElementById("message").textContent =
      `MPV could not play ${String(item?.Name || "this item")}.`;
    root.getElementById("reason").textContent = String(reason).slice(0, 1000);
    web.disabled = !itemId || typeof actions.playHere !== "function";
    browser.disabled = !itemId || typeof actions.openBrowser !== "function";
    const run = async (button, label, failureMessage, action) => {
      if (busy) return;
      busy = true;
      buttons.forEach((candidate) => {
        candidate.disabled = true;
      });
      root.getElementById("status").textContent = label;
      try {
        await action(itemUrl);
        close();
      } catch (error) {
        busy = false;
        buttons.forEach((candidate) => {
          candidate.disabled = false;
        });
        web.disabled = !itemId || typeof actions.playHere !== "function";
        browser.disabled = !itemId || typeof actions.openBrowser !== "function";
        root.getElementById("reason").textContent = String(error).slice(
          0,
          1000,
        );
        root.getElementById("status").textContent = failureMessage;
        button.focus();
      }
    };
    retry.addEventListener("click", () =>
      run(
        retry,
        "Retrying MPV...",
        "MPV is still unavailable. Check its configured path or choose Play Here.",
        actions.retry,
      ),
    );
    web.addEventListener("click", () =>
      run(
        web,
        "Switching to Web playback...",
        "Could not switch to Web playback.",
        actions.playHere,
      ),
    );
    browser.addEventListener("click", () =>
      run(
        browser,
        "Opening the system browser...",
        "Could not open the system browser.",
        actions.openBrowser,
      ),
    );
    cancel.addEventListener("click", () =>
      run(
        cancel,
        "Stopping playback...",
        "Could not stop the failed playback cleanly.",
        actions.cancel,
      ),
    );
    host.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        run(
          cancel,
          "Stopping playback...",
          "Could not stop the failed playback cleanly.",
          actions.cancel,
        );
      }
    });
    document.body.append(host);
    retry.focus();
  }

  class JellyfinDcMpvPlayer {
    constructor(args) {
      this.events = args.events;
      this.appSettings = args.appSettings;
      this.playbackManager = args.playbackManager;
      this.type = "mediaplayer";
      this.id = "jellyfindcelectronmpvplayer";
      this.name = "Deskfin Electron MPV";
      this.priority = -1;
      this.isLocalPlayer = true;
      this.isFetching = false;
      this.useFullSubtitleUrls = true;
      this._currentSrc = null;
      this._options = null;
      this._currentTime = 0;
      this._duration = 0;
      this._paused = false;
      this._muted = false;
      this._rate = 1;
      this._fullscreen = false;
      this._volume = Math.round((this.appSettings.get("volume") || 1) * 100);
      this._failurePending = false;
      this._loadRequest = null;
      this._shutdownRequestId = null;
      this._playGeneration = 0;
      this._wireBridge();
    }

    _wireBridge() {
      bridge.on("loaded", () => {
        if (!this._currentSrc) return;
        this._paused = false;
        this.events.trigger(this, "playing");
      });
      bridge.on("paused", (payload) => {
        const paused = Boolean(payload?.value);
        const changed = this._paused !== paused;
        this._paused = paused;
        if (changed) this.events.trigger(this, paused ? "pause" : "unpause");
      });
      bridge.on("position", (payload) => {
        this._currentTime = Number(payload?.value) * 1000;
        this.events.trigger(this, "timeupdate");
      });
      bridge.on("duration", (payload) => {
        this._duration = Number(payload?.value) * 1000;
      });
      bridge.on("volume", (payload) => {
        this._volume = Number(payload?.value);
        this.events.trigger(this, "volumechange");
      });
      bridge.on("muted", (payload) => {
        this._muted = Boolean(payload?.value);
        this.events.trigger(this, "volumechange");
      });
      bridge.on("rate", (payload) => {
        this._rate = Number(payload?.value);
      });
      bridge.on("fullscreen", (payload) => {
        const fullscreen = Boolean(payload?.value);
        if (this._fullscreen === fullscreen) return;
        this._fullscreen = fullscreen;
        this.events.trigger(this, "fullscreenchange");
      });
      bridge.on("audioTrack", (payload) =>
        this._syncNativeTrack("Audio", payload?.value),
      );
      bridge.on("subtitleTrack", (payload) =>
        this._syncNativeTrack("Subtitle", payload?.value),
      );
      bridge.on("next", () => this._changeQueueItem("nextTrack"));
      bridge.on("previous", () => this._changeQueueItem("previousTrack"));
      bridge.on("ended", () => this._finish());
      bridge.on("quit", () => this._handleMpvQuit());
      bridge.on("failed", (payload) =>
        this._queueFailure(payload?.code, payload?.message),
      );
    }

    canPlayMediaType(mediaType) {
      return state.backend === "mpv" && mediaType === "Video";
    }
    canPlayItem(item, options) {
      return isEligibleVideo(item, options, this.playbackManager);
    }
    canPlayUrl() {
      return false;
    }
    supportsPlayMethod() {
      return true;
    }
    supports(feature) {
      return ["PlaybackRate", "SetAspectRatio"].includes(feature);
    }
    getDeviceProfile() {
      return Promise.resolve(mpvProfile);
    }

    async play(options) {
      activeMpvPlayer = this;
      this._options = options;
      this._currentSrc = options.url;
      this._currentTime = Number(options.playerStartPositionTicks || 0) / 10000;
      this._duration = Number(options.item?.RunTimeTicks || 0) / 10000;
      this.audioStreamIndex =
        options.mediaSource?.DefaultAudioStreamIndex ?? -1;
      this.subtitleStreamIndex =
        options.mediaSource?.DefaultSubtitleStreamIndex ?? -1;
      this._failurePending = false;
      const playGeneration = ++this._playGeneration;
      const segmentsPromise = fetchMediaSegments(options.item);
      try {
        const status = await invoke("status");
        this._fullscreen = status.startFullscreen ?? state.startFullscreen;
        this._loadRequest = {
          url: options.url,
          startSeconds: this._currentTime / 1000,
          title: playbackTitle(options),
          fullscreen: this._fullscreen,
          ...selectedTracks(options),
        };
        await invoke("load", this._loadRequest);
        segmentsPromise
          .then((segments) => {
            if (
              this._options !== options ||
              this._playGeneration !== playGeneration ||
              !this._currentSrc ||
              this._failurePending
            ) {
              return;
            }
            if (typeof bridge.setSegments !== "function") return;
            return invoke("setSegments", segments);
          })
          .catch((error) => {
            console.debug(
              "[Deskfin] Could not pass MediaSegments to MPV:",
              error,
            );
          });
      } catch (error) {
        this._queueFailure("unavailable", String(error));
      }
    }

    _finish() {
      if (!this._currentSrc) return;
      document.getElementById("jellyfin-dc-electron-recovery")?.remove();
      const src = this._currentSrc;
      this._currentSrc = null;
      this._options = null;
      this._loadRequest = null;
      this._failurePending = false;
      this._playGeneration += 1;
      if (activeMpvPlayer === this) activeMpvPlayer = null;
      this.events.trigger(this, "stopped", [{ src }]);
    }

    async _prepareForShutdown(requestId) {
      if (this._shutdownRequestId === requestId) return;
      this._shutdownRequestId = requestId;
      try {
        if (this._currentSrc) {
          try {
            if (typeof this.playbackManager?.stop === "function") {
              await this.playbackManager.stop(this);
            } else {
              await this.stop();
            }
          } catch {
            await this.stop();
          }
          if (this._currentSrc) await this.stop();
        }
      } finally {
        await invoke("shutdownReady", requestId).catch((error) => {
          console.warn(
            "[Deskfin] Could not acknowledge playback shutdown:",
            error,
          );
        });
      }
    }

    _queueFailure(code, message) {
      if (!this._options || this._failurePending) return;
      this._failurePending = true;
      setTimeout(() => this._fail(code, message), 0);
    }

    _syncNativeTrack(type, mpvIndex) {
      if (!this._options) return;
      const streams = this._options.mediaSource?.MediaStreams || [];
      const index = jellyfinTrackIndex(streams, mpvIndex, type);
      if (index == null) return;
      const field =
        type === "Audio" ? "audioStreamIndex" : "subtitleStreamIndex";
      if (this[field] === index) return;
      this[field] = index;
      this.events.trigger(this, "timeupdate");
    }

    _changeQueueItem(method) {
      if (
        !this._currentSrc ||
        typeof this.playbackManager?.[method] !== "function"
      )
        return;
      Promise.resolve(this.playbackManager[method](this)).catch((error) => {
        console.warn(`[Deskfin] Jellyfin ${method} failed:`, error);
      });
    }

    _handleMpvQuit() {
      if (!this._currentSrc) return;
      const stop =
        typeof this.playbackManager?.stop === "function"
          ? this.playbackManager.stop(this)
          : this.stop();
      Promise.resolve(stop)
        .catch(() => this.stop())
        .finally(() => invoke("focusApp").catch(() => {}));
    }

    _fail(code, message) {
      if (!this._options) return;
      const item = this._options.item;
      const reason = String(message || code || "Unknown MPV error");
      console.warn(`[Deskfin] MPV failed (${code}):`, reason);
      invoke("stop").catch(() => {});
      setTimeout(
        () =>
          showMpvRecovery(item, reason, {
            retry: () => this._retryMpv(),
            playHere: (itemUrl) => this._playHere(itemUrl),
            openBrowser: (itemUrl) => this._openBrowser(itemUrl),
            cancel: () => this._cancelFailure(),
          }),
        0,
      );
    }

    async _retryMpv() {
      if (!this._loadRequest || !this._options)
        throw new Error("Playback is no longer active");
      this._failurePending = false;
      this._loadRequest.startSeconds = this._currentTime / 1000;
      await invoke("load", this._loadRequest);
    }

    async _playHere(itemUrl) {
      await invoke("stop").catch(() => {});
      this._finish();
      await invoke("playHere", itemUrl);
    }

    async _openBrowser(itemUrl) {
      await invoke("stop").catch(() => {});
      this._finish();
      await invoke("openExternal", itemUrl);
    }

    async _cancelFailure() {
      await invoke("stop").catch(() => {});
      this._finish();
    }

    stop() {
      const stopping = invoke("stop").catch((error) => {
        console.warn("[Deskfin] Could not stop MPV cleanly:", error);
      });
      this._finish();
      return stopping.then(() => undefined);
    }
    destroy() {
      return this.stop();
    }
    pause() {
      invoke("pause").catch(() => {});
    }
    resume() {
      this._paused = false;
      invoke("play").catch(() => {});
    }
    unpause() {
      this.resume();
    }
    paused() {
      return this._paused;
    }
    currentSrc() {
      return this._currentSrc;
    }
    currentTime(value) {
      if (value != null) {
        this._currentTime = Number(value);
        invoke("seek", this._currentTime / 1000).catch(() => {});
      }
      return this._currentTime;
    }
    currentTimeAsync() {
      return Promise.resolve(this._currentTime);
    }
    duration() {
      return this._duration || null;
    }
    seekable() {
      return this._duration > 0;
    }
    getBufferedRanges() {
      return [];
    }

    setVolume(value, save = true) {
      this._volume = Math.max(0, Math.min(100, Number(value)));
      if (save) this.appSettings.set("volume", this._volume / 100);
      invoke("setVolume", this._volume).catch(() => {});
      if (save) this.events.trigger(this, "volumechange");
    }
    getVolume() {
      return this._volume;
    }
    volumeUp() {
      this.setVolume(this._volume + 2);
    }
    volumeDown() {
      this.setVolume(this._volume - 2);
    }
    setMute(value, trigger = true) {
      this._muted = Boolean(value);
      invoke("setMuted", this._muted).catch(() => {});
      if (trigger) this.events.trigger(this, "volumechange");
    }
    isMuted() {
      return this._muted;
    }
    setPlaybackRate(value) {
      this._rate = Number(value);
      invoke("setRate", this._rate).catch(() => {});
    }
    getPlaybackRate() {
      return this._rate;
    }
    getSupportedPlaybackRates() {
      return [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4].map((id) => ({
        id,
        name: `${id}x`,
      }));
    }

    setAudioStreamIndex(index) {
      const streams = this._options?.mediaSource?.MediaStreams || [];
      this.audioStreamIndex = Number(index);
      invoke("setAudioTrack", relativeTrack(streams, index, "Audio")).catch(
        () => {},
      );
    }
    getAudioStreamIndex() {
      return this.audioStreamIndex ?? -1;
    }
    setSubtitleStreamIndex(index) {
      const streams = this._options?.mediaSource?.MediaStreams || [];
      this.subtitleStreamIndex = Number(index);
      invoke(
        "setSubtitleTrack",
        relativeTrack(streams, index, "Subtitle"),
      ).catch(() => {});
    }
    getSubtitleStreamIndex() {
      return this.subtitleStreamIndex ?? -1;
    }
    setSecondarySubtitleStreamIndex() {}
    canSetAudioStreamIndex() {
      return true;
    }
    resetSubtitleOffset() {}
    setSubtitleOffset() {}
    getSubtitleOffset() {
      return 0;
    }
    enableShowingSubtitleOffset() {}
    disableShowingSubtitleOffset() {}
    isShowingSubtitleOffsetEnabled() {
      return false;
    }

    isFullscreen() {
      return this._fullscreen;
    }
    setFullscreen(value) {
      this._fullscreen = Boolean(value);
      invoke("setFullscreen", this._fullscreen).catch(() => {});
    }
    toggleFullscreen() {
      this.setFullscreen(!this._fullscreen);
    }
    getSupportedAspectRatios() {
      return [{ id: "auto", name: "Auto" }];
    }
    getAspectRatio() {
      return "auto";
    }
    setAspectRatio() {}
    setPictureInPictureEnabled() {}
    isPictureInPictureEnabled() {
      return false;
    }
    togglePictureInPicture() {}
    setAirPlayEnabled() {}
    isAirPlayEnabled() {
      return false;
    }
    toggleAirPlay() {}
    setBrightness() {}
    getBrightness() {
      return 100;
    }
    getStats() {
      return Promise.resolve({ categories: [] });
    }
  }

  window.jellyfinDcMpvPlayer = async () => {
    await bridgeReady;
    return JellyfinDcMpvPlayer;
  };

  const browserFeatures = new Set([
    "displaylanguage",
    "displaymode",
    "externallinks",
    "fullscreenchange",
    "htmlaudioautoplay",
    "htmlvideoautoplay",
    "remotecontrol",
    "remotevideo",
    "screensaver",
    "targetblank",
  ]);
  window.NativeShell = {
    getPlugins() {
      return ["jellyfinDcMpvPlayer"];
    },
    openUrl(url) {
      return bridge.openExternal(url);
    },
    AppHost: {
      init() {
        return bridgeReady.then(() => ({
          deviceName: config.deviceName,
          appName: config.appName,
          appVersion: config.appVersion,
        }));
      },
      getDefaultLayout() {
        return "desktop";
      },
      supports(command) {
        return browserFeatures.has(String(command).toLowerCase());
      },
      getDeviceProfile(profileBuilder) {
        return profileBuilder({});
      },
      getSyncProfile(profileBuilder) {
        return profileBuilder({});
      },
      appName() {
        return config.appName;
      },
      appVersion() {
        return config.appVersion;
      },
      deviceName() {
        return config.deviceName;
      },
    },
  };
  return {
    installed: true,
    nativeShell: typeof window.NativeShell,
    pluginFactory: typeof window.jellyfinDcMpvPlayer,
  };
}

module.exports = installPlayer;
