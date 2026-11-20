// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";
import SystemManagementHeader from "./SystemManagementHeader";
// Comparison copy follows Figma 176:642; the full original license statement
// and FAQ remain available in LicenseConsentV2.
const comparison: Array<[string, React.ReactNode, React.ReactNode]> = [
  ["产品", "MinIO Object Store", "MinIO AIStor"],
  ["License", "GNU AGPL v3 License", "Enterprise License"],
  [
    "Intended Use",
    "Test and Dev Use",
    <>
      Production Use
      <br />
      (Site-Replication, Enterprise Security)
    </>,
  ],
  [
    "Features",
    "Basic Features",
    <>
      Basic Features, S3 Express, QoS, Catalog,
      <br />
      Monitoring, Audit Logs, AI Features
    </>,
  ],
  ["Support", "Community Support", "SLA backed – 24/7/365"],
  ["Regulatory Compliance", "N/A", "FIPS 140-a, SOC2, ISO 27001"],
];
export default function LicenseV2() {
  return (
    <main className="v2-page">
      <SystemManagementHeader
        active="license"
        description="Community and Enterprise Editions"
      />
      <div className="v2-table-wrap">
        <table className="v2-table v2-license-table">
          <colgroup>
            <col style={{ width: "35.5%" }} />
            <col style={{ width: "23.3%" }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>项目</th>
              <th>Community</th>
              <th>Enterprise</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map(([label, community, enterprise]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{community}</td>
                <td>{enterprise}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
