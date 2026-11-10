/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { motion, MotionProps } from 'motion/react'
import { ComponentProps } from 'react'

type AnimatedLogoProps = ComponentProps<typeof motion.svg> & {
  animated?: boolean
}

const reveal = (delay: number, animated: boolean): MotionProps =>
  animated
    ? {
        initial: { filter: 'blur(2px)', x: -4, opacity: 0 },
        animate: { filter: 'blur(0px)', x: 0, opacity: 1 },
        transition: { duration: 0.2, ease: 'easeInOut', delay },
      }
    : {}

export function AnimatedLogo({ animated = true, ...props }: AnimatedLogoProps) {
  return (
    <motion.svg
      width="140"
      height="40"
      viewBox="0 0 140 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <motion.g {...reveal(0, animated)}>
        <path
          d="M4 17 18 5l14 12"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 16v17h20V16"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="23" r="3" fill="currentColor" />
      </motion.g>
      <motion.text
        {...reveal(0.08, animated)}
        x="42"
        y="29"
        fill="currentColor"
        fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="26"
        fontWeight="700"
        letterSpacing="-0.6"
      >
        Roost
      </motion.text>
    </motion.svg>
  )
}
