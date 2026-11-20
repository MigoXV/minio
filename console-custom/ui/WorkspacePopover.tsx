// SPDX-License-Identifier: AGPL-3.0-or-later
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./workspacePopover.css";

export default function WorkspacePopover({
  label,
  trigger,
  className,
  children,
  align = "start",
}: {
  label?: string;
  trigger: React.ReactNode;
  className: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = useCallback(() => {
    const element = menu.current;
    const bounds = anchor.current?.getBoundingClientRect();
    if (!element || !bounds || !element.matches(":popover-open")) return;
    const width = document.documentElement.clientWidth;
    const height = window.visualViewport?.height ?? window.innerHeight;
    const roomBelow = height - bounds.bottom - 12;
    const roomAbove = bounds.top - 12;
    const above =
      roomBelow < Math.min(160, element.scrollHeight) && roomAbove > roomBelow;
    element.style.maxHeight =
      Math.max(48, above ? roomAbove : roomBelow) + "px";
    const left =
      align === "end" ? bounds.right - element.offsetWidth : bounds.left;
    element.style.left =
      Math.max(8, Math.min(left, width - element.offsetWidth - 8)) + "px";
    element.style.top =
      (above ? bounds.top - element.offsetHeight - 4 : bounds.bottom + 4) +
      "px";
  }, [align]);
  useLayoutEffect(() => {
    const element = menu.current;
    const source = anchor.current;
    if (!element || !source) return;
    element.popover = "auto";
    source.setAttribute("popovertarget", id);
    const toggle = () => {
      const visible = element.matches(":popover-open");
      setOpen(visible);
      if (visible) place();
    };
    element.addEventListener("toggle", toggle);
    return () => element.removeEventListener("toggle", toggle);
  }, [id, place]);
  useEffect(() => {
    if (!open) return;
    const current = menu.current;
    const content = current?.firstElementChild;
    const size = new ResizeObserver(place);
    if (content) size.observe(content);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      size.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <>
      <button
        type="button"
        ref={anchor}
        className={className}
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
      >
        {trigger}
      </button>
      <div
        id={id}
        className="v2-workspace-popover"
        ref={menu}
        onClick={(event) => {
          if (
            (event.target as Element).closest(
              "button:not(:disabled), a[href]",
            ) &&
            menu.current?.matches(":popover-open")
          )
            menu.current.hidePopover();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.preventDefault();
            menu.current?.hidePopover();
            anchor.current?.focus();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const controls = Array.from(
              menu.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), a[href]",
              ) || [],
            );
            const current = controls.indexOf(
              document.activeElement as HTMLElement,
            );
            if (controls.length) {
              event.preventDefault();
              const next =
                event.key === "ArrowDown"
                  ? current + 1
                  : (current < 0 ? 0 : current) - 1;
              controls[(next + controls.length) % controls.length].focus();
            }
          }
        }}
      >
        {open && <div>{children}</div>}
      </div>
    </>
  );
}
