import React from "react";
import { Img, staticFile } from "remotion";

type IP = { size?: number; color?: string; stroke?: number; style?: React.CSSProperties };

const svg = (size: number, children: React.ReactNode, style?: React.CSSProperties, vb = "0 0 24 24") => (
  <svg width={size} height={size} viewBox={vb} style={{ display: "block", overflow: "visible", ...style }}>
    {children}
  </svg>
);

export const IconSearch: React.FC<IP> = ({ size = 32, color = "#4A5578", stroke = 2.4, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L21 21" /></g>, style);

export const IconChevron: React.FC<IP> = ({ size = 22, color = "#4A5578", stroke = 2.6, style }) =>
  svg(size, <path d="M6 9 L12 15 L18 9" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />, style);

export const IconCheck: React.FC<IP> = ({ size = 28, color = "#72E9C2", stroke = 3.2, style }) =>
  svg(size, <path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />, style);

export const IconX: React.FC<IP> = ({ size = 28, color = "#FF3B5C", stroke = 3.2, style }) =>
  svg(size, <path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />, style);

export const IconHeart: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <path d="M12 20 C5 15 3 11.5 3 8.6 C3 6 5 4 7.5 4 C9.4 4 11 5.2 12 6.8 C13 5.2 14.6 4 16.5 4 C19 4 21 6 21 8.6 C21 11.5 19 15 12 20Z" fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" />, style);

export const IconComment: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <path d="M4 5 H20 V16 H11 L6.5 20 V16 H4Z" fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" />, style);

export const IconShare: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <path d="M3 11 L21 3 L14 21 L11 13Z" fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" />, style);

export const IconBookmark: React.FC<IP & { fill?: string }> = ({ size = 34, color = "#1C2541", stroke = 2.2, fill = "none", style }) =>
  svg(size, <path d="M6 3 H18 V21 L12 16.5 L6 21Z" fill={fill} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />, style);

export const IconCart: React.FC<IP> = ({ size = 30, color = "#fff", stroke = 2.2, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"><path d="M3 4 H6 L8.5 15 H18.5 L21 7.5 H7" /><circle cx="10" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></g>, style);

export const IconCrop: React.FC<IP> = ({ size = 34, color = "#fff", stroke = 2.4, style }) =>
  svg(size, <path d="M6 2 V18 H22 M2 6 H18 V22" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />, style);

export const IconEraser: React.FC<IP> = ({ size = 34, color = "#fff", stroke = 2.4, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round"><path d="M15 4 L21 10 L11 20 H6 L3 17 Z" /><path d="M9 10 L15 16" /><path d="M11 20 H21" /></g>, style);

export const IconSparkle: React.FC<IP & { fill?: string }> = ({ size = 34, color = "#fff", fill, style }) =>
  svg(size, <g fill={fill ?? color}><path d="M12 2 C12.8 7.5 15.5 10.4 21 12 C15.5 13.6 12.8 16.5 12 22 C11.2 16.5 8.5 13.6 3 12 C8.5 10.4 11.2 7.5 12 2Z" /><path d="M19.5 2.5 C19.8 4.2 20.6 5 22.2 5.3 C20.6 5.6 19.8 6.4 19.5 8.1 C19.2 6.4 18.4 5.6 16.8 5.3 C18.4 5 19.2 4.2 19.5 2.5Z" /></g>, style);

export const IconUser: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21 C4.5 16.5 8 14.5 12 14.5 C16 14.5 19.5 16.5 20 21" /></g>, style);

export const IconDoc: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round"><path d="M6 2.5 H14.5 L19 7 V21.5 H6Z" /><path d="M14 2.5 V7.5 H19" /><path d="M9 12 H16 M9 15.5 H16 M9 19 H13" /></g>, style);

export const IconCamera: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round"><path d="M3 7.5 H7.5 L9 5 H15 L16.5 7.5 H21 V19 H3Z" /><circle cx="12" cy="13" r="3.6" /></g>, style);

export const IconBrush: React.FC<IP> = ({ size = 34, color = "#1C2541", stroke = 2.2, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round"><path d="M20 3 L10 13" /><path d="M10 13 C7 12 4.5 14 4.5 17 C4.5 19 3.5 20 2.5 20.5 C6 21.5 11 21 11 16 Z" /></g>, style);

export const IconLock: React.FC<IP> = ({ size = 22, color = "#6B7590", stroke = 2.2, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11 V8 C8 5.5 9.8 4 12 4 C14.2 4 16 5.5 16 8 V11" /></g>, style);

export const IconLink: React.FC<IP> = ({ size = 26, color = "#4285F4", stroke = 2.4, style }) =>
  svg(size, <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"><path d="M10 14 L14 10" /><path d="M8.5 11.5 L6.5 13.5 C5 15 5 17.5 6.5 19 C8 20.5 10.5 20.5 12 19 L14 17" /><path d="M15.5 12.5 L17.5 10.5 C19 9 19 6.5 17.5 5 C16 3.5 13.5 3.5 12 5 L10 7" /></g>, style);

/** Neutral pointer (not tied to any OS brand). */
export const Pointer: React.FC<{ size?: number; pressed?: number }> = ({ size = 64, pressed = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.45))" }}>
    <g transform={`scale(${1 - pressed * 0.12}) translate(${pressed * 2} ${pressed * 2})`}>
      <path d="M5 3 L5 25 L10.5 19.8 L14.2 28 L18 26.3 L14.4 18.3 L22 18.3 Z" fill="#FFFFFF" stroke="#0B1226" strokeWidth="1.8" strokeLinejoin="round" />
    </g>
  </svg>
);

// Package objects (assets/objects/*.svg) used as-is.
export const WarningObject: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile("objects/copyright_warning.svg")} style={{ width: size, height: size, display: "block", ...style }} />
);
export const LicenseCheckObject: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile("objects/license_check.svg")} style={{ width: size, height: size, display: "block", ...style }} />
);
export const ArrowObject: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile("objects/arrow_swipe.svg")} style={{ width: size, height: size, display: "block", ...style }} />
);

/** "≠" drawn as vector (the brand fonts do not ship U+2260). progress 0..1 draws the strokes. */
export const NotEqual: React.FC<{ size: number; color: string; progress?: number }> = ({ size, color, progress = 1 }) => {
  const p1 = Math.min(1, progress * 2);
  const p2 = Math.max(0, Math.min(1, progress * 2 - 0.6));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible" }}>
      <g stroke={color} strokeWidth="11" strokeLinecap="round" fill="none">
        <path d="M18 38 H82" strokeDasharray="64" strokeDashoffset={64 * (1 - p1)} />
        <path d="M18 64 H82" strokeDasharray="64" strokeDashoffset={64 * (1 - p1)} />
        <path d="M66 14 L34 88" strokeDasharray="81" strokeDashoffset={81 * (1 - p2)} />
      </g>
    </svg>
  );
};
