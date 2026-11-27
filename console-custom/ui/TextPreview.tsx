// SPDX-License-Identifier: AGPL-3.0-or-later
import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SourceToken } from "./textPreviewHighlight";
import {
  decodeText,
  fetchTextSample,
  FORMATTED_TEXT_BYTES,
  knownBinary,
  textFormat,
  textLanguage,
  TextReadError,
} from "./textPreview";
import type { TextEncoding, TextSample } from "./textPreview";
import { State } from "./V2";
import "./textPreview.css";

const Markdown = lazy(() => import("./TextPreviewMarkdown"));
const Delimited = lazy(() => import("./TextPreviewTable"));
const LINES_PER_PAGE = 250;

function SourceView({
  text,
  language,
  highlight,
}: {
  text: string;
  language: string | undefined;
  highlight: boolean;
}) {
  const source = text.replace(/\r\n?/g, "\n");
  const lines = useMemo(() => source.split("\n"), [source]);
  const [tokens, setTokens] = useState<SourceToken[][]>();
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState(-1);
  const [page, setPage] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [copy, setCopy] = useState<"idle" | "done" | "manual">("idle");
  const region = useRef<HTMLDivElement>(null);
  const selectedLine = useRef<HTMLDivElement>(null);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const matches = useMemo(() => {
    const term = query.toLowerCase();
    const found: number[] = [];
    if (term) {
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(term)) found.push(index);
      });
    }
    return found;
  }, [lines, query]);
  const active = matches[match];
  const pages = Math.ceil(lines.length / LINES_PER_PAGE);

  useEffect(() => {
    if (!highlight || !language) return;
    let current = true;
    void import("./textPreviewHighlight")
      .then(({ highlightLines }) => {
        if (current) setTokens(highlightLines(source, language));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [source, highlight, language]);
  useEffect(() => {
    if (active !== undefined)
      selectedLine.current?.scrollIntoView({ block: "nearest" });
  }, [active, page]);
  useEffect(() => {
    if (copy === "manual") {
      copyField.current?.focus();
      copyField.current?.select();
    }
  }, [copy]);

  function visitMatch(direction: number) {
    if (!matches.length) return;
    const next =
      match === -1
        ? direction > 0
          ? 0
          : matches.length - 1
        : (match + direction + matches.length) % matches.length;
    setMatch(next);
    setPage(Math.floor(matches[next] / LINES_PER_PAGE));
  }

  function visitPage(next: number) {
    setPage(next);
    setMatch(-1);
    if (region.current) region.current.scrollTop = 0;
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("done");
    } catch {
      setCopy("manual");
    }
  }

  return (
    <>
      <div className="v2-text-tools">
        <div className="v2-text-search">
          <input
            className="av-field"
            type="search"
            aria-label="搜索预览内容"
            placeholder="搜索预览内容"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatch(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing)
                visitMatch(event.shiftKey ? -1 : 1);
            }}
          />
          {query && (
            <>
              <button
                className="av-button"
                disabled={!matches.length}
                onClick={() => visitMatch(-1)}
              >
                上一处
              </button>
              <button
                className="av-button"
                disabled={!matches.length}
                onClick={() => visitMatch(1)}
              >
                下一处
              </button>
              <span className="v2-text-muted" role="status">
                {matches.length
                  ? match < 0
                    ? matches.length + " 行匹配"
                    : match + 1 + " / " + matches.length
                  : "无匹配"}
              </span>
            </>
          )}
        </div>
        <label className="v2-text-check">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          自动换行
        </label>
        <button className="av-button" onClick={() => void copyPreview()}>
          复制预览内容
        </button>
        {copy === "done" && (
          <span className="v2-text-muted" role="status">
            已复制
          </span>
        )}
      </div>
      {copy === "manual" && (
        <label className="v2-text-copy">
          <span>请复制已选中的预览内容</span>
          <textarea
            ref={copyField}
            className="av-field"
            readOnly
            value={text}
          />
        </label>
      )}
      <div
        ref={region}
        className="v2-text-scroll"
        tabIndex={0}
        role="region"
        aria-label="文本内容"
      >
        <div
          className={wrap ? "v2-text-source v2-text-wrap" : "v2-text-source"}
        >
          {lines
            .slice(page * LINES_PER_PAGE, (page + 1) * LINES_PER_PAGE)
            .map((line, index) => {
              const row = page * LINES_PER_PAGE + index;
              const lineTokens = tokens?.[row];
              return (
                <div
                  key={row}
                  ref={row === active ? selectedLine : undefined}
                  className="v2-text-line"
                  data-matched={row === active || undefined}
                >
                  <span className="v2-text-line-number" aria-hidden="true">
                    {row + 1}
                  </span>
                  <code>
                    {lineTokens
                      ? lineTokens.map((token, tokenIndex) => (
                          <span
                            className={token.style || undefined}
                            key={tokenIndex}
                          >
                            {token.text}
                          </span>
                        ))
                      : line}
                  </code>
                </div>
              );
            })}
        </div>
      </div>
      {pages > 1 && (
        <div className="v2-text-pager">
          <button
            className="av-button"
            disabled={page === 0}
            onClick={() => visitPage(page - 1)}
          >
            上一页
          </button>
          <span>
            第 {page * LINES_PER_PAGE + 1}–
            {Math.min((page + 1) * LINES_PER_PAGE, lines.length)} 行 / 共{" "}
            {lines.length} 行
          </span>
          <button
            className="av-button"
            disabled={page + 1 === pages}
            onClick={() => visitPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}

export function UnsupportedPreview({ download }: { download: () => void }) {
  return (
    <div className="v2-unsupported">
      <h2>此文件暂不支持在线预览</h2>
      <p>下载文件后，使用本地应用打开。</p>
      <button className="av-button av-primary" onClick={download}>
        下载文件
      </button>
    </div>
  );
}

export default function TextPreview({
  name,
  type,
  path,
  size,
  download,
}: {
  name: string;
  type: string;
  path: string;
  size?: number;
  download: () => void;
}) {
  const initialSize = useRef(size);
  const [sample, setSample] = useState<TextSample>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [encoding, setEncoding] = useState<TextEncoding>("auto");
  const [view, setView] = useState<"raw" | "formatted">();
  const decoded = useMemo(
    () => sample && decodeText(sample, encoding),
    [sample, encoding],
  );

  useEffect(() => {
    const request = new AbortController();
    void fetchTextSample(path, initialSize.current, request.signal)
      .then((next) => {
        if (!request.signal.aborted) setSample(next);
      })
      .catch((failure: unknown) => {
        if (request.signal.aborted) return;
        setError(
          failure instanceof TextReadError &&
            [401, 403].includes(failure.status)
            ? "无法读取对象，请检查登录状态和访问权限。"
            : "读取文件失败，请重试或下载后查看。",
        );
      });
    return () => request.abort();
  }, [path, attempt]);

  if (error) {
    return (
      <State
        title="无法预览此文件"
        error
        action={
          <button
            className="av-button"
            onClick={() => {
              setError("");
              setAttempt(attempt + 1);
            }}
          >
            重试
          </button>
        }
      >
        {error}
      </State>
    );
  }
  if (!sample || !decoded) return <p role="status">正在读取文件…</p>;
  if (knownBinary(name, sample.contentType) || decoded.kind === "binary") {
    return <UnsupportedPreview download={download} />;
  }

  const hint = textFormat(name, type);
  const format = hint === "text" ? textFormat(name, sample.contentType) : hint;
  const isTable = format === "csv" || format === "tsv";
  const isMarkdown = format === "markdown";
  const canRenderMarkdown =
    isMarkdown &&
    !sample.truncated &&
    sample.bytes.length <= FORMATTED_TEXT_BYTES;
  const showFormatted =
    (isTable || canRenderMarkdown) && (view ? view === "formatted" : isTable);
  return (
    <section className="v2-text-preview" aria-label="文本预览">
      <div className="v2-text-bar">
        {decoded.kind === "text" &&
          decoded.text &&
          (isTable || canRenderMarkdown) && (
            <div className="v2-text-views" role="group" aria-label="预览视图">
              <button
                className="av-button av-ghost"
                aria-pressed={showFormatted}
                onClick={() => setView("formatted")}
              >
                {isTable ? "表格" : "渲染"}
              </button>
              <button
                className="av-button av-ghost"
                aria-pressed={!showFormatted}
                onClick={() => setView("raw")}
              >
                {isTable ? "原文" : "源码"}
              </button>
            </div>
          )}
        <label className="v2-text-encoding">
          <span>编码</span>
          <select
            className="av-field"
            aria-label="文本编码"
            value={encoding}
            onChange={(event) =>
              setEncoding(event.target.value as TextEncoding)
            }
          >
            <option value="auto">自动</option>
            <option value="utf-8">UTF-8</option>
            <option value="gb18030">GB18030</option>
          </select>
        </label>
      </div>
      {sample.truncated && (
        <p className="v2-text-notice">仅预览前 1 MiB，完整文件可下载。</p>
      )}
      {isMarkdown && !canRenderMarkdown && (
        <p className="v2-text-notice">
          文件超出 Markdown 渲染范围，当前显示源码。
        </p>
      )}
      {decoded.kind === "encoding" ? (
        <State title="无法解码文本" error>
          请尝试切换编码，或下载文件后查看。
        </State>
      ) : !decoded.text ? (
        <State
          title={sample.truncated ? "预览范围内没有可读文本" : "文件为空"}
        />
      ) : showFormatted ? (
        <Suspense fallback={<p role="status">正在加载视图…</p>}>
          {isTable ? (
            <Delimited
              key={encoding}
              text={decoded.text}
              delimiter={format === "tsv" ? "\t" : ","}
              truncated={sample.truncated}
              showRaw={() => setView("raw")}
            />
          ) : (
            <Markdown text={decoded.text} />
          )}
        </Suspense>
      ) : (
        <SourceView
          key={encoding}
          text={decoded.text}
          language={textLanguage(name)}
          highlight={sample.bytes.length <= FORMATTED_TEXT_BYTES}
        />
      )}
    </section>
  );
}
