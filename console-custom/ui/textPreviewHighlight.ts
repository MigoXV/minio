// SPDX-License-Identifier: AGPL-3.0-or-later
import { refractor } from "refractor/lib/core.js";
import bash from "refractor/lang/bash.js";
import c from "refractor/lang/c.js";
import cpp from "refractor/lang/cpp.js";
import docker from "refractor/lang/docker.js";
import go from "refractor/lang/go.js";
import javascript from "refractor/lang/javascript.js";
import json from "refractor/lang/json.js";
import jsx from "refractor/lang/jsx.js";
import markdown from "refractor/lang/markdown.js";
import markup from "refractor/lang/markup.js";
import python from "refractor/lang/python.js";
import sql from "refractor/lang/sql.js";
import tsx from "refractor/lang/tsx.js";
import typescript from "refractor/lang/typescript.js";
import yaml from "refractor/lang/yaml.js";

[
  markup,
  bash,
  c,
  cpp,
  docker,
  go,
  javascript,
  json,
  jsx,
  markdown,
  python,
  sql,
  typescript,
  tsx,
  yaml,
].forEach((grammar) => refractor.register(grammar));

export type SourceToken = { text: string; style: string };

export function highlightLines(source: string, language: string) {
  const lines: SourceToken[][] = [[]];
  function visit(
    node: ReturnType<typeof refractor.highlight>["children"][number],
    style = "",
  ) {
    if (node.type === "element") {
      const classes = node.properties?.className;
      const token = Array.isArray(classes) ? classes.join(" ") : "";
      node.children.forEach((child) => visit(child, style + " " + token));
    } else if (node.type === "text") {
      node.value.split("\n").forEach((value, index) => {
        if (index > 0) lines.push([]);
        if (value)
          lines[lines.length - 1].push({ text: value, style: style.trim() });
      });
    }
  }
  refractor.highlight(source, language).children.forEach((node) => visit(node));
  return lines;
}
