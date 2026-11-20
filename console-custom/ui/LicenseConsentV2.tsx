// SPDX-License-Identifier: AGPL-3.0-or-later
import React, { useState } from "react";
import { useSelector } from "react-redux";
import { AppState, useAppDispatch } from "../store";
import { setAcknowledgeLicense } from "../systemSlice";
import { setLicenseConsent } from "../screens/Console/License/utils";
import LicenseFAQ from "../screens/Console/License/LicenseFAQ";
import { Modal } from "./V2";
export default function LicenseConsentV2() {
  const dispatch = useAppDispatch(),
    ack = useSelector((s: AppState) => s.system.licenseAcknowledged),
    [faq, setFaq] = useState(false);
  if (ack) return null;
  return (
    <Modal
      title="许可确认"
      onClose={() => {
        window.location.assign("/logout");
      }}
      footer={
        <>
          <button
            className="av-button"
            onClick={() => window.location.assign("/logout")}
          >
            取消
          </button>
          <button
            className="av-button av-primary"
            id="acknowledge-confirm"
            onClick={() => {
              setLicenseConsent();
              dispatch(setAcknowledgeLicense(true));
            }}
          >
            确认并继续
          </button>
        </>
      }
    >
      <p>MinIO is licensed under the GNU Affero General Public License v3.</p>
      <p className="v2-description">
        Please review the license statement before continuing. Community and
        Enterprise editions have different terms and intended uses.
      </p>
      <button
        className="av-button av-ghost"
        onClick={() => setFaq(!faq)}
        aria-expanded={faq}
      >
        Frequently Asked Questions
      </button>
      {faq && (
        <div className="v2-license-faq">
          <p>
            By using this software, you acknowledge that MinIO software is
            licensed under the{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noreferrer"
            >
              GNU AGPL v3
            </a>
            , for which, the full text can be found here:
            https://www.gnu.org/licenses/agpl-3.0.html.
          </p>
          <p>
            Please review the terms carefully and ensure you are in compliance
            with the obligations of the license. If you are not able to satisfy
            the license obligations, we offer a commercial license which is
            available here:{" "}
            <a
              href="https://min.io/signup?ref=con"
              target="_blank"
              rel="noreferrer"
            >
              https://min.io/signup.
            </a>
          </p>
          <LicenseFAQ />
        </div>
      )}
    </Modal>
  );
}
