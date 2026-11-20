// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppearancePage } from "./Appearance";
import WorkspaceMenu from "./WorkspaceMenu";

export default function ConsoleLayout({
  showNavigation,
  children,
}: {
  showNavigation: boolean;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const appearanceOpen =
    showNavigation && location.state?.minioAppearance === true;
  const workspace = useRef<HTMLDivElement>(null);
  const appearance = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!appearanceOpen) return;
    const contents = workspace.current;
    const previous = document.activeElement as HTMLElement | null;
    contents?.setAttribute("inert", "");
    appearance.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.focus();
    return () => {
      contents?.removeAttribute("inert");
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [appearanceOpen]);

  useLayoutEffect(() => {
    if (!appearanceOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) navigate(-1);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [appearanceOpen, navigate]);

  return (
    <div className="v2-console">
      {showNavigation && (
        <WorkspaceMenu
          appearanceOpen={appearanceOpen}
          openAppearance={() => {
            if (!appearanceOpen)
              navigate(location, {
                state: { ...location.state, minioAppearance: true },
              });
          }}
        />
      )}
      <div className="v2-workspace">
        <div className="v2-workspace-content" ref={workspace}>
          {children}
        </div>
        {appearanceOpen && (
          <div className="v2-workspace-appearance" ref={appearance}>
            <AppearancePage />
          </div>
        )}
      </div>
    </div>
  );
}
