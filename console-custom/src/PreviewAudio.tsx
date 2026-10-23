// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useRef, useState } from "react";
import AppearanceMenu, { useAppearance } from "custom/Appearance";
import Icon from "custom/Icon";
import {
  TimeRange,
  clampRange,
  zoomRange,
  preciseTime,
} from "custom/analysisView";
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
  const [volume, setVolume] = useState(1);
  const [selection, setSelection] = useState<TimeRange | null>(null);
  const [view, setView] = useState<TimeRange>([0, 0]);
  const [loop, setLoop] = useState(false);
  const [cursor, setCursor] = useState<{
    time: number;
    frequency: number;
  } | null>(null);
  const [fft, setFFT] = useState(1024);
  const [overlap, setOverlap] = useState(0.75);
  const [windowFunction, setWindowFunction] = useState<"hann" | "hamming">(
    "hann",
  );
  const drag = useRef<{ x: number; time: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const loopRef = useRef({ loop, selection });
  loopRef.current = { loop, selection };
  const themeColors = () => {
    const css = getComputedStyle(document.documentElement);
    return {
      waveColor: css.getPropertyValue("--wave-color").trim(),
      progressColor: css.getPropertyValue("--wave-progress").trim(),
      cursorColor: css.getPropertyValue("--text-secondary").trim(),
    };
  };
  const togglePlay = () => {
    const media = audio.current;
    if (!media) return;
    if (media.paused) {
      if (
        loop &&
        selection &&
        (media.currentTime < selection[0] || media.currentTime >= selection[1])
      )
        media.currentTime = selection[0];
      void media
        .play()
        .catch(() => setPlayError("播放失败，请重试或下载音频。"));
    } else media.pause();
  };
  const setVisible = (range: TimeRange) => {
    if (!wave.current || !waveform.current || !duration) return;
    let next = clampRange(range[0], range[1], duration);
    const minSpan = Math.max(
      0.05,
      (duration * wave.current.getWidth()) / 24000,
    );
    if (next[1] - next[0] < minSpan) {
      const start = Math.max(0, Math.min(duration - minSpan, next[0]));
      next = [start, Math.min(duration, start + minSpan)];
    }
    setView(next);
    viewRef.current = next;
    wave.current.zoom(
      wave.current.getWidth() / Math.max(0.05, next[1] - next[0]),
    );
    wave.current.setScrollTime(next[0]);
  };
  const clearSelection = () => {
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
        ? Math.max(
            0,
            Math.min(
              sampleRate / 2,
              ((1 - (event.clientY - rect.top) / rect.height) * sampleRate) / 2,
            ),
          )
        : (cursor?.frequency ?? NaN),
    };
  };
  const chartEvents = {
    onPointerDownCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!expanded || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { x: e.clientX, time: coordinate(e).time };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!expanded) return;
      const point = coordinate(e);
      setCursor(point);
      if (drag.current && Math.abs(e.clientX - drag.current.x) > 4)
        setSelection(clampRange(drag.current.time, point.time, duration));
    },
    onPointerUpCapture: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!expanded || !drag.current) return;
      e.stopPropagation();
      if (Math.abs(e.clientX - drag.current.x) <= 4 && audio.current)
        audio.current.currentTime = coordinate(e).time;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (expanded) e.stopPropagation();
    },
  };
  useEffect(() => {
    if (wavePhase === "ready") wave.current?.setOptions(themeColors());
  }, [effective, wavePhase]);
  useEffect(() => {
    const element = waveform.current;
    if (!element || !expanded) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect(),
        range = viewRef.current;
      const anchor =
        range[0] +
        ((e.clientX - rect.left) / rect.width) * (range[1] - range[0]);
      setVisible(zoomRange(range, anchor, e.deltaY > 0 ? 1.25 : 0.8, duration));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    spectrum.current?.addEventListener("wheel", wheel, { passive: false });
    const sp = spectrum.current;
    return () => {
      element.removeEventListener("wheel", wheel);
      sp?.removeEventListener("wheel", wheel);
    };
    // View is read from a ref to avoid replacing the handler while scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, duration]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.code !== "Space" ||
        /INPUT|SELECT|TEXTAREA|BUTTON/.test((e.target as HTMLElement).tagName)
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
          height: window.innerHeight <= 800 ? 88 : 120,
          ...themeColors(),
          autoScroll: false,
          autoCenter: false,
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
        instance.on("scroll", (start, end) => {
          setView([start, end]);
          syncSpectrum();
        });
        instance.on("redrawcomplete", syncSpectrum);
        instance.on("audioprocess", (position) => {
          const { loop, selection } = loopRef.current;
          if (
            loop &&
            selection &&
            position >= selection[1] &&
            media.currentTime >= selection[1]
          )
            media.currentTime = selection[0];
        });
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
        setView([0, decoded.duration]);
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
        const plugin = Plugin.create({
          container: spectrum.current,
          height: 260,
          labels: false,
          fftSamples: fft,
          noverlap: Math.round(fft * overlap),
          windowFunc: windowFunction,
          scale: "linear",
          frequencyMin: 0,
          frequencyMax: sampleRate / 2,
          useWebWorker: true,
          splitChannels: false,
        });
        spectrogram.current = plugin;
        plugin.on("ready", () => {
          if (disposed) return;
          clearTimeout(timer);
          phase("ready");
        });
        plugin.on("click", (position: number) =>
          wave.current?.seekTo(position),
        );
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
  }, [expanded, wavePhase, sampleRate, fft, overlap, windowFunction]);

  useEffect(() => {
    const resize = () =>
      wave.current?.setOptions({
        height: window.innerHeight <= 800 ? 88 : 120,
      });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const media = audio.current;
    return () => {
      media?.pause();
      media?.removeAttribute("src");
      media?.load();
    };
  }, []);

  const span = view[1] - view[0] || duration || 1;
  const marker = (position: number) =>
    `${Math.max(0, Math.min(100, ((position - view[0]) / span) * 100))}%`;
  const overlay = (
    <div className="av-chart-overlay" aria-hidden="true">
      {selection && (
        <div
          className="av-selection"
          style={{
            left: marker(selection[0]),
            width: `${(Math.max(0, Math.min(view[1], selection[1]) - Math.max(view[0], selection[0])) / span) * 100}%`,
          }}
        />
      )}
      <div className="av-playhead" style={{ left: marker(time) }} />
    </div>
  );
  const axis = (
    <div className="av-time-axis">
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i}>
          {expanded
            ? preciseTime(view[0] + (span * i) / 6)
            : formatAudioTime((duration * i) / 6)}
        </span>
      ))}
    </div>
  );
  const controls = (
    <div className="av-transport">
      <button
        className="av-button av-primary av-playback-toggle"
        onClick={togglePlay}
        disabled={!metadataReady || !!playError}
        aria-label={playing ? "暂停" : "播放"}
      >
        <span className="av-playback-icon" aria-hidden="true">
          {playing ? (
            <span className="av-pause-icon">
              <i />
              <i />
            </span>
          ) : (
            <Icon name="play" />
          )}
        </span>
        {playing ? "暂停" : "播放"}
      </button>
      <span className="av-position" data-testid="audio-position">
        {expanded ? preciseTime(time) : formatAudioTime(time)}{" "}
        <small>
          / {expanded ? preciseTime(duration) : formatAudioTime(duration)}
        </small>
      </span>
      {expanded && (
        <>
          <button
            className="av-button"
            disabled={!selection}
            aria-pressed={loop}
            onClick={() => setLoop(!loop)}
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
        </>
      )}
      <span className="av-flex" />
      <label className="av-volume">
        <Icon name="volume" />
        <input
          aria-label="音量"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            if (audio.current) audio.current.volume = Number(e.target.value);
          }}
        />
      </label>
      <label className="av-speed">
        {!expanded && "播放速度"}{" "}
        <select
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
      </label>
      <button className="av-button" id="audio-download" onClick={downloadFile}>
        <Icon name="download" />
        {expanded ? "下载" : "下载音频"}
      </button>
    </div>
  );
  return (
    <div
      className={`av-audio ${expanded ? "av-expanded" : ""}`}
      data-testid="audio-preview"
      aria-label="音频预览"
    >
      <header className="av-audio-heading">
        <Icon name="audio" />
        <div>
          <strong>{name}</strong>
          <small>
            {bucket} / {name} ·{" "}
            {size ? (size / 1048576).toFixed(2) + " MiB" : ""}
          </small>
        </div>
        <span className="av-flex" />
        <AppearanceMenu />
      </header>
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
          if (audio.current) audio.current.playbackRate = rate;
          setMetadataReady(true);
          onLoadRef.current();
        }}
        onTimeUpdate={() => {
          const media = audio.current;
          if (!media) return;
          if (loop && selection && media.currentTime >= selection[1])
            media.currentTime = selection[0];
          setTime(media.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (loop && selection && audio.current) {
            audio.current.currentTime = selection[0];
            void audio.current.play().catch(() => {});
          } else setPlaying(false);
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
      {expanded && controls}
      <div className="av-analysis-grid">
        <div className="av-plots">
          <div
            className="av-wave-section"
            style={{ display: wavePhase === "error" ? "none" : "block" }}
          >
            <div className="av-chart-title">
              <span>
                波形 <small>{expanded ? "归一化振幅" : ""}</small>
              </span>
              <small>
                {expanded ? "声道 1" : `00:00 — ${formatAudioTime(duration)}`}
              </small>
            </div>
            {wavePhase !== "ready" && size <= MAX_AUDIO_BYTES && (
              <p role="status">正在加载波形…</p>
            )}
            <div className="av-chart-row">
              {expanded && (
                <div className="av-y-axis">
                  <span>+1</span>
                  <span>0</span>
                  <span>−1</span>
                </div>
              )}
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
          </div>
          {!expanded && controls}
          {wavePhase === "ready" && (
            <>
              <div className="av-spectrum-title">
                <span>
                  频谱{!expanded && "图"}{" "}
                  <small>
                    {expanded ? "线性频率 · 相对能量" : "仅在展开后计算"}
                  </small>
                </span>
                {expanded && (
                  <button
                    className="av-button av-ghost"
                    onClick={() => setVisible([0, duration])}
                  >
                    显示全段
                  </button>
                )}
                <button
                  className="av-button av-ghost"
                  aria-expanded={expanded}
                  aria-controls="audio-spectrogram"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? "收起频谱图" : "展开频谱图"}
                </button>
              </div>
              <div id="audio-spectrogram" hidden={!expanded}>
                {spectrumPhase === "loading" && (
                  <p role="status">正在计算频谱图…</p>
                )}
                {spectrumError && <p role="alert">{spectrumError}</p>}
                <div className="av-chart-row">
                  <div className="av-y-axis">
                    {[1, 0.75, 0.5, 0.25, 0].map((v) => (
                      <span key={v}>
                        {v
                          ? `${((sampleRate / 2000) * v).toFixed(1)}k`
                          : "0 Hz"}
                      </span>
                    ))}
                  </div>
                  <div className="av-chart av-spectrum" {...chartEvents}>
                    <div
                      ref={spectrum}
                      data-testid="audio-spectrogram-canvas"
                    />
                    {overlay}
                  </div>
                </div>
                {axis}
                {spectrumPhase === "ready" && (
                  <>
                    <div className="av-spectrum-legend">
                      <span>弱</span>
                      <i />
                      <span>强</span>
                      <span>相对强度 · 未标定绝对电平</span>
                    </div>
                    <p className="av-analysis-caption">
                      频率：0–{Math.round(sampleRate / 2)} Hz · 声道 1 ·{" "}
                      {windowFunction === "hann" ? "Hann" : "Hamming"} / FFT{" "}
                      {fft}
                    </p>
                  </>
                )}
                <p className="av-analysis-caption">
                  拖拽选择时间段 · 双图同步定位 · 滚轮缩放时间轴
                </p>
              </div>
            </>
          )}
        </div>
        {expanded && (
          <aside className="av-analysis-inspector">
            <section>
              <h3>游标读数</h3>
              <dl>
                <dt>时间</dt>
                <dd>{preciseTime(cursor?.time ?? time)}</dd>
                <dt>频率</dt>
                <dd>
                  {cursor && Number.isFinite(cursor.frequency)
                    ? `${(cursor.frequency / 1000).toFixed(2)} kHz`
                    : "—"}
                </dd>
                <dt>绝对电平</dt>
                <dd>— dBFS</dd>
              </dl>
            </section>
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
                    ? `${(selection[1] - selection[0]).toFixed(3)} s`
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
              <h3>分析参数</h3>
              <label>
                FFT
                <select
                  aria-label="FFT"
                  value={fft}
                  onChange={(e) => {
                    invalidateSpectrum();
                    setFFT(Number(e.target.value));
                  }}
                >
                  {[512, 1024, 2048].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                窗函数
                <select
                  aria-label="窗函数"
                  value={windowFunction}
                  onChange={(e) => {
                    invalidateSpectrum();
                    setWindowFunction(e.target.value as "hann" | "hamming");
                  }}
                >
                  <option value="hann">汉宁窗</option>
                  <option value="hamming">海明窗</option>
                </select>
              </label>
              <label>
                重叠
                <select
                  aria-label="重叠"
                  value={overlap}
                  onChange={(e) => {
                    invalidateSpectrum();
                    setOverlap(Number(e.target.value));
                  }}
                >
                  <option value="0.5">50%</option>
                  <option value="0.75">75%</option>
                </select>
              </label>
              <label>
                频率轴<span>线性 Hz</span>
              </label>
              <p>选中频率从原音频计算。图像颜色不能替代 dBFS 读数。</p>
            </section>
          </aside>
        )}
      </div>
      <footer className="av-audio-footer">
        <span>
          {expanded
            ? "音频分析 · 选区只影响试听与分析"
            : "点击波形跳转播放位置。"}
        </span>
        {expanded && <span>空格键 播放 / 暂停 · Esc 关闭</span>}
      </footer>
    </div>
  );
};
export default PreviewAudio;
