/**
 * quests.js — daily quest seeding and completion logic.
 */

import * as DB from './database.js';
import { applyReward } from './player.js';

const DEFAULT_DAILY_QUESTS = [
  { title: 'Read 20 pages', description: 'Knowledge Quest', rewardXp: 100, rewardCoin: 10 },
  { title: 'Exercise 20 minutes', description: 'Vitality Quest', rewardXp: 80, rewardCoin: 10 },
  { title: 'Study 30 minutes', description: 'Knowledge Quest', rewardXp: 50, rewardCoin: 10 },
];

/** Ensures today has at least one quest; seeds defaults on first check each day. */
export async function ensureTodaysQuests() {
  const existing = await DB.getTodaysQuests();
  if (existing.length > 0) return existing;

  for (const q of DEFAULT_DAILY_QUESTS) {
    await DB.addQuest(q);
  }
  return DB.getTodaysQuests();
}

/**
 * Completes a quest: marks it done, applies XP/coin reward to the player,
 * persists both, and returns enough info for the UI to animate/react.
 */
export async function completeQuestAndReward(quest) {
  if (quest.completed) {
    return { alreadyCompleted: true };
  }

  const player = await DB.getPlayer();
  const result = applyReward(player, { xp: quest.reward_xp, coins: quest.reward_coin });

  await DB.completeQuest(quest.quest_id);
  await DB.updatePlayer({ xp: result.xp, coins: result.coins, level: result.level });

  return {
    alreadyCompleted: false,
    leveledUp: result.leveledUp,
    levelsGained: result.levelsGained,
    newLevel: result.level,
    newXp: result.xp,
    newCoins: result.coins,
  };
}
