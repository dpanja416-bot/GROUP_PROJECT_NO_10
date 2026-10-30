import React from "react";
import "./ECGBackground.css";

export default function ECGBackground() {
  return (
    <div className="ecg-background" aria-hidden="true">
      <div className="ecg-grid" />

      <svg
        className="ecg-svg"
        viewBox="0 0 1440 700"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="ecgLight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#39DFFF" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#55E8FF" stopOpacity="1" />
            <stop offset="100%" stopColor="#39AAFF" stopOpacity="0.85" />
          </linearGradient>

          <filter
            id="ecgGlow"
            x="-30%"
            y="-100%"
            width="160%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Main ECG trace: duplicated for seamless movement */}
        <g className="ecg-moving-main">
          {[0, 1440].map((offset) => (
            <g key={offset} transform={`translate(${offset}, 0)`}>
              <path
                className="ecg-main-glow"
                fill="none"
                stroke="#00CFFF"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#ecgGlow)"
                d="
                  M0 350
                  H190
                  L215 350
                  L238 331
                  L258 368
                  L281 350
                  H470
                  L493 350
                  L515 316
                  L539 398
                  L569 255
                  L598 425
                  L628 350
                  H850
                  L873 350
                  L895 332
                  L918 368
                  L941 350
                  H1125
                  L1148 350
                  L1170 316
                  L1194 398
                  L1224 255
                  L1253 425
                  L1284 350
                  H1440
                "
              />

              <path
                className="ecg-main-line"
                fill="none"
                stroke="url(#ecgLight)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#ecgGlow)"
                d="
                  M0 350
                  H190
                  L215 350
                  L238 331
                  L258 368
                  L281 350
                  H470
                  L493 350
                  L515 316
                  L539 398
                  L569 255
                  L598 425
                  L628 350
                  H850
                  L873 350
                  L895 332
                  L918 368
                  L941 350
                  H1125
                  L1148 350
                  L1170 316
                  L1194 398
                  L1224 255
                  L1253 425
                  L1284 350
                  H1440
                "
              />
            </g>
          ))}
        </g>

        {/* Secondary ECG trace */}
        <g className="ecg-moving-secondary">
          {[0, 1440].map((offset) => (
            <g key={offset} transform={`translate(${offset}, 0)`}>
              <path
                className="ecg-secondary-line"
                fill="none"
                stroke="#39DFFF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#ecgGlow)"
                d="
                  M0 510
                  H360
                  L380 510
                  L398 497
                  L416 522
                  L435 510
                  H1020
                  L1040 510
                  L1058 497
                  L1076 522
                  L1095 510
                  H1440
                "
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}