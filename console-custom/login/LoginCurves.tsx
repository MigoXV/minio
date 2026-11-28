// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";

export default function LoginCurves() {
  return (
    <svg
      className="av-login-curves"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
      fill="none"
    >
      {/* Figma 182:629 paths in artboard coordinates. The ends extend past the viewport. */}
      <path
        className="av-login-curve av-login-curve--upper"
        d="M848 928 C1008 827 1099 847 1181 756 C1275 653 1317 458 1465 360"
      />
      <path
        className="av-login-curve av-login-curve--main"
        strokeWidth="1.1"
        d="M922 930 C1055 843 1136 852 1223 758 C1312 661 1356 514 1465 439"
      />
      <path
        className="av-login-curve av-login-curve--lower"
        d="M1005 930 C1124 861 1184 863 1267 775 C1345 693 1374 570 1465 525"
      />
    </svg>
  );
}
