import { ref } from 'vue';
import type { UserForum } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import { requestOriginsPermission } from '@/lib/permissions';

// Module-level state (singleton, shared across all components)
const userForums = ref<UserForum[]>([]);

export function useForumManager() {

  async function loadForums() {
    userForums.value = (await sendMessage<UserForum[]>('GET_USER_FORUMS')) || [];
  }

  async function addForumByHostname(hostname: string): Promise<boolean> {
    const origins = [`https://${hostname}/*`, `http://${hostname}/*`];
    const matchPattern = `*://${hostname}/*`;

    const granted = await requestOriginsPermission(origins);

    if (!granted) return false;

    const forum: UserForum = {
      id: crypto.randomUUID(),
      hostname,
      matchPattern,
      origins,
      addedAt: Date.now(),
    };

    await sendMessage('ADD_USER_FORUM', forum);
    userForums.value.push(forum);
    return true;
  }

  async function addForumFromUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    let hostname: string;
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      hostname = parsed.hostname;
    } catch {
      return { ok: false, error: 'URL không hợp lệ.' };
    }

    if (userForums.value.find(f => f.hostname === hostname)) {
      return { ok: false, error: 'Forum này đã được thêm.' };
    }

    try {
      const ok = await addForumByHostname(hostname);
      if (!ok) return { ok: false, error: 'Chưa cấp quyền truy cập forum.' };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Lỗi: ${String(err)}` };
    }
  }

  async function removeForum(forum: UserForum) {
    await sendMessage('REMOVE_USER_FORUM', { id: forum.id, origins: forum.origins });
    userForums.value = userForums.value.filter(f => f.id !== forum.id);
  }

  return { userForums, loadForums, addForumByHostname, addForumFromUrl, removeForum };
}
