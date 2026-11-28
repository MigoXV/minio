// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppearance } from "custom/Appearance";
import { V2Icon, Modal, FieldLabel } from "custom/V2";
import {
  TimeRange,
  clampRange,
  zoomRange,
  preciseTime,
  frequencyAtHeight,
  frequencyTicks,
} from "custom/analysisView";
import { drawFrequencyRows } from "./spectrogramView";
import type WaveSurfer from "wavesurfer.js";
import type SpectrogramPlugin from "wavesurfer.js/dist/plugins/spectrogram.js";
import {
  analysisLimit,
  formatAudioTime,
  MAX_AUDIO_BYTES,
  MAX_PCM_BYTES,
  readLimitedAudio,
} from "./audioAnalysis";

type Phase = "idle" | "loading" | "ready" | "error";
interface Props {
  path: string;
  size?: number;
  name?: string;
  bucket?: string;
  onLoad: () => void;
  downloadFile: () => void;
}

// WaveSurfer deliberately leaves an externally supplied <audio> element alone
// on destroy, so its Blob URLs must be released by this component.
function releaseMediaBlob(media: HTMLAudioElement) {
  for (const url of new Set([media.src, media.currentSrc])) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

const PreviewAudio = ({
  path,
  size = 0,
  name = "音频预览",
  bucket = "",
  onLoad,
  downloadFile,
}: Props) => {
  const audio = useRef<HTMLAudioElement>(null);
  const waveform = useRef<HTMLDivElement>(null);
  const spectrum = useRef<HTMLDivElement>(null);
  const wave = useRef<WaveSurfer | null>(null);
  const spectrogram = useRef<SpectrogramPlugin | null>(null);
  const spectrogramPhase = useRef<Phase>("idle");
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    const media = audio.current;
    return () => media?.pause();
  }, []);
  const durationRef = useRef(0);
  const [metadataReady, setMetadataReady] = useState(false);
  const [wavePhase, setWavePhase] = useState<Phase>("idle");
  const [spectrumPhase, setSpectrumPhase] = useState<Phase>("idle");
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [spectrumError, setSpectrumError] = useState("");
  const [playError, setPlayError] = useState("");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [sampleRate, setSampleRate] = useState(0);

  const { effective } = useAppearance();
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [parameters, setParameters] = useState(false);
  const [draft, setDraft] = useState({
    fft: 1024,
    overlap: 0.75,
    window: "hann",
  });
  const [selection, setSelection] = useState<TimeRange | null>(null);
  const [dragSelection, setDragSelection] = useState<TimeRange | null>(null);
  const [view, setView] = useState<TimeRange>([0, 0]);
  const [loop, setLoop] = useState(false);
  const [cursor, setCursor] = useState<{
    time: number;
    frequency: number;
  } | null>(null);
  const [fft, setFFT] = useState(1024);
  const [spectrumRevision, setSpectrumRevision] = useState(0);
  const [overlap, setOverlap] = useState(0.75);
  const [windowFunction, setWindowFunction] = useState<"hann" | "hamming">(
    "hann",
  );
  const drag = useRef<{ id: number; x: number; time: number } | null>(null);
  const viewRef = useRef(view);
  const viewWidth = useRef(0);
  const playbackRange = useRef<TimeRange | null>(null);
  const playRequest = useRef(0);
  const loopRef = useRef(loop);
  const maxHz = Math.min(8000, sampleRate / 2);
  const frequencyRange = maxHz
    ? `对数频率 · 0–${maxHz / 1000} kHz`
    : "对数频率";
  const ticks = frequencyTicks(maxHz);
  const themeColors = () => {
    const css = getComputedStyle(document.documentElement);
    return {
      waveColor: css.getPropertyValue("--wave-color").trim(),
      progressColor: css.getPropertyValue("--wave-progress").trim(),
      cursorColor: css.getPropertyValue("--text-secondary").trim(),
    };
  };
  const seek = (position: number) => {
    if (wave.current) wave.current.setTime(position);
    else if (audio.current) audio.current.currentTime = position;
    setTime(position);
  };
  const startPlayback = () => {
    const request = ++playRequest.current;
    void audio.current?.play().catch((error: DOMException) => {
      if (request === playRequest.current && error.name !== "AbortError")
        setPlayError("播放失败，请重试或下载音频。");
    });
  };
  const togglePlay = () => {
    const media = audio.current;
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    playbackRange.current = selection;
    if (
      selection &&
      (media.currentTime < selection[0] || media.currentTime >= selection[1])
    )
      seek(selection[0]);
    startPlayback();
  };
  const syncPlayback = useCallback(() => {
    const media = audio.current;
    if (!media) return;
    const range = playbackRange.current;
    if (
      range &&
      (!media.paused || media.ended) &&
      media.currentTime >= range[1]
    ) {
      if (loopRef.current) {
        media.currentTime = range[0];
        if (media.paused) void media.play().catch(() => setPlaying(false));
      } else {
        media.pause();
        media.currentTime = range[1];
        setPlaying(false);
      }
    }
    setTime(media.currentTime);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => {
      syncPlayback();
      if (audio.current && !audio.current.paused)
        frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, syncPlayback]);
  const setVisible = useCallback(
    (range: TimeRange) => {
      if (!wave.current || !waveform.current || !duration) return;
      const width = wave.current.getWidth();
      if (!width) return;
      let next = clampRange(range[0], range[1], duration);
      const minSpan = Math.max(0.05, (duration * width) / 24000);
      if (next[1] - next[0] < minSpan) {
        const start = Math.max(0, Math.min(duration - minSpan, next[0]));
        next = [start, Math.min(duration, start + minSpan)];
      }
      setView(next);
      viewRef.current = next;
      viewWidth.current = width;
      wave.current.zoom(width / Math.max(0.05, next[1] - next[0]));
      wave.current.setScrollTime(next[0]);
    },
    [duration],
  );
  const clearSelection = () => {
    playbackRange.current = null;
    loopRef.current = false;
    setSelection(null);
    setLoop(false);
  };
  const invalidateSpectrum = () => {
    spectrogram.current?.destroy();
    spectrogram.current = null;
    spectrogramPhase.current = "idle";
    setSpectrumPhase("idle");
  };
  const coordinate = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      range = viewRef.current;
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    return {
      time: range[0] + fraction * (range[1] - range[0]),
      frequency: event.currentTarget.classList.contains("av-spectrum")
        ? frequencyAtHeight((event.clientY - rect.top) / rect.height, maxHz)
        : (cursor?.frequency ?? NaN),
    };
  };
  const cancelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragSelection(null);
  };
  const chartEvents = {
    onPointerDownCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!expanded || wavePhase !== "ready" || !e.isPrimary || e.button !== 0)
        return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = {
        id: e.pointerId,
        x: e.clientX,
        time: coordinate(e).time,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!expanded) return;
      const point = coordinate(e);
      setCursor(point);
      const start = drag.current;
      if (start?.id === e.pointerId) {
        setDragSelection(
          Math.abs(e.clientX - start.x) > 4
            ? clampRange(start.time, point.time, duration)
            : null,
        );
      }
    },
    onPointerUpCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (start?.id !== e.pointerId) return;
      e.stopPropagation();
      const position = coordinate(e).time;
      drag.current = null;
      setDragSelection(null);
      const range = clampRange(start.time, position, duration);
      if (Math.abs(e.clientX - start.x) > 4 && range[1] > range[0]) {
        playbackRange.current = range;
        setSelection(range);
        seek(range[0]);
        startPlayback();
      } else {
        playbackRange.current = null;
        seek(position);
      }
    },
    onPointerCancel: cancelDrag,
    onLostPointerCapture: cancelDrag,
    onClickCapture: (e: React.MouseEvent) => {
      if (expanded) e.stopPropagation();
    },
  };
  useEffect(() => {
    if (wavePhase === "ready") wave.current?.setOptions(themeColors());
  }, [effective, wavePhase]);
  useEffect(() => {
    const element = waveform.current?.parentElement;
    const spectrogramPlot = spectrum.current?.parentElement;
    if (!element || !expanded) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect(),
        range = viewRef.current,
        duration = durationRef.current;
      const anchor =
        range[0] +
        ((e.clientX - rect.left) / rect.width) * (range[1] - range[0]);
      setVisible(zoomRange(range, anchor, e.deltaY > 0 ? 1.25 : 0.8, duration));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    spectrogramPlot?.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      spectrogramPlot?.removeEventListener("wheel", wheel);
    };
    // View is read from a ref to avoid replacing the handler while scrolling.
  }, [expanded, setVisible]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.code !== "Space" ||
        (e.target as HTMLElement).closest(
          "input, select, textarea, button, a",
        ) ||
        waveform.current?.closest("[inert]")
      )
        return;
      e.preventDefault();
      togglePlay();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const host = waveform.current?.closest(".modalContainer");
    host?.classList.toggle("av-analysis-modal", expanded);
    return () => host?.classList.remove("av-analysis-modal");
  }, [expanded]);

  useEffect(() => {
    if (!metadataReady || !audio.current || !waveform.current) return;
    const controller = new AbortController();
    let disposed = false;
    const media = audio.current;
    let instance: WaveSurfer | null = null;
    const limit = analysisLimit(size, durationRef.current);
    if (limit) {
      setNotice(limit);
      setWavePhase("error");
      return;
    }
    setWavePhase("loading");
    const load = async () => {
      try {
        const [{ default: WaveSurferClass }, response] = await Promise.all([
          import("wavesurfer.js"),
          fetch(path, {
            credentials: "same-origin",
            signal: controller.signal,
          }),
        ]);
        const blob = await readLimitedAudio(response);
        if (disposed) return;
        const position = media.currentTime;
        const resume = !media.paused;
        const playbackRate = media.playbackRate;
        // A blank initial media element prevents the constructor auto-loading
        // the streaming URL outside our bounded fetch. Bind the visible player
        // with the public setter before supplying the already downloaded Blob.
        instance = WaveSurferClass.create({
          container: waveform.current!,
          media: document.createElement("audio"),
          height: "auto",
          ...themeColors(),
          autoScroll: false,
          autoCenter: false,
          hideScrollbar: true,
          normalize: true,
          sampleRate: 48000,
        });
        instance.setMediaElement(media);
        wave.current = instance;
        const syncSpectrum = () => {
          if (spectrum.current && instance) {
            spectrum.current.style.width = `${instance.getWrapper().offsetWidth}px`;
            spectrum.current.style.transform = `translateX(-${instance.getScroll()}px)`;
          }
        };
        const renderer = instance;
        instance.on("scroll", (start, end) => {
          // A wider viewport can clamp scroll before the resize observer reapplies zoom.
          if (renderer.getWidth() !== viewWidth.current) return;
          viewRef.current = [start, end];
          setView(viewRef.current);
          syncSpectrum();
        });
        instance.on("redrawcomplete", syncSpectrum);
        await instance.loadBlob(blob, undefined, durationRef.current);
        if (disposed) return;
        const decoded = instance.getDecodedData();
        if (!decoded)
          throw new Error("无法解码音频，请下载后使用其他播放器打开。");
        if (decoded.length * decoded.numberOfChannels * 4 > MAX_PCM_BYTES) {
          throw new Error(
            "解码数据超过 128 MiB，已跳过可视化分析，仍可使用普通播放器。",
          );
        }
        const decodedLimit = analysisLimit(blob.size, decoded.duration);
        if (decodedLimit) throw new Error(decodedLimit);
        setSampleRate(decoded.sampleRate);
        viewRef.current = [0, decoded.duration];
        viewWidth.current = instance.getWidth();
        setView(viewRef.current);
        media.playbackRate = playbackRate;
        if (position > 0)
          media.currentTime = Math.min(position, decoded.duration);
        if (resume) void media.play().catch(() => {});
        setWavePhase("ready");
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        instance?.destroy();
        wave.current = null;
        // loadBlob may have changed the media URL; restore streaming playback.
        releaseMediaBlob(media);
        media.src = path;
        media.load();
        setNotice(
          error instanceof Error
            ? error.message
            : "波形分析失败，可继续普通播放或下载。",
        );
        setWavePhase("error");
      } finally {
        if (!disposed) onLoadRef.current();
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      spectrogram.current?.destroy();
      spectrogram.current = null;
      instance?.destroy();
      releaseMediaBlob(media);
      wave.current = null;
    };
    // Theme changes update drawing colors without reloading the audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, size, metadataReady]);

  useEffect(() => {
    if (
      !expanded ||
      wavePhase !== "ready" ||
      !wave.current ||
      !spectrum.current
    )
      return;
    if (spectrogram.current && spectrogramPhase.current === "ready") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const phase = (value: Phase) => {
      spectrogramPhase.current = value;
      setSpectrumPhase(value);
    };
    const fail = (message: string) => {
      if (disposed) return;
      clearTimeout(timer);
      spectrogram.current?.destroy();
      spectrogram.current = null;
      phase("error");
      setSpectrumError(message);
    };
    phase("loading");
    setSpectrumError("");
    // Importing the plugin and creating its FFT Worker must happen only here.
    import("wavesurfer.js/dist/plugins/spectrogram.js")
      .then(({ default: Plugin }) => {
        if (disposed || !wave.current || !spectrum.current) return;
        const options = {
          container: spectrum.current,
          height: 224,
          labels: false,
          fftSamples: fft,
          noverlap: Math.round(fft * overlap),
          windowFunc: windowFunction,
          scale: "linear" as const,
          frequencyMin: 0,
          frequencyMax: maxHz,
          drawFrequencyRows,
          useWebWorker: true,
          splitChannels: false,
        };
        const plugin = Plugin.create(options);
        spectrogram.current = plugin;
        plugin.on("ready", () => {
          if (disposed) return;
          clearTimeout(timer);
          phase("ready");
        });
        timer = setTimeout(
          () => fail("频谱计算超时，请收起后重新展开重试。"),
          60000,
        );
        wave.current.registerPlugin(plugin);
      })
      .catch(() =>
        fail("频谱图加载失败，请收起后重新展开重试；音频仍可正常播放。"),
      );
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (spectrogramPhase.current !== "ready") {
        spectrogram.current?.destroy();
        spectrogram.current = null;
        spectrogramPhase.current = "idle";
        setSpectrumPhase("idle");
      }
    };
  }, [
    expanded,
    wavePhase,
    maxHz,
    fft,
    overlap,
    windowFunction,
    spectrumRevision,
  ]);

  useEffect(() => {
    const chart = waveform.current;
    if (!chart || wavePhase !== "ready") return;
    let width = chart.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = chart.clientWidth;
      if (!nextWidth || nextWidth === width) return;
      width = nextWidth;
      // WaveSurfer zoom is measured in pixels per second. Reapply the visible
      // interval so a new plot width does not shift the time range.
      setVisible(viewRef.current);
    });
    observer.observe(chart);
    return () => observer.disconnect();
  }, [setVisible, wavePhase]);

  useEffect(() => {
    const media = audio.current;
    return () => {
      media?.pause();
      media?.removeAttribute("src");
      media?.load();
    };
  }, []);

  const span = view[1] - view[0] || duration || 1;
  const zoomed = view[0] > 0.01 || view[1] < duration - 0.01;
  const intervals = zoomed ? 4 : 6;
  const visibleSelection = dragSelection ?? selection;
  const panEnd = Math.max(0, duration - span);
  const pan = (start: number) => {
    wave.current?.setScrollTime(Math.max(0, Math.min(panEnd, start)));
    setCursor(null);
  };
  const marker = (position: number) =>
    `${Math.max(0, Math.min(100, ((position - view[0]) / span) * 100))}%`;
  const overlay = (
    <div className="av-chart-overlay" aria-hidden="true">
      {visibleSelection && (
        <div
          className="av-selection"
          style={{
            left: marker(visibleSelection[0]),
            width: `${(Math.max(0, Math.min(view[1], visibleSelection[1]) - Math.max(view[0], visibleSelection[0])) / span) * 100}%`,
          }}
        />
      )}
      <div className="av-playhead" style={{ left: marker(time) }} />
    </div>
  );
  const axis = (
    <div className="av-time-axis">
      {Array.from({ length: intervals + 1 }, (_, i) => {
        const offset = i / intervals;
        const position = view[0] + span * offset;
        return (
          <span key={i} style={{ left: `${100 * offset}%` }}>
            {zoomed
              ? position.toFixed(3) + " s"
              : span < intervals
                ? position.toFixed(2) + " s"
                : formatAudioTime(position)}
          </span>
        );
      })}
    </div>
  );
  return (
    <div
      className={`av-audio v2-audio ${expanded ? "av-expanded" : ""}`}
      style={
        { "--time-grid-step": `${100 / intervals}%` } as React.CSSProperties
      }
      data-testid="audio-preview"
      aria-label="音频预览"
    >
      <div className="v2-tabs" role="tablist" aria-label="音频工作区">
        <button
          role="tab"
          aria-selected={!expanded}
          onClick={() => setExpanded(false)}
        >
          试听
        </button>
        <button
          role="tab"
          aria-selected={expanded}
          onClick={() => setExpanded(true)}
        >
          音频分析
        </button>
      </div>
      <audio
        ref={audio}
        src={path}
        preload="metadata"
        controls={wavePhase === "error" || !!playError}
        style={{
          display: wavePhase === "error" || playError ? "block" : "none",
          width: "100%",
        }}
        onLoadedMetadata={() => {
          const value = audio.current?.duration || 0;
          durationRef.current = value;
          setDuration(value);
          if (audio.current) {
            audio.current.playbackRate = rate;
            audio.current.volume = volume;
          }
          setMetadataReady(true);
          onLoadRef.current();
        }}
        onTimeUpdate={syncPlayback}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          syncPlayback();
          if (audio.current?.ended) setPlaying(false);
        }}
        onVolumeChange={() => setVolume(audio.current?.volume ?? 1)}
        onCanPlay={() => {
          setPlayError("");
          onLoadRef.current();
        }}
        onError={() => {
          setPlayError(
            "浏览器无法播放此音频编码，或文件无法读取。请尝试下载后使用其他播放器打开。",
          );
          onLoadRef.current();
        }}
      />

      {playError && <p role="alert">{playError}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="v2-transport">
        <button
          className="av-button av-primary av-playback-toggle"
          onClick={togglePlay}
          disabled={!metadataReady || !!playError}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <span className="v2-position" data-testid="audio-position">
          {preciseTime(time)} / {preciseTime(duration)}
        </span>
        <label className="v2-volume">
          <V2Icon name="volume" />
          <span>音量 {Math.round(volume * 100)}%</span>
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              if (audio.current) audio.current.volume = Number(e.target.value);
            }}
          />
        </label>
        <select
          className="v2-speed v2-select"
          aria-label="播放速度"
          value={rate}
          onChange={(e) => {
            setRate(Number(e.target.value));
            if (audio.current)
              audio.current.playbackRate = Number(e.target.value);
          }}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
        <span className="av-flex" />
        {expanded && (
          <>
            <button
              className="av-button av-ghost"
              disabled={!selection}
              aria-pressed={loop}
              onClick={() => {
                loopRef.current = !loop;
                setLoop(!loop);
              }}
            >
              循环选区
            </button>
            <button
              className="av-button"
              disabled={!selection}
              onClick={() => selection && setVisible(selection)}
            >
              缩放至选区
            </button>
            {zoomed && (
              <button
                className="av-button av-ghost"
                onClick={() => setVisible([0, duration])}
              >
                显示全段
              </button>
            )}
          </>
        )}
      </div>
      <div className="av-analysis-grid">
        <div className="av-plots">
          <div
            className="av-wave-section"
            style={{ display: wavePhase === "error" ? "none" : "block" }}
          >
            <div className="av-chart-title">
              <span>波形</span>
              <small>归一化振幅 · 声道 1</small>
            </div>
            {wavePhase !== "ready" && size <= MAX_AUDIO_BYTES && (
              <p role="status">正在加载波形…</p>
            )}
            <div className="av-chart-row">
              <div className="av-y-axis">
                <span>+1</span>
                <span>0</span>
                <span>−1</span>
              </div>
              <div className="av-chart" {...chartEvents}>
                <div
                  ref={waveform}
                  data-testid="audio-waveform"
                  aria-label="点击波形定位播放位置"
                />
                {expanded && overlay}
              </div>
            </div>
            {axis}
            {zoomed && panEnd > 0.01 && (
              <input
                type="range"
                className="av-time-scroll"
                aria-label="平移时间窗口"
                aria-valuetext={`${preciseTime(view[0])} – ${preciseTime(view[1])}`}
                min={0}
                max={panEnd}
                step="any"
                value={Math.min(panEnd, view[0])}
                style={
                  {
                    "--time-thumb-width": `${(100 * span) / duration}%`,
                  } as React.CSSProperties
                }
                onChange={(event) => pan(event.currentTarget.valueAsNumber)}
                onKeyDown={(event) => {
                  const positions: Record<string, number> = {
                    ArrowLeft: view[0] - 0.05 * span,
                    ArrowDown: view[0] - 0.05 * span,
                    ArrowRight: view[0] + 0.05 * span,
                    ArrowUp: view[0] + 0.05 * span,
                    PageDown: view[0] - span,
                    PageUp: view[0] + span,
                    Home: 0,
                    End: panEnd,
                  };
                  if (!(event.key in positions)) return;
                  event.preventDefault();
                  pan(positions[event.key]);
                }}
              />
            )}
          </div>
          {!expanded && (
            <>
              <p className="v2-wave-tip">点击波形定位；空格键播放或暂停。</p>
              <div className="v2-analysis-invite">
                <div>
                  <h3>需要查看频率与时间选区？</h3>
                  <p>频谱仅在进入音频分析后计算。</p>
                </div>
                <button
                  className="av-button"
                  onClick={() => setExpanded(true)}
                  disabled={wavePhase !== "ready"}
                >
                  展开频谱图
                </button>
              </div>
            </>
          )}
          <div id="audio-spectrogram" hidden={!expanded}>
            <div className="av-spectrum-title">
              <span>频谱</span>
              <small>{frequencyRange}</small>
            </div>
            {spectrumPhase === "loading" && <p role="status">正在计算频谱</p>}
            {spectrumError && (
              <p role="alert">
                {spectrumError}{" "}
                <button
                  className="v2-text-button"
                  onClick={() => {
                    invalidateSpectrum();
                    setSpectrumError("");
                    setExpanded(false);
                    setTimeout(() => setExpanded(true), 0);
                  }}
                >
                  重试
                </button>
              </p>
            )}
            <div className="av-chart-row">
              <div className="av-y-axis av-frequency-axis">
                {ticks.map(({ hz, top }) => (
                  <span key={hz} data-frequency={hz} style={{ top: top + "%" }}>
                    {hz >= 1000 ? `${hz / 1000}k` : hz || "0 Hz"}
                  </span>
                ))}
              </div>
              <div className="av-chart av-spectrum" {...chartEvents}>
                <div ref={spectrum} data-testid="audio-spectrogram-canvas" />
                <div className="av-frequency-grid" aria-hidden="true">
                  {ticks.slice(1, -1).map(({ hz, top }) => (
                    <span
                      key={hz}
                      data-frequency={hz}
                      style={{ top: top + "%" }}
                    />
                  ))}
                </div>
                {overlay}
              </div>
            </div>
            {axis}
          </div>
        </div>
        {expanded && (
          <aside className="av-analysis-inspector">
            <section>
              <h3>时间选区</h3>
              <dl>
                <dt>起点</dt>
                <dd data-testid="selection-start">
                  {selection ? preciseTime(selection[0]) : "—"}
                </dd>
                <dt>终点</dt>
                <dd data-testid="selection-end">
                  {selection ? preciseTime(selection[1]) : "—"}
                </dd>
                <dt>时长</dt>
                <dd>
                  {selection
                    ? (selection[1] - selection[0]).toFixed(3) + " s"
                    : "—"}
                </dd>
              </dl>
              <button
                className="av-button av-ghost"
                disabled={!selection}
                onClick={clearSelection}
              >
                清除选区
              </button>
            </section>
            <section>
              <h3>游标读数</h3>
              <p className="v2-cursor-reading">
                {preciseTime(cursor?.time ?? time)} ·{" "}
                {cursor && Number.isFinite(cursor.frequency)
                  ? cursor.frequency >= 1000
                    ? (cursor.frequency / 1000).toFixed(2) + " kHz"
                    : Math.round(cursor.frequency) + " Hz"
                  : "—"}{" "}
                · — dBFS
              </p>
            </section>
            <section>
              <h3>分析参数</h3>
              <p>
                FFT {fft} · {windowFunction === "hann" ? "汉宁窗" : "海明窗"}
              </p>
              <p>
                重叠 {overlap * 100}% · {frequencyRange}
              </p>
              <button
                className="av-button"
                onClick={() => {
                  setDraft({ fft, overlap, window: windowFunction });
                  setParameters(true);
                }}
              >
                调整参数
              </button>
            </section>
          </aside>
        )}
      </div>
      <footer className="av-audio-footer">
        {expanded
          ? "拖出选区，松手即播放 · 双图同步定位 · 滚轮缩放时间轴 · 相对强度未标定绝对电平"
          : "试听不修改原文件。"}
      </footer>
      {parameters && (
        <Modal
          title="分析参数"
          description="参数只影响当前频谱计算。"
          onClose={() => setParameters(false)}
          footer={
            <>
              <button
                className="av-button"
                onClick={() => setParameters(false)}
              >
                取消
              </button>
              <button
                className="av-button av-primary"
                onClick={() => {
                  invalidateSpectrum();
                  setFFT(draft.fft);
                  setOverlap(draft.overlap);
                  setWindowFunction(draft.window as "hann" | "hamming");
                  setSpectrumRevision((revision) => revision + 1);
                  setParameters(false);
                }}
              >
                重新计算
              </button>
            </>
          }
        >
          <FieldLabel label="FFT">
            <select
              className="v2-select"
              value={draft.fft}
              onChange={(e) =>
                setDraft((d) => ({ ...d, fft: Number(e.target.value) }))
              }
            >
              {[512, 1024, 2048].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="窗函数">
            <select
              className="v2-select"
              value={draft.window}
              onChange={(e) =>
                setDraft((d) => ({ ...d, window: e.target.value }))
              }
            >
              <option value="hann">汉宁窗</option>
              <option value="hamming">海明窗</option>
            </select>
          </FieldLabel>
          <FieldLabel label="重叠">
            <select
              className="v2-select"
              value={draft.overlap}
              onChange={(e) =>
                setDraft((d) => ({ ...d, overlap: Number(e.target.value) }))
              }
            >
              <option value="0.5">50%</option>
              <option value="0.75">75%</option>
            </select>
          </FieldLabel>
          <FieldLabel label="频率轴">
            <input className="av-field" readOnly value="线性 Hz" />
          </FieldLabel>
        </Modal>
      )}
    </div>
  );
};
export default PreviewAudio;
