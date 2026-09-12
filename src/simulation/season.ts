// What time of year does to a dam break.
//
// The season does not change the physics; it changes the state the valley is in when the dam
// fails, and that state is already described by three inputs the model takes. In the monsoon a
// reservoir sits near its full supply level, the river below is already carrying a high flow, and
// the ground is wet and thick with vegetation. Before the monsoon the reservoir is drawn down,
// the river is a trickle, and the floodplain is bare and smoother. The same breach in June and in
// April is not the same flood, and this is the honest way to show that with parameters that are
// each defensible on their own.
//
// Reservoir levels follow ordinary Indian operating practice - full supply through the monsoon,
// drawn down towards the end of the dry season - and roughness follows the seasonal range in the
// standard open-channel tables (Chow, 1959): the same channel is rougher when its banks are in
// leaf.

export type Season = 'monsoon' | 'post-monsoon' | 'pre-monsoon';

export interface SeasonProfile {
  id: Season;
  label: string;
  /** Reservoir depth relative to the scenario's own level (the post-monsoon value). */
  levelShare: number;
  /** River flow already in the reach, as a share of the scenario's own base flow. */
  baseFlowShare: number;
  /** Manning's n as a share of the scenario's own value. */
  roughnessShare: number;
  description: string;
}

export const SEASONS: SeasonProfile[] = [
  {
    id: 'monsoon',
    label: 'Monsoon',
    levelShare: 0.97,
    baseFlowShare: 3,
    roughnessShare: 1.15,
    description: 'Reservoir at full supply level, the river below already high, banks in leaf. The worst case, and the season in which dams actually fail.',
  },
  {
    id: 'post-monsoon',
    label: 'Post-monsoon',
    levelShare: 0.9,
    baseFlowShare: 1,
    roughnessShare: 1,
    description: 'Storage still near full after the rains, the river back to an ordinary flow. The scenario defaults.',
  },
  {
    id: 'pre-monsoon',
    label: 'Pre-monsoon',
    levelShare: 0.55,
    baseFlowShare: 0.25,
    roughnessShare: 0.85,
    description: 'Drawn down before the rains, the river a trickle, the floodplain bare. Less water to release, and it runs faster over smoother ground.',
  },
];

export const DEFAULT_SEASON: Season = 'post-monsoon';

export function seasonProfile(id: Season): SeasonProfile {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[1];
}

/**
 * The reservoir level, river flow and roughness for a season, from the scenario's own values as
 * the post-monsoon baseline. Volume follows the level through the stage-storage law the solver
 * already uses, so a drawn-down reservoir holds less water as well as less head.
 */
export function applySeason(
  season: Season,
  base: { damHeight: number; waterDepth: number; volume: number; baseFlow: number; manning: number; storageExponent: number },
): { waterDepth: number; volume: number; baseFlow: number; manning: number } {
  const p = seasonProfile(season);
  const reference = seasonProfile(DEFAULT_SEASON);
  // Everything is relative to the scenario's own figures, so the default season reproduces them
  // exactly rather than quietly moving the reservoir the moment the control is touched.
  const waterDepth = Math.min(base.damHeight, base.waterDepth * (p.levelShare / reference.levelShare));
  // V(h) = V0 (h / h0)^m, the same power law the reservoir routing uses.
  const volume = base.volume * Math.pow(waterDepth / Math.max(base.waterDepth, 1e-6), base.storageExponent);
  return {
    waterDepth,
    volume,
    baseFlow: base.baseFlow * (p.baseFlowShare / reference.baseFlowShare),
    manning: base.manning * (p.roughnessShare / reference.roughnessShare),
  };
}
