/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

/** Roost's mark: a roof with a perch beneath it. */
export function Logo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="27"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      {...props}
    >
      <path
        d="M3.25 12.75 14 3.75l10.75 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.75 11.75V23.5h14.5V11.75"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="17.25" r="2.6" fill="currentColor" />
    </svg>
  )
}

export function LogoText() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="28" viewBox="0 0 100 28" fill="currentColor">
      <text
        x="0"
        y="22"
        fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="24"
        fontWeight="700"
        letterSpacing="-0.6"
        fill="currentColor"
      >
        Roost
      </text>
    </svg>
  )
}
