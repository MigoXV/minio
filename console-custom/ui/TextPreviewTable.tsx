// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useMemo, useState } from "react";
import { parse } from "csv-parse/browser/esm/sync";
import { State } from "./V2";

const ROWS_PER_PAGE = 50;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 100;

function parseTable(text: string, delimiter: string, truncated: boolean) {
  const rows: string[][] = [];
  const end = new TextEncoder().encode(text).length;
  let columns = 0;
  try {
    parse(text, {
      delimiter,
      bom: true,
      relax_column_count: true,
      to: MAX_ROWS + 2, // Keep room for a header and for detecting overflow.
      on_record(record: string[], info) {
        // A parser can emit the final fragment as a record at EOF.
        const { bytes } = info as typeof info & { bytes: number };
        if (!truncated || bytes < end || /[\r\n]$/.test(text)) {
          columns = Math.max(columns, record.length);
          rows.push(record.slice(0, MAX_COLUMNS));
        }
        return null;
      },
    });
  } catch (error) {
    if (
      !truncated ||
      (error as { code?: string }).code !== "CSV_QUOTE_NOT_CLOSED"
    ) {
      return null;
    }
  }
  return { rows, columns };
}

export default function TextPreviewTable({
  text,
  delimiter,
  truncated,
  showRaw,
}: {
  text: string;
  delimiter: string;
  truncated: boolean;
  showRaw: () => void;
}) {
  const [header, setHeader] = useState(true);
  const [page, setPage] = useState(0);
  const parsed = useMemo(
    () => parseTable(text, delimiter, truncated),
    [text, delimiter, truncated],
  );
  if (!parsed || !parsed.rows.length) {
    return (
      <State
        title={parsed ? "预览范围内没有完整记录" : "表格格式无法解析"}
        error={!parsed}
        action={
          <button className="av-button" onClick={showRaw}>
            查看原文
          </button>
        }
      >
        {parsed ? "可查看已读取的文本。" : "可在原文中检查字段和引号。"}
      </State>
    );
  }
  const names = parsed.rows[0];
  const start = header ? 1 : 0;
  const count = Math.min(parsed.rows.length - start, MAX_ROWS);
  const fields = Math.min(parsed.columns, MAX_COLUMNS);
  const pages = Math.max(1, Math.ceil(count / ROWS_PER_PAGE));
  const from = page * ROWS_PER_PAGE;
  const records = parsed.rows.slice(
    from + start,
    start + Math.min(count, from + ROWS_PER_PAGE),
  );
  return (
    <>
      <div className="v2-text-table-tools">
        <label className="v2-text-check">
          <input
            type="checkbox"
            checked={header}
            onChange={(event) => {
              setHeader(event.target.checked);
              setPage(0);
            }}
          />
          首行作为表头
        </label>
        <span className="v2-text-muted">
          {parsed.rows.length - start > MAX_ROWS && "仅显示前 1,000 条数据。 "}
          {parsed.columns > MAX_COLUMNS && "仅显示前 100 列。"}
        </span>
      </div>
      <div
        className="v2-text-scroll"
        tabIndex={0}
        role="region"
        aria-label="表格预览"
      >
        <table className="v2-table v2-text-grid" aria-label="预览表格">
          <thead>
            <tr>
              <th scope="col">行号</th>
              {Array.from({ length: fields }, (_, index) => (
                <th key={index} scope="col">
                  {(header && names[index]) || "列 " + (index + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={index}>
                <th scope="row">{start + from + index + 1}</th>
                {Array.from({ length: fields }, (_, field) => (
                  <td key={field}>{record[field] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="v2-text-pager">
          <button
            className="av-button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <span>
            {page + 1} / {pages} 页
          </span>
          <button
            className="av-button"
            disabled={page + 1 === pages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
