// SPDX-License-Identifier: AGPL-3.0-or-later
import React, {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { api } from "../api";
import { BucketObject } from "../api/consoleApi";
import PreviewAudio from "../screens/Console/Buckets/ListBuckets/Objects/Preview/PreviewAudio";
import { State, V2Icon } from "./V2";
import { objectURL } from "./BrowserWorkspace";
import { isAudioObject } from "./objectListing";
import { knownBinary } from "./textPreview";
import videoPlayIcon from "./assets/v2/v2-video-play.svg";
import "./objectPreview.css";
pdfjs.GlobalWorkerOptions.workerSrc = "/scripts/pdf.worker.min.mjs";
const TextPreview = lazy(() => import("./TextPreview"));
export default function ObjectPreview({
  bucket,
  object,
  loading,
  onPrevious,
  onNext,
  onClose,
  download,
}: {
  bucket: string;
  object: BucketObject;
  loading: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  download: () => void;
}) {
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const backdropPointer = useRef(false);
  const name = object.name || "";
  const filename = name.split("/").pop() || name;
  const version = object.version_id || "";

  useLayoutEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [bucket, name, version]);

  return (
    <div
      className="v2-preview-layer"
      onPointerDown={(event) => {
        backdropPointer.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPointer.current && event.target === event.currentTarget)
          onClose();
      }}
    >
      <dialog
        open
        className="v2-preview"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            event.defaultPrevented ||
            target.closest("dialog") !== event.currentTarget
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            target.closest(
              "input, select, textarea, [contenteditable], [role='tab'], audio, video",
            )
          )
            return;
          const move =
            event.key === "ArrowLeft"
              ? onPrevious
              : event.key === "ArrowRight"
                ? onNext
                : undefined;
          if (move) {
            event.preventDefault();
            move();
          }
        }}
      >
        <header className="v2-preview-header">
          <h2 id={titleId} title={filename} aria-live="polite">
            {filename}
          </h2>
          <div className="v2-preview-actions">
            <div
              className="v2-preview-navigation"
              role="group"
              aria-label="切换预览对象"
            >
              <button
                type="button"
                className="av-button av-ghost"
                aria-label="上一个对象"
                title="上一个对象（←）"
                disabled={!onPrevious}
                onClick={onPrevious}
              >
                <V2Icon name="next" size={16} />
              </button>
              <button
                type="button"
                className="av-button av-ghost"
                aria-label="下一个对象"
                title="下一个对象（→）"
                disabled={!onNext}
                onClick={onNext}
              >
                <V2Icon name="next" size={16} />
              </button>
            </div>
            <button
              type="button"
              className="av-button av-ghost"
              onClick={download}
            >
              下载
            </button>
          </div>
          <button
            ref={close}
            type="button"
            className="av-button av-ghost v2-preview-close"
            aria-label="关闭预览"
            title="关闭预览（Esc）"
            onClick={onClose}
          >
            <V2Icon name="close" size={16} />
          </button>
        </header>
        <div className="v2-preview-body" ref={body}>
          {loading ? (
            <p className="v2-preview-status" role="status">
              正在读取文件信息…
            </p>
          ) : (
            <PreviewContent
              key={JSON.stringify([bucket, name, version])}
              bucket={bucket}
              object={object}
              download={download}
            />
          )}
        </div>
      </dialog>
    </div>
  );
}

function PreviewContent({
  bucket,
  object,
  download,
}: {
  bucket: string;
  object: BucketObject;
  download: () => void;
}) {
  const name = object.name || "",
    path = objectURL(bucket, name, object.version_id, true);
  const [resolvedType, setResolvedType] = useState<string | null>(null);
  const type = object.content_type || resolvedType || "";
  const resolving = !object.content_type && resolvedType === null;
  const ext = name.split(".").pop()?.toLowerCase() || "",
    audio = isAudioObject(name, type),
    pdf = type === "application/pdf" || ext === "pdf",
    video = type.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext),
    picture =
      type.startsWith("image/") ||
      ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext);
  const [error, setError] = useState(""),
    [pages, setPages] = useState(0),
    [page, setPage] = useState(1),
    [width, setWidth] = useState(600),
    [playing, setPlaying] = useState(false),
    [videoTime, setVideoTime] = useState(0),
    [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleVideo = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused)
      void videoRef.current
        .play()
        .catch(() => setError("浏览器无法播放此视频编码，请下载后查看。"));
    else videoRef.current.pause();
  };
  const clock = (n: number) =>
    String(Math.floor(n / 60)).padStart(2, "0") +
    ":" +
    String(Math.floor(n % 60)).padStart(2, "0");
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = videoRef.current;
    return () => media?.pause();
  }, [video, resolving]);
  useEffect(() => {
    if (object.content_type) return;
    const request = new AbortController();
    api.buckets
      .getObjectMetadata(
        bucket,
        {
          prefix: name,
          versionID: object.version_id || "",
        },
        { signal: request.signal },
      )
      .then(({ data }) => {
        if (request.signal.aborted) return;
        const metadata = data.objectMetadata;
        setResolvedType(
          String(
            metadata?.["Content-Type"] || metadata?.["content-type"] || "",
          ),
        );
      })
      .catch(() => {
        if (!request.signal.aborted) setResolvedType("");
      });
    return () => request.abort();
  }, [bucket, name, object.content_type, object.version_id]);
  useEffect(() => {
    if (!pdf || !frame.current) return;
    const ro = new ResizeObserver((entries) =>
      setWidth(Math.min(520, Math.floor(entries[0].contentRect.width))),
    );
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [pdf, resolving]);
  if (resolving)
    return (
      <p className="v2-preview-status" role="status">
        正在读取文件信息…
      </p>
    );
  return (
    <>
      {audio ? (
        <PreviewAudio
          key={path}
          path={path}
          size={object.size}
          name={name}
          bucket={bucket}
          onLoad={() => {}}
          downloadFile={download}
        />
      ) : (
        <>
          {error ? (
            <State
              title="无法预览此文件"
              error
              action={
                <button className="av-button" onClick={download}>
                  下载文件
                </button>
              }
            >
              {error}
            </State>
          ) : picture ? (
            <>
              <div ref={frame} className="v2-media-stage v2-image-stage">
                <img
                  src={path}
                  alt={name}
                  onError={() => setError("图片无法读取，请下载后查看。")}
                />
              </div>
            </>
          ) : pdf ? (
            <>
              <div ref={frame} className="v2-media-stage v2-pdf-stage">
                <Document
                  file={path}
                  loading={<p role="status">正在加载文档…</p>}
                  onLoadSuccess={({ numPages }) => setPages(numPages)}
                  onLoadError={() => setError("PDF 无法读取，请下载后查看。")}
                >
                  <Page
                    pageNumber={page}
                    width={width}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    onRenderError={() =>
                      setError("此页无法渲染，请下载后查看。")
                    }
                  />
                </Document>
              </div>
              <div className="v2-media-controls">
                <button
                  className="av-button av-ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {page} 页 / 共 {pages || "—"} 页
                </span>
                <button
                  className="av-button av-ghost"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          ) : video ? (
            <>
              <div className="v2-media-stage v2-video-stage">
                <video
                  ref={videoRef}
                  preload="metadata"
                  src={path}
                  onLoadedMetadata={() =>
                    setVideoDuration(videoRef.current?.duration || 0)
                  }
                  onTimeUpdate={() =>
                    setVideoTime(videoRef.current?.currentTime || 0)
                  }
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onClick={toggleVideo}
                  onError={() =>
                    setError("浏览器无法播放此视频编码，请下载后查看。")
                  }
                />
                {!playing && (
                  <button
                    className="v2-video-overlay"
                    aria-label="播放视频"
                    onClick={toggleVideo}
                  >
                    <span
                      style={{
                        maskImage: "url(" + videoPlayIcon + ")",
                        WebkitMaskImage: "url(" + videoPlayIcon + ")",
                      }}
                    />
                    {name.split("/").pop()}
                  </button>
                )}
              </div>
              <div className="v2-media-controls v2-video-controls">
                <button className="av-button" onClick={toggleVideo}>
                  {playing ? "暂停" : "播放"}
                </button>
                <label className="v2-video-position">
                  {clock(videoTime)} / {clock(videoDuration)}
                  <input
                    type="range"
                    aria-label="视频播放位置"
                    min="0"
                    max={videoDuration || 1}
                    step=".1"
                    value={videoTime}
                    onChange={(e) => {
                      if (videoRef.current)
                        videoRef.current.currentTime = Number(e.target.value);
                    }}
                  />
                </label>
                <span style={{ flex: 1 }} />
                <span>播放能力取决于浏览器的编解码支持。</span>
              </div>
            </>
          ) : knownBinary(name, type) ? (
            <div className="v2-unsupported">
              <h2>此文件暂不支持在线预览</h2>
              <p>下载文件后，使用本地应用打开。</p>
              <button className="av-button av-primary" onClick={download}>
                下载文件
              </button>
            </div>
          ) : (
            <Suspense fallback={<p role="status">正在加载文本预览…</p>}>
              <TextPreview
                key={path}
                name={name}
                type={type}
                path={path}
                size={object.size}
                download={download}
              />
            </Suspense>
          )}
        </>
      )}
    </>
  );
}
