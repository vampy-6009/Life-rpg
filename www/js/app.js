/**
 * app.js — screen router + startup sequence.
 *
 * Follows the mandatory startup flow from the spec:
 *   Android launches app
 *     -> check first installation / init storage
 *     -> check permissions -> request missing (via custom screen first)
 *     -> verify database integrity
 *     -> load player profile
 *     -> open dashboard (or character creation if no profile)
 */

import * as DB from './database.js';
import * as Permissions from './permissions.js';
import { ensureTodaysQuests, completeQuestAndReward } from './quests.js';
import { xpProgressPercent, xpIntoCurrentLevel, xpRequiredForLevel, CLASSES } from './player.js';

const screens = {
  splash: document.getElementById('screen-splash'),
  permissionPrompt: document.getElementById('screen-permission-prompt'),
  characterCreation: document.getElementById('screen-character-creation'),
  home: document.getElementById('screen-home'),
  repairNotice: document.getElementById('repair-toast'),
};

let selectedClass = null;
let currentPlayer = null;

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    if (!el || key === 'repairNotice') return;
    el.classList.toggle('screen--active', key === name);
  });
}

function showRepairToast() {
  if (!screens.repairNotice) return;
  screens.repairNotice.classList.add('toast--visible');
  setTimeout(() => screens.repairNotice.classList.remove('toast--visible'), 3500);
}

/* ---------------- Character Creation ---------------- */

function initCharacterCreationScreen() {
  const classCards = document.querySelectorAll('.class-card');
  const nameInput = document.getElementById('hero-name-input');
  const continueBtn = document.getElementById('character-continue-btn');
  const errorEl = document.getElementById('character-creation-error');

  classCards.forEach((card) => {
    card.addEventListener('click', () => {
      classCards.forEach((c) => c.classList.remove('class-card--selected'));
      card.classList.add('class-card--selected');
      selectedClass = card.dataset.classId;
      errorEl.textContent = '';
    });
  });

  continueBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Enter a hero name to continue.';
      return;
    }
    if (!selectedClass) {
      errorEl.textContent = 'Choose a class to continue.';
      return;
    }

    continueBtn.disabled = true;
    try {
      currentPlayer = await DB.createPlayer({ username: name, playerClass: selectedClass });
      await ensureTodaysQuests();
      await renderHome();
      showScreen('home');
    } catch (err) {
      console.error('Failed to create player:', err);
      errorEl.textContent = 'Could not save your hero. Please try again.';
      continueBtn.disabled = false;
    }
  });
}

/* ---------------- Home Dashboard ---------------- */

async function renderHome() {
  currentPlayer = await DB.getPlayer();
  if (!currentPlayer) return;

  const classInfo = CLASSES[currentPlayer.class] ?? { label: currentPlayer.class, icon: '⭐' };

  document.getElementById('player-name').textContent = currentPlayer.username;
  document.getElementById('player-level-line').textContent = `Level ${currentPlayer.level} ${classInfo.label}`;
  document.getElementById('player-avatar-icon').textContent = classInfo.icon;
  document.getElementById('player-coins').textContent = currentPlayer.coins;

  const pct = xpProgressPercent(currentPlayer.xp);
  document.getElementById('xp-fill').style.width = `${pct}%`;
  document.getElementById('xp-label').textContent =
    `${xpIntoCurrentLevel(currentPlayer.xp)} / ${xpRequiredForLevel()} XP`;

  await renderQuests();
}

async function renderQuests() {
  const quests = await ensureTodaysQuests();
  const container = document.getElementById('quest-list');
  container.innerHTML = '';

  quests.forEach((quest) => {
    const card = document.createElement('div');
    card.className = 'quest-card' + (quest.completed ? ' quest-card--done' : '');

    card.innerHTML = `
      <div class="quest-card__title">${escapeHtml(quest.title)}</div>
      <div class="quest-card__reward">+${quest.reward_xp} XP · +${quest.reward_coin} coins</div>
      <button class="quest-card__btn" ${quest.completed ? 'disabled' : ''}>
        ${quest.completed ? 'Completed' : 'Complete'}
      </button>
    `;

    const btn = card.querySelector('.quest-card__btn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const result = await completeQuestAndReward(quest);
        if (!result.alreadyCompleted) {
          await renderHome();
          if (result.leveledUp) {
            showLevelUpToast(result.newLevel);
          }
        }
      } catch (err) {
        console.error('Failed to complete quest:', err);
        btn.disabled = false;
      }
    });

    container.appendChild(card);
  });
}

function showLevelUpToast(newLevel) {
  const toast = document.getElementById('levelup-toast');
  if (!toast) return;
  toast.querySelector('.toast__text').textContent = `Level Up! You reached Level ${newLevel}`;
  toast.classList.add('toast--visible');
  setTimeout(() => toast.classList.remove('toast--visible'), 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Permission prompt screen ---------------- */

function initPermissionPromptScreen(onDone) {
  const continueBtn = document.getElementById('permission-continue-btn');
  continueBtn.addEventListener('click', async () => {
    continueBtn.disabled = true;
    await Permissions.requestNotificationPermission(); // denial is fine, never blocks
    await Permissions.markPermissionPromptShown();
    onDone();
  });
}

/* ---------------- Startup sequence ---------------- */

async function startup() {
  showScreen('splash');
  initCharacterCreationScreen();

  const splashMinDuration = new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { repaired, hasPlayer } = await DB.initDatabase();

    await splashMinDuration; // keep splash on screen for its full 2s regardless of init speed

    const proceedToNextScreen = async () => {
      if (repaired) showRepairToast();

      if (hasPlayer) {
        await ensureTodaysQuests();
        await renderHome();
        showScreen('home');
      } else {
        showScreen('characterCreation');
      }
    };

    const alreadyPrompted = await Permissions.hasShownPermissionPrompt();
    if (alreadyPrompted) {
      await proceedToNextScreen();
    } else {
      initPermissionPromptScreen(proceedToNextScreen);
      showScreen('permissionPrompt');
    }
  } catch (err) {
    // Startup must never leave the user on a blank/frozen splash screen.
    console.error('Startup sequence failed:', err);
    await splashMinDuration;
    showScreen('characterCreation');
  }
}

document.addEventListener('DOMContentLoaded', startup);
