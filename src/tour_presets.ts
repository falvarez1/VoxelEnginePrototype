import type { Tour } from './camera_tour.ts';

export const BASELINE_FLYOVER_TOUR: Tour = {
  name: 'baseline-canyon-flyover',
  easing: 'smooth',
  waypoints: [
    {
      position: [96, 390, -1320],
      yaw: 0.018,
      pitch: -0.335,
      timeMs: 0,
    },
    {
      position: [80, 220, -820],
      yaw: 0.10,
      pitch: -0.45,
      timeMs: 2500,
    },
    {
      position: [20, 95, -360],
      yaw: 0.25,
      pitch: -0.18,
      timeMs: 5000,
    },
    {
      position: [-110, 70, 40],
      yaw: 0.95,
      pitch: -0.05,
      timeMs: 7500,
    },
    {
      position: [-280, 160, 220],
      yaw: 1.95,
      pitch: 0.05,
      timeMs: 10000,
    },
    {
      position: [-220, 320, 60],
      yaw: 2.95,
      pitch: -0.18,
      timeMs: 12500,
    },
    {
      position: [60, 380, -880],
      yaw: 0.018,
      pitch: -0.30,
      timeMs: 15000,
    },
  ],
};

export const BUILTIN_TOURS: Record<string, Tour> = {
  [BASELINE_FLYOVER_TOUR.name]: BASELINE_FLYOVER_TOUR,
  baseline: BASELINE_FLYOVER_TOUR,
};
