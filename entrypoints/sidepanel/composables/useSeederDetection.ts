import { ref, readonly } from 'vue';
import { STORAGE_KEYS } from '@/lib/constants';

const showTrustBadges = ref(true);

export function useSeederDetection() {
  async function loadSetting() {
    const result = await browser.storage.sync.get(STORAGE_KEYS.SHOW_TRUST_BADGES);
    const stored = result[STORAGE_KEYS.SHOW_TRUST_BADGES];
    // Default ON — only false when explicitly set to false
    showTrustBadges.value = stored !== false;
  }

  async function setShowTrustBadges(value: boolean) {
    showTrustBadges.value = value;
    await browser.storage.sync.set({ [STORAGE_KEYS.SHOW_TRUST_BADGES]: value });
  }

  return { showTrustBadges: readonly(showTrustBadges), loadSetting, setShowTrustBadges };
}
