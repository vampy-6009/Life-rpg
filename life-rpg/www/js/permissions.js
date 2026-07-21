/**
 * permissions.js — notification permission flow.
 *
 * Per the mandatory system requirements: request only what's needed
 * (notifications, for quest/level reminders), show a custom explanation
 * screen BEFORE the native Android prompt, and never let a denial break
 * the app — the game must keep working with reminders simply off.
 *
 * Camera permission is NOT requested here at all, since no feature in
 * this build (Splash/Character Creation/Home/Quests) uses it. Per the
 * spec's own "optional permissions: only request when feature is used"
 * rule, wiring up CAMERA now — with no avatar-capture feature built yet —
 * would be requesting a permission the app can't yet justify.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';

const PROMPT_SHOWN_KEY = 'liferpg_permission_prompt_shown';

export async function hasShownPermissionPrompt() {
  const { value } = await Preferences.get({ key: PROMPT_SHOWN_KEY });
  return value === 'true';
}

export async function markPermissionPromptShown() {
  await Preferences.set({ key: PROMPT_SHOWN_KEY, value: 'true' });
}

/**
 * Checks current permission state without prompting.
 * Returns 'granted' | 'denied' | 'prompt', matching Capacitor's own
 * PermissionState string values exactly (lowercase, not booleans).
 */
export async function checkNotificationPermission() {
  try {
    const status = await LocalNotifications.checkPermissions();
    return status.display;
  } catch (err) {
    console.warn('Failed to check notification permission:', err);
    return 'denied';
  }
}

/**
 * Triggers the real Android permission dialog. Should only be called
 * after the custom explanation screen's "Continue" button, per spec.
 * Never throws — a denial is a normal, supported outcome, not an error.
 */
export async function requestNotificationPermission() {
  try {
    const status = await LocalNotifications.requestPermissions();
    return status.display === 'granted';
  } catch (err) {
    console.warn('Notification permission request failed:', err);
    return false;
  }
}
