/**
 * player.js — level/XP math.
 *
 * Mirrors the spec's GameEngine.java formula exactly:
 *   public int calculateLevel(int xp) { return xp / 1000 + 1; }
 * i.e. every 1000 XP is one level, starting at level 1.
 */

const XP_PER_LEVEL = 1000;

export function calculateLevel(totalXp) {
  return Math.floor(totalXp / XP_PER_LEVEL) + 1;
}

/** XP already earned within the current level (0..999). */
export function xpIntoCurrentLevel(totalXp) {
  return totalXp % XP_PER_LEVEL;
}

/** XP required to reach the next level from the start of the current one. */
export function xpRequiredForLevel() {
  return XP_PER_LEVEL;
}

export function xpProgressPercent(totalXp) {
  return (xpIntoCurrentLevel(totalXp) / xpRequiredForLevel()) * 100;
}

/**
 * Applies an XP/coin reward to a player record and returns the updated
 * fields plus whether a level-up occurred, without persisting — caller
 * decides when/how to save (keeps this pure and testable).
 */
export function applyReward(player, { xp = 0, coins = 0 }) {
  const previousLevel = calculateLevel(player.xp);
  const newXp = player.xp + xp;
  const newLevel = calculateLevel(newXp);
  return {
    xp: newXp,
    coins: player.coins + coins,
    level: newLevel,
    leveledUp: newLevel > previousLevel,
    levelsGained: newLevel - previousLevel,
  };
}

export const CLASSES = {
  warrior: { label: 'Warrior', icon: '⚔️', primaryStat: 'strength' },
  mage: { label: 'Mage', icon: '🔮', primaryStat: 'intelligence' },
  ninja: { label: 'Ninja', icon: '🥷', primaryStat: 'discipline' },
  explorer: { label: 'Explorer', icon: '🧭', primaryStat: 'creativity' },
};
