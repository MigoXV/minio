// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { BucketObject } from "../api/consoleApi";
import PreviewAudio from "../screens/Console/Buckets/ListBuckets/Objects/Preview/PreviewAudio";
import { PageHeader, State, V2Icon, bytes } from "./V2";
import { objectURL } from "./BrowserWorkspace";
import { isAudioObject } from "./objectListing";
import videoPlayIcon from "./assets/v2/v2-video-play.svg";
pdfjs.GlobalWorkerOptions.workerSrc = "/scripts/pdf.worker.min.mjs";
export default function PreviewPage({
  bucket,
  object,
  onBack,
  download,
}: {
  bucket: string;
  object: BucketObject;
  onBack: () => void;
  download: () => void;
}) {
  const name = object.name || "",
    type = object.content_type || "",
    path = objectURL(bucket, name, object.version_id, true);
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
    setError("");
    setPages(0);
    setPage(1);
  }, [path]);
  useEffect(() => {
    if (!frame.current) return;
    const ro = new ResizeObserver((entries) =>
      setWidth(Math.min(320, Math.max(240, entries[0].contentRect.width - 64))),
    );
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [audio]);
  return (
    <main className="v2-page v2-preview">
      <button className="v2-back v2-text-button" onClick={onBack}>
        <V2Icon name="back" />
        {audio ? "返回 " + bucket : "返回对象浏览"}
      </button>
      <PageHeader
        title={name.split("/").pop()}
        description={
          audio
            ? bucket +
              " / " +
              name +
              " · " +
              (type || "application/octet-stream") +
              " · " +
              bytes(object.size)
            : bucket + " / " + name
        }
        actions={
          <button
            className="av-button"
            id={audio ? "audio-download" : "download-preview"}
            onClick={download}
          >
            {audio ? "下载音频" : "下载"}
          </button>
        }
      />
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
          ) : (
            <div className="v2-unsupported">
              <h2>此文件暂不支持在线预览</h2>
              <p>下载文件后，使用本地应用打开。</p>
              <button className="av-button av-primary" onClick={download}>
                下载文件
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
