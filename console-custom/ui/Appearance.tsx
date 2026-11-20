// SPDX-License-Identifier: AGPL-3.0-or-later
import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { ThemeProvider } from "styled-components";
import { useAppDispatch } from "../store";
import { setDarkMode } from "../systemSlice";
import "./tokens.css";
import "./workspace.css";
import "./fields.css";
import "./license.css";
import "./v2.css";
import Icon from "./Icon";
import { PageHeader, V2Icon } from "./V2";
type Preference = "system" | "vallum" | "abyssus";
const labels = {
  system: "跟随系统",
  vallum: "浅色 · 白垣",
  abyssus: "深色 · 苍渊",
};
const Context = createContext<{
  preference: Preference;
  effective: "vallum" | "abyssus";
  choose: (p: Preference) => void;
}>({
  preference: "system",
  effective: "vallum",
  choose: () => {},
});
export const useAppearance = () => useContext(Context);
const css = (name: string) => `var(--${name})`;
function adaptTheme(base: any): any {
  // Preserve MDS's full theme shape; replace color leaves using their semantic roles.
  const map = (object: any, path = ""): any =>
    Object.fromEntries(
      Object.entries(object).map(([key, value]) => {
        const p = `${path}.${key}`;
        if (value && typeof value === "object") return [key, map(value, p)];
        if (typeof value !== "string" || !/^(#|rgb)/.test(value))
          return [key, value];
        let token = /border|divider/i.test(key)
          ? "border"
          : /background|bg|containerColor/i.test(key)
            ? "surface"
            : /disabled|muted|secondary|placeholder|subtitle/i.test(key)
              ? "text-secondary"
              : "text-primary";
        if (/hover/i.test(p) && /background|bg/i.test(key)) token = "hover";
        if (/focus/i.test(p)) token = "focus";
        if (/danger|error|delete/i.test(p)) token = "av-danger";
        return [key, css(token)];
      }),
    );
  const theme = map(base);
  theme.bgColor = css("bg-primary");
  // MDS global styles read this top-level key for section, fieldset, and hr.
  // Without it they fall back to the library's light gray in dark mode.
  theme.borderColor = css("border");
  theme.boxBackground = css("surface");
  theme.dataTable = {
    ...theme.dataTable,
    selected: css("text-primary"),
    hoverColor: css("hover"),
  };
  theme.pageHeader = {
    background: css("bg-primary"),
    border: css("border"),
    color: css("text-primary"),
  };
  theme.modalBox = {
    ...theme.modalBox,
    containerColor: css("surface"),
    overlayColor: "color-mix(in srgb, var(--bg-secondary) 85%, transparent)",
  };
  for (const variant of ["callAction", "secondary", "regular", "text"]) {
    for (const state of ["enabled", "hover", "pressed", "disabled"]) {
      const primary = variant === "callAction";
      theme.buttons[variant][state] = {
        background: css(
          primary
            ? "button-primary-bg"
            : state === "hover"
              ? "hover"
              : "surface",
        ),
        text: css(primary ? "button-primary-text" : "text-primary"),
        iconColor: css(primary ? "button-primary-text" : "text-primary"),
        border: css(primary ? "button-primary-bg" : "border"),
      };
    }
  }
  return theme;
}
export function AppearanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const [preference, setPreference] = useState<Preference>(() => {
    try {
      const p = localStorage.getItem("minio-appearance");
      return p === "vallum" || p === "abyssus" ? p : "system";
    } catch {
      return "system";
    }
  });
  const [dark, setDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const effective =
    preference === "system" ? (dark ? "abyssus" : "vallum") : preference;
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setDark(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.colorScheme =
      effective === "abyssus" ? "dark" : "light";
    dispatch(setDarkMode(effective === "abyssus"));
  }, [effective, dispatch]);
  const choose = (p: Preference) => {
    setPreference(p);
    try {
      localStorage.setItem("minio-appearance", p);
    } catch {}
  };
  return (
    <Context.Provider
      value={{
        preference,
        effective,
        choose,
      }}
    >
      <ThemeProvider theme={adaptTheme}>{children}</ThemeProvider>
    </Context.Provider>
  );
}
export function AppearancePage() {
  const { preference, choose } = useAppearance();
  return (
    <main className="v2-page v2-appearance-page">
      <PageHeader title="外观" description="选择适合当前环境的界面主题。" />
      <div className="v2-appearance-options">
        {(["vallum", "abyssus", "system"] as Preference[]).map((p) => (
          <button
            key={p}
            aria-pressed={preference === p}
            onClick={() => choose(p)}
          >
            <V2Icon
              size={20}
              name={
                p === "vallum" ? "sun" : p === "abyssus" ? "settings" : "grid"
              }
            />
            <div>
              <span>{labels[p]}</span>
              <small>
                {p === "system"
                  ? "随设备外观自动切换。"
                  : p === "vallum"
                    ? "温和的石素背景，适合日常管理。"
                    : "深渊与夜海层次，适合低光环境。"}
              </small>
            </div>
            {preference === p && <V2Icon name="check" />}
          </button>
        ))}
      </div>
      <p className="v2-muted">
        切换主题保留当前对象、播放位置、音量、倍速与时间选区。
      </p>
    </main>
  );
}
export default function AppearanceMenu({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { preference, choose } = useAppearance();
  const [open, setOpen] = useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div
      className="av-appearance"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          root.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        className="av-button av-ghost"
        type="button"
        aria-label="外观主题"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {!compact && (
          <Icon
            name={
              preference === "system"
                ? "system"
                : preference === "vallum"
                  ? "sun"
                  : "moon"
            }
          />
        )}
        {compact
          ? "外观 · " +
            (preference === "system"
              ? "跟随系统"
              : preference === "vallum"
                ? "白垣"
                : "苍渊")
          : labels[preference]}
        {!compact && <Icon name="down" />}
      </button>
      {open && (
        <div className="av-theme-menu" role="group" aria-label="选择外观主题">
          <strong>外观主题</strong>
          {(["vallum", "abyssus", "system"] as Preference[]).map((p) => (
            <button
              type="button"
              key={p}
              aria-pressed={preference === p}
              onClick={() => {
                choose(p);
                setOpen(false);
              }}
            >
              <Icon
                name={
                  p === "system" ? "system" : p === "vallum" ? "sun" : "moon"
                }
              />
              {labels[p]}
              <span>{preference === p ? <Icon name="check" /> : null}</span>
            </button>
          ))}
          <small>跟随系统自动适应设备外观</small>
        </div>
      )}
    </div>
  );
}
