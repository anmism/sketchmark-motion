let initialSource = "";
let initialFile = "";
let currentFile = "";
    const editor = document.getElementById("editor");
    const canvas = document.getElementById("canvas");
    const statusEl = document.getElementById("status");
    const playButton = document.getElementById("play");
    const scrub = document.getElementById("scrub");
    const timeEl = document.getElementById("time");
    const fileName = document.getElementById("fileName");
    const PREVIEW_MAX_WIDTH = 900;
    const PREVIEW_MAX_FPS = 30;
    const { MotionMarkPlayer, renderFrameToCanvas } = window.motionmarkPlayer;

    let scene = null;
    let durationMs = 1;
    let tMs = 0;
    let playing = false;
    let playStart = 0;
    let playStartT = 0;
    let compileTimer = 0;
    let compiling = false;
    let pendingCompile = false;
    let lastPreviewDraw = 0;
    const player = new MotionMarkPlayer(canvas, {
      render: { maxWidth: PREVIEW_MAX_WIDTH },
      maxFps: PREVIEW_MAX_FPS,
      imageLoader: loadPreviewImage,
      onError: (error) => setStatus(error.message || String(error), true)
    });

    loadInitial().catch((error) => setStatus(error.message || String(error), true));

    editor.addEventListener("input", () => {
      window.clearTimeout(compileTimer);
      compileTimer = window.setTimeout(compileScene, 300);
    });

    scrub.addEventListener("input", () => {
      tMs = Number(scrub.value);
      drawFrame(tMs);
      if (playing) {
        playStart = performance.now();
        playStartT = tMs;
        playAudioAtTime(tMs);
      } else {
        stopAllAudio();
      }
    });

    playButton.addEventListener("click", async () => {
      playing = !playing;
      playButton.textContent = playing ? "Pause" : "Play";
      if (playing) {
        await initAudio();
        playStart = performance.now();
        playStartT = tMs;
        playAudioAtTime(tMs);
        requestAnimationFrame(tick);
      } else {
        stopAllAudio();
      }
    });

    async function compileScene() {
      if (compiling) {
        pendingCompile = true;
        return;
      }
      compiling = true;
      try {
        const source = editor.value;
        const response = await fetch("/api/compile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, filePath: currentFile })
        });
        const result = await response.json();
        if (!result.ok) {
          setStatus(result.error || "Compile failed", true);
          return;
        }
        scene = result.scene;
        scene.elements.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        durationMs = Math.max(1, scene.duration);
        tMs = Math.min(tMs, durationMs);
        scrub.max = String(durationMs);
        await player.setScene(scene);
        player.seek(tMs);
        if (scene.audioTracks && scene.audioTracks.length) {
          loadAudioBuffers(scene.audioTracks);
        }
        setStatus("Compiled", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        compiling = false;
        if (pendingCompile) {
          pendingCompile = false;
          compileScene();
        }
      }
    }

    function tick(now) {
      if (!playing) return;
      tMs = playStartT + (now - playStart);
      if (tMs > durationMs) {
        tMs = 0;
        playStart = now;
        playStartT = 0;
        playAudioAtTime(0);
      }
      scrub.value = String(Math.min(tMs, durationMs));
      updateTime(tMs);
      const fps = Math.min(scene?.canvas?.fps || PREVIEW_MAX_FPS, PREVIEW_MAX_FPS);
      if (now - lastPreviewDraw >= 1000 / fps) {
        drawFrame(tMs);
        lastPreviewDraw = now;
      }
      requestAnimationFrame(tick);
    }

    function drawFrame(time) {
      if (!scene) return;
      updateTime(time);
      player.render(time);
    }

    async function loadPreviewImage(src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = isRemoteAsset(src)
          ? src
          : "/image/" + encodeURIComponent(src) + "?file=" + encodeURIComponent(currentFile);
      });
      return img;
    }

    function isRemoteAsset(src) {
      return /^https?:\/\//i.test(src);
    }

    function updateTime(time) {
      timeEl.textContent = formatSeconds(time) + " / " + formatSeconds(durationMs);
    }

    function formatSeconds(value) {
      return (Math.max(0, value) / 1000).toFixed(2) + "s";
    }

    function setStatus(message, isError) {
      statusEl.textContent = message;
      statusEl.classList.toggle("error", isError);
    }

    // --- MP4 Export via WebCodecs + mp4-muxer ---

    const exportBtn = document.getElementById("exportBtn");

    exportBtn.addEventListener("click", async () => {
      if (!scene) { setStatus("Nothing to export", true); return; }
      if (typeof VideoEncoder === "undefined") {
        setStatus("WebCodecs not supported in this browser (use Chrome/Edge)", true);
        return;
      }
      exportBtn.disabled = true;
      exportBtn.textContent = "Exporting...";
      try {
        await exportMp4();
      } catch (err) {
        setStatus("Export failed: " + (err.message || err), true);
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = "Export MP4";
      }
    });

    async function exportMp4() {
      const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
      const fps = scene.canvas.fps || 24;
      const w = scene.canvas.width;
      const h = scene.canvas.height;
      const totalFrames = Math.ceil(durationMs / 1000 * fps);
      const hasAudio = scene.audioTracks && scene.audioTracks.length > 0
        && scene.audioTracks.some(t => audioBuffers.has(t.src));
      const useAudioEncoder = hasAudio && typeof AudioEncoder !== "undefined";

      const muxerOptions = {
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: w, height: h },
        fastStart: "in-memory"
      };
      if (useAudioEncoder) {
        muxerOptions.audio = { codec: "aac", sampleRate: 48000, numberOfChannels: 2 };
      }
      const muxer = new Muxer(muxerOptions);

      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { throw e; }
      });

      videoEncoder.configure({
        codec: "avc1.640028",
        width: w,
        height: h,
        bitrate: 5_000_000,
        framerate: fps
      });

      const offscreen = new OffscreenCanvas(w, h);
      const offCtx = offscreen.getContext("2d");

      for (let i = 0; i < totalFrames; i++) {
        const t = (i / fps) * 1000;
        renderFrameToCanvas(offscreen, scene, t, { width: w, height: h });
        const frame = new VideoFrame(offscreen, {
          timestamp: (i / fps) * 1_000_000,
          duration: (1 / fps) * 1_000_000
        });
        const keyFrame = i % (fps * 2) === 0;
        videoEncoder.encode(frame, { keyFrame });
        frame.close();

        if (i % 10 === 0) {
          setStatus("Encoding frame " + (i + 1) + "/" + totalFrames, false);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      await videoEncoder.flush();
      videoEncoder.close();

      if (useAudioEncoder) {
        setStatus("Encoding audio...", false);
        const mixedBuffer = await mixAudioOffline();
        if (mixedBuffer) {
          await encodeAudioToMuxer(muxer, mixedBuffer);
        }
      }

      muxer.finalize();

      const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (initialFile.replace(/\.mmark$/, "") || "animation") + ".mp4";
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Export complete (" + totalFrames + " frames" + (useAudioEncoder ? " + audio" : "") + ")", false);
    }

    async function mixAudioOffline() {
      const sampleRate = 48000;
      const durationSec = durationMs / 1000;
      const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);

      for (const track of scene.audioTracks) {
        const buffer = audioBuffers.get(track.src);
        if (!buffer) continue;

        const trackStartSec = track.lifetime.start / 1000;
        const trackEndSec = track.lifetime.end / 1000;
        const trackDurSec = trackEndSec - trackStartSec;
        const trimSec = (track.trim || 0) / 1000;
        const vol = typeof track.volume === "number" ? track.volume : 1;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = !!track.loop;

        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = vol;

        // Fade-in
        if (track.fadeIn > 0) {
          gainNode.gain.setValueAtTime(0, trackStartSec);
          gainNode.gain.linearRampToValueAtTime(vol, trackStartSec + track.fadeIn / 1000);
        }

        // Fade-out
        if (track.fadeOut > 0) {
          const fadeOutStart = trackEndSec - track.fadeOut / 1000;
          gainNode.gain.setValueAtTime(vol, fadeOutStart);
          gainNode.gain.linearRampToValueAtTime(0, trackEndSec);
        }

        const panNode = offlineCtx.createStereoPanner();
        const panVal = typeof track.pan === "number" ? track.pan : 0;
        panNode.pan.value = Math.max(-1, Math.min(1, panVal));

        source.connect(gainNode).connect(panNode).connect(offlineCtx.destination);
        source.start(trackStartSec, trimSec, trackDurSec);
      }

      return offlineCtx.startRendering();
    }

    async function encodeAudioToMuxer(muxer, audioBuffer) {
      const sampleRate = audioBuffer.sampleRate;
      const numberOfChannels = audioBuffer.numberOfChannels;
      const framesPerChunk = 1024;
      const totalSamples = audioBuffer.length;

      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => { throw e; }
      });

      audioEncoder.configure({
        codec: "mp4a.40.2",
        sampleRate: sampleRate,
        numberOfChannels: numberOfChannels,
        bitrate: 128000
      });

      for (let offset = 0; offset < totalSamples; offset += framesPerChunk) {
        const count = Math.min(framesPerChunk, totalSamples - offset);
        const interleaved = new Float32Array(count * numberOfChannels);
        for (let ch = 0; ch < numberOfChannels; ch++) {
          const channelData = audioBuffer.getChannelData(ch);
          for (let i = 0; i < count; i++) {
            interleaved[i * numberOfChannels + ch] = channelData[offset + i];
          }
        }

        const audioData = new AudioData({
          format: "f32-planar",
          sampleRate: sampleRate,
          numberOfFrames: count,
          numberOfChannels: numberOfChannels,
          timestamp: (offset / sampleRate) * 1_000_000,
          data: getPlanarData(audioBuffer, offset, count)
        });

        audioEncoder.encode(audioData);
        audioData.close();
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

    function getPlanarData(audioBuffer, offset, count) {
      const channels = audioBuffer.numberOfChannels;
      const planar = new Float32Array(count * channels);
      for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        planar.set(channelData.subarray(offset, offset + count), ch * count);
      }
      return planar;
    }

    // --- Web Audio Engine ---

    let audioCtx = null;
    let audioBuffers = new Map(); // src -> AudioBuffer
    let activeAudioSources = []; // {source, gain, pan, startTime}
    let audioLoading = false;

    async function initAudio() {
      if (audioCtx) return;
      audioCtx = new AudioContext();
    }

    async function loadAudioBuffers(tracks) {
      if (!tracks || !tracks.length) return;
      await initAudio();
      audioLoading = true;
      const toLoad = tracks.filter(t => !audioBuffers.has(t.src));
      await Promise.all(toLoad.map(async (track) => {
        try {
          const audioUrl = isRemoteAsset(track.src)
            ? track.src
            : "/audio/" + encodeURIComponent(track.src) + "?file=" + encodeURIComponent(currentFile);
          const resp = await fetch(audioUrl);
          if (!resp.ok) { console.warn("Failed to load audio:", track.src); return; }
          const arrayBuf = await resp.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          audioBuffers.set(track.src, decoded);
        } catch (e) {
          console.warn("Audio decode failed:", track.src, e);
        }
      }));
      audioLoading = false;
    }

    function stopAllAudio() {
      for (const entry of activeAudioSources) {
        try { entry.source.stop(); } catch {}
      }
      activeAudioSources = [];
    }

    function playAudioAtTime(currentTimeMs) {
      if (!scene || !scene.audioTracks || !scene.audioTracks.length) return;
      if (!audioCtx) return;
      stopAllAudio();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const now = audioCtx.currentTime;
      for (const track of scene.audioTracks) {
        const buffer = audioBuffers.get(track.src);
        if (!buffer) continue;

        const trackStartMs = track.lifetime.start;
        const trackEndMs = track.lifetime.end;
        if (currentTimeMs >= trackEndMs) continue;

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = !!track.loop;

        const gainNode = audioCtx.createGain();
        const vol = typeof track.volume === "number" ? track.volume : 1;
        gainNode.gain.value = vol;

        const panNode = audioCtx.createStereoPanner();
        const panVal = typeof track.pan === "number" ? track.pan : 0;
        panNode.pan.value = Math.max(-1, Math.min(1, panVal));

        source.connect(gainNode).connect(panNode).connect(audioCtx.destination);

        const offsetInTrackMs = Math.max(0, currentTimeMs - trackStartMs);
        const trimMs = track.trim || 0;
        const audioOffsetSec = (trimMs + offsetInTrackMs) / 1000;
        const remainingDurSec = (trackEndMs - Math.max(currentTimeMs, trackStartMs)) / 1000;

        // Fade-in
        if (track.fadeIn > 0 && offsetInTrackMs < track.fadeIn) {
          const fadeProgress = offsetInTrackMs / track.fadeIn;
          gainNode.gain.setValueAtTime(vol * fadeProgress, now);
          const fadeRemainingSec = (track.fadeIn - offsetInTrackMs) / 1000;
          gainNode.gain.linearRampToValueAtTime(vol, now + fadeRemainingSec);
        }

        // Fade-out
        if (track.fadeOut > 0) {
          const fadeOutStartMs = trackEndMs - trackStartMs - track.fadeOut;
          const fadeOutStartFromNowSec = Math.max(0, (fadeOutStartMs - offsetInTrackMs) / 1000);
          gainNode.gain.setValueAtTime(vol, now + fadeOutStartFromNowSec);
          gainNode.gain.linearRampToValueAtTime(0, now + fadeOutStartFromNowSec + track.fadeOut / 1000);
        }

        if (currentTimeMs < trackStartMs) {
          const delaySec = (trackStartMs - currentTimeMs) / 1000;
          source.start(now + delaySec, trimMs / 1000, remainingDurSec);
        } else {
          source.start(now, audioOffsetSec, remainingDurSec);
        }

        activeAudioSources.push({ source, gain: gainNode, pan: panNode });
      }
    }

    // --- MP4 Muxer loader ---

    async function loadMp4Muxer() {
      if (window.__mp4Muxer) return window.__mp4Muxer;
      const module = await import("https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs");
      window.__mp4Muxer = module;
      return module;
    }


    async function loadInitial() {
      const response = await fetch("/api/initial");
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.error || "Could not load initial document");
      }
      initialSource = result.source || "";
      initialFile = result.file || "untitled.mmark";
      currentFile = initialFile;
      editor.value = initialSource;
      fileName.textContent = initialFile;
      await compileScene();
    }
