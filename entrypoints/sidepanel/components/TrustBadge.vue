<script setup lang="ts">
import { computed } from 'vue';
import type { TrustScore } from '@/lib/types';

const props = defineProps<{
  trustScore: TrustScore;
}>();

const level = computed<'suspicious' | 'watch' | 'voz_restricted' | 'otofun_restricted' | null>(() => {
  if (props.trustScore.flags.includes('no_meta')) return null;
  if (props.trustScore.flags.includes('voz_rank_restricted')) return 'voz_restricted';
  if (props.trustScore.flags.includes('otofun_rank_restricted')) return 'otofun_restricted';
  if (props.trustScore.score < 40) return 'suspicious';
  if (props.trustScore.score < 60) return 'watch';
  return null;
});

// Token-based variants (reuse design-system badge utilities) instead of
// hardcoded Tailwind palette classes — keeps light/dark theming in main.css.
const badgeClass = computed(() => {
  if (level.value === 'suspicious' || level.value === 'voz_restricted' || level.value === 'otofun_restricted') {
    return 'badge-warning';
  }
  return 'badge-neutral';
});

const badgeLabel = computed(() => {
  if (level.value === 'voz_restricted' || level.value === 'otofun_restricted') return '⚠ Acc hạn chế';
  if (level.value === 'suspicious') return '⚠ Newbie';
  return '? Ít hoạt động';
});

const tooltipText = computed(() => {
  const parts: string[] = [];
  const meta = props.trustScore.meta;

  if (props.trustScore.flags.includes('voz_rank_restricted')) {
    const title = meta?.userTitle;
    return title
      ? `${title} — tài khoản bị hạn chế đăng bài trên VOZ`
      : 'Tài khoản bị hạn chế đăng bài trên VOZ';
  }

  if (props.trustScore.flags.includes('otofun_rank_restricted')) {
    const title = meta?.userTitle;
    return title
      ? `${title} — thành viên mới trên OtoFun (Xe đạp / Xe máy)`
      : 'Thành viên mới trên OtoFun';
  }

  if (props.trustScore.flags.includes('new_account') && meta?.joinDate) {
    parts.push(`Acc mới (${meta.joinDate})`);
  } else if (props.trustScore.flags.includes('new_account')) {
    parts.push('Acc mới');
  }

  if (meta?.messageCount !== undefined) {
    parts.push(`${meta.messageCount} bài toàn forum`);
  }

  if (props.trustScore.flags.includes('low_reaction_ratio')) {
    parts.push('Reaction thấp');
  }

  if (props.trustScore.flags.includes('high_thread_activity')) {
    parts.push(`${props.trustScore.postCountInThread} bài trong thread`);
  }

  if (props.trustScore.flags.includes('no_meta')) {
    return 'Không có thông tin tài khoản';
  }

  return parts.length > 0 ? parts.join(' · ') : `Điểm: ${props.trustScore.score}`;
});
</script>

<template>
  <span
    v-if="level !== null"
    :class="['badge cursor-help', badgeClass]"
    :title="tooltipText"
  >{{ badgeLabel }}</span>
</template>
