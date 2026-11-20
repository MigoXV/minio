// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";
import file from "./assets/file.svg";
import audio from "./assets/audio.svg";
import system from "./assets/system.svg";
import down from "./assets/down.svg";
import close from "./assets/close.svg";
import play from "./assets/play.svg";
import volume from "./assets/volume.svg";
import download from "./assets/download.svg";
import preview from "./assets/preview.svg";
import search from "./assets/search.svg";
import chevron from "./assets/chevron.svg";
import lock from "./assets/lock.svg";
import sun from "./assets/sun.svg";
import moon from "./assets/moon.svg";
import check from "./assets/check.svg";
import moonMask from "./assets/moon-mask.svg";
import downloadMask from "./assets/download-mask.svg";
import downloadMaskInner from "./assets/download-mask-inner.svg";
import closeMask from "./assets/close-mask.svg";
const icons = {
  file,
  audio,
  system,
  down,
  close,
  play,
  volume,
  download,
  preview,
  search,
  chevron,
  lock,
  sun,
  moon,
  check,
};
export default function Icon({ name }: { name: keyof typeof icons }) {
  const img = (
    <img className="av-icon" alt="" aria-hidden="true" src={icons[name]} />
  );
  const masks =
    name === "download"
      ? [downloadMask, downloadMaskInner]
      : name === "moon"
        ? [moonMask]
        : name === "close"
          ? [moonMask, closeMask, closeMask]
          : [];
  return masks.length ? (
    <span
      className="av-icon-mask"
      style={{ maskImage: masks.map((url) => `url("${url}")`).join(",") }}
    >
      {img}
    </span>
  ) : (
    img
  );
}
