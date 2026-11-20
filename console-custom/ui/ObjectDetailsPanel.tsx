// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useLayoutEffect, useRef } from "react";

export default function ObjectDetailsPanel({
  children,
  closing,
  onClose,
}: {
  children: React.ReactNode;
  closing: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const narrow = window.matchMedia("(max-width: 700px)");
    const fit = () => {
      panel.close();
      if (narrow.matches) {
        panel.removeAttribute("role");
        panel.showModal();
      } else {
        panel.setAttribute("role", "complementary");
        panel.open = true;
      }
    };
    fit();
    narrow.addEventListener("change", fit);
    return () => {
      narrow.removeEventListener("change", fit);
      panel.close();
    };
  }, []);
  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = closing;
  }, [closing]);
  return (
    <dialog
      ref={ref}
      className="v2-object-details"
      aria-label="对象详情"
      aria-hidden={closing || undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== ref.current || !ref.current?.matches(":modal"))
          return;
        const rect = ref.current.getBoundingClientRect();
        if (event.clientY < rect.top) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
