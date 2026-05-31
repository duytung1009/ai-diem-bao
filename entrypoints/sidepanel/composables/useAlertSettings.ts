import { ref, readonly } from 'vue';
import { STORAGE_KEYS } from '@/lib/constants';

const hideInfoAlerts = ref(false);
const hideWarningAlerts = ref(false);

export function useAlertSettings() {
  async function loadSettings() {
    const result = await browser.storage.sync.get([STORAGE_KEYS.HIDE_INFO_ALERTS, STORAGE_KEYS.HIDE_WARNING_ALERTS]);
    hideInfoAlerts.value = result[STORAGE_KEYS.HIDE_INFO_ALERTS] === true;
    hideWarningAlerts.value = result[STORAGE_KEYS.HIDE_WARNING_ALERTS] === true;
  }

  async function setHideInfoAlerts(value: boolean) {
    hideInfoAlerts.value = value;
    await browser.storage.sync.set({ [STORAGE_KEYS.HIDE_INFO_ALERTS]: value });
  }

  async function setHideWarningAlerts(value: boolean) {
    hideWarningAlerts.value = value;
    await browser.storage.sync.set({ [STORAGE_KEYS.HIDE_WARNING_ALERTS]: value });
  }

  return {
    hideInfoAlerts: readonly(hideInfoAlerts),
    hideWarningAlerts: readonly(hideWarningAlerts),
    loadSettings,
    setHideInfoAlerts,
    setHideWarningAlerts,
  };
}
