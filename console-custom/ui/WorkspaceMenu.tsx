// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { hasPermission } from "../common/SecureComponent";
import { IAM_SCOPES } from "../common/SecureComponent/permissions";
import { V2Icon } from "./V2";
import { useAppearance } from "./Appearance";
import ProjectBrand from "./ProjectBrand";
import {
  accessNavigation,
  availableAccessNavigation,
} from "./accessNavigation";
import "./navigation.css";

const docs = "https://docs.min.io/community/minio-object-store/index.html";
const overview = "/manage/overview";

const matches = (path: string, target: string) =>
  path === target || path.startsWith(target + "/");

type Panel = "access" | "more" | "mobile";

export default function WorkspaceMenu({
  appearanceOpen,
  openAppearance,
}: {
  appearanceOpen: boolean;
  openAppearance: () => void;
}) {
  const location = useLocation();
  const [panel, setPanel] = useState<Panel | null>(null);
  const accessButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const mobileButton = useRef<HTMLButtonElement>(null);
  const { preference } = useAppearance();
  const path = location.pathname.replace(/\/+$/, "");
  const bucketContext = path.match(
    /^\/(?:browser|manage\/buckets)\/([^/]+)/,
  )?.[1];
  const inAccess = accessNavigation.some(({ area }) =>
    matches(path, "/manage/" + area),
  );
  const accessItems = availableAccessNavigation();
  const showSystem = hasPermission("*", [IAM_SCOPES.ADMIN_SERVER_INFO]);
  const close = () => setPanel(null);
  const toggle = (next: Panel) =>
    setPanel((open) => (open === next ? null : next));
  const trigger = (open: Panel) =>
    open === "access"
      ? accessButton
      : open === "more"
        ? moreButton
        : mobileButton;

  useEffect(() => {
    setPanel(null);
  }, [location.key]);

  useEffect(() => {
    if (!panel) return;
    const opener = trigger(panel).current;
    const menu = document.getElementById(
      opener?.getAttribute("aria-controls") ?? "",
    );
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!opener?.contains(target) && !menu?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPanel(null);
      trigger(panel).current?.focus();
    };
    const mobile = window.matchMedia("(max-width: 700px)");
    mobile.addEventListener("change", close);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      mobile.removeEventListener("change", close);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [panel]);

  const showAppearance = (source: "more" | "mobile") => {
    trigger(source).current?.focus();
    close();
    openAppearance();
  };
  const primary = [
    [
      "存储桶",
      "bucket",
      "/browser",
      matches(path, "/browser") ||
        matches(path, "/buckets") ||
        matches(path, "/manage/buckets"),
    ],
    [
      "系统管理",
      "grid",
      showSystem ? overview : "/license",
      path === "/manage" ||
        matches(path, overview) ||
        matches(path, "/manage/config") ||
        matches(path, "/license"),
    ],
    ["访问管理", "users", "/manage/" + accessItems[0].area, inAccess],
  ] as const;
  const hoverMenu = (target: "access" | "more") => ({
    onPointerMove: (event: React.PointerEvent) => {
      // Resizing can move a trigger under a stationary pointer.
      if (event.pointerType === "mouse" && panel !== target) setPanel(target);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse")
        setPanel((open) => (open === target ? null : open));
    },
  });
  const openMenu = (event: React.MouseEvent, target: "access" | "more") => {
    if (
      event.detail &&
      (event.nativeEvent as PointerEvent).pointerType === "mouse"
    ) {
      setPanel(target);
    } else {
      toggle(target);
    }
  };
  const linkState = (label: string) =>
    label === "系统管理" && bucketContext ? { bucketContext } : undefined;
  const accessOpen = panel === "access";
  const moreOpen = panel === "more";
  const mobileOpen = panel === "mobile";
  const moreItems = (className: string, mobile: boolean) => (
    <>
      <a
        className={className}
        href={docs}
        target="_blank"
        rel="noreferrer"
        onClick={close}
      >
        {mobile && <V2Icon name="help" />}
        使用文档
      </a>
      <button
        type="button"
        className={className}
        aria-current={appearanceOpen ? "page" : undefined}
        onClick={() => showAppearance(mobile ? "mobile" : "more")}
      >
        {mobile && <V2Icon name="sun" />}
        {mobile
          ? "外观 · " +
            (preference === "system"
              ? "跟随系统"
              : preference === "vallum"
                ? "白垣"
                : "苍渊")
          : "外观设置"}
      </button>
      <Link className={className} to="/logout" onClick={close}>
        {mobile && <V2Icon name="logout" />}
        退出登录
      </Link>
    </>
  );

  return (
    <header className="v2-navigation">
      <nav className="v2-top-nav" aria-label="主导航">
        <ProjectBrand className="v2-top-brand" />
        <div className="v2-top-links">
          {primary.map(([label, , to, current]) =>
            label === "访问管理" ? (
              <div
                key={label}
                className="v2-top-disclosure"
                {...hoverMenu("access")}
              >
                <button
                  type="button"
                  ref={accessButton}
                  className="v2-top-link"
                  aria-expanded={accessOpen}
                  aria-controls="v2-access-menu"
                  aria-current={!appearanceOpen && current ? "true" : undefined}
                  onClick={(event) => openMenu(event, "access")}
                >
                  {label}
                </button>
                <div
                  id="v2-access-menu"
                  className="v2-top-panel v2-access-menu"
                  hidden={!accessOpen}
                >
                  <strong>{label}</strong>
                  {[
                    ["users", "groups"],
                    ["policies", "keys"],
                  ].map((areas) => (
                    <div key={areas[0]}>
                      {accessItems
                        .filter(({ area }) => areas.includes(area))
                        .map(({ area, label }) => (
                          <Link
                            key={area}
                            className="v2-top-menu-link"
                            to={"/manage/" + area}
                            aria-current={
                              !appearanceOpen &&
                              matches(path, "/manage/" + area)
                                ? "page"
                                : undefined
                            }
                            onClick={close}
                          >
                            {label}
                          </Link>
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Link
                key={label}
                className="v2-top-link"
                to={to}
                state={linkState(label)}
                aria-current={!appearanceOpen && current ? "page" : undefined}
                onClick={close}
              >
                {label}
              </Link>
            ),
          )}
        </div>
        <div className="v2-top-disclosure v2-top-more" {...hoverMenu("more")}>
          <button
            type="button"
            ref={moreButton}
            className="v2-top-link"
            aria-expanded={moreOpen}
            aria-controls="v2-more-menu"
            aria-current={appearanceOpen ? "true" : undefined}
            onClick={(event) => openMenu(event, "more")}
          >
            更多
          </button>
          <div
            id="v2-more-menu"
            className="v2-top-panel v2-more-menu"
            hidden={!moreOpen}
          >
            {moreItems("v2-top-menu-link", false)}
          </div>
        </div>
      </nav>
      <div className="v2-mobile-top">
        <ProjectBrand className="v2-top-brand" />
        <button
          type="button"
          ref={mobileButton}
          className="v2-mobile-nav av-button av-ghost"
          aria-label="导航"
          aria-expanded={mobileOpen}
          aria-controls="v2-mobile-menu"
          onClick={() => toggle("mobile")}
        >
          <V2Icon name="mobileMenu" />
        </button>
      </div>
      <nav
        id="v2-mobile-menu"
        className="v2-nav"
        aria-label="主导航"
        hidden={!mobileOpen}
      >
        {primary.map(([label, icon, to, current]) => (
          <Link
            key={label}
            className="v2-nav-link"
            to={to}
            state={linkState(label)}
            aria-current={!appearanceOpen && current ? "page" : undefined}
            onClick={close}
          >
            <V2Icon name={icon} />
            {label}
          </Link>
        ))}
        <div className="v2-nav-footer">{moreItems("v2-nav-link", true)}</div>
      </nav>
    </header>
  );
}
