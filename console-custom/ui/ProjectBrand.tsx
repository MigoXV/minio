// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";
import { useAppearance } from "./Appearance";
import vallumMark from "./assets/brand/nav-vallum.svg";
import abyssusMark from "./assets/brand/nav-abyssus.svg";
import "./projectBrand.css";

export default function ProjectBrand({ className }: { className?: string }) {
  const { effective } = useAppearance();
  return (
    <div
      className={
        className ? "v2-project-brand " + className : "v2-project-brand"
      }
    >
      <img
        src={effective === "abyssus" ? abyssusMark : vallumMark}
        width={24}
        height={24}
        alt=""
      />
      <span>MinIO</span>
    </div>
  );
}
