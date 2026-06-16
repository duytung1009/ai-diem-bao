<script setup lang="ts">
import { computed } from 'vue';
import type { ThreadAnalysisJSON, TrustScore } from '@/lib/types';
import TrustBadge from './TrustBadge.vue';

const props = defineProps<{
  analysis: ThreadAnalysisJSON;
  threadTitle: string;
  totalPages: number;
  userTrustScores?: Record<string, TrustScore>;
  showTrustBadges?: boolean;
}>();

// Compute proportion of low-trust users (score < 40) for the warning indicator
// Exclude no_meta users — score=0 due to missing data shouldn't count as suspicious
const lowTrustWarning = computed(() => {
  if (!props.showTrustBadges || !props.userTrustScores) return false;
  const scores = Object.values(props.userTrustScores).filter(s => !s.flags.includes('no_meta'));
  if (scores.length === 0) return false;
  const lowCount = scores.filter(s => s.score < 40).length;
  return lowCount / scores.length >= 0.3;
});

const heatIcon = (heat: 'high' | 'medium' | 'low' | 'hot' | 'normal') => {
  if (heat === 'high' || heat === 'hot') return '🔥';
  if (heat === 'medium' || heat === 'normal') return '🧠';
  return '💬';
};

const heatLabel = (heat: string) => {
  if (heat === 'hot' || heat === 'high') return 'Nóng bỏng';
  if (heat === 'normal' || heat === 'medium') return 'Vừa phải';
  return 'Nhẹ nhàng';
};

const commentIcon = (type: 'defining' | 'insightful' | 'meme') => {
  if (type === 'defining') return '🔥';
  if (type === 'insightful') return '🧠';
  return '😂';
};


</script>

<template>
  <div class="space-y-2 text-sm">
    <div class="space-y-3">
      <section class="space-y-2 card p-3">
        <h3 class="section-heading flex items-center gap-2">
          <span>{{ heatIcon(analysis.overview.heat) }}</span>
          TỔNG QUAN
          <span class="badge ml-auto" :class="{
            'badge-warning': analysis.overview.heat === 'hot',
            'badge-accent': analysis.overview.heat === 'normal',
            'badge-success': analysis.overview.heat !== 'hot' && analysis.overview.heat !== 'normal',
          }">{{ heatLabel(analysis.overview.heat) }}</span>
        </h3>
        <p class="font-heading text-sm text-(--color-text-primary) font-semibold">{{ analysis.overview.coreConflict }}</p>
        <ul class="space-y-1">
          <li v-for="(fact, i) in analysis.overview.keyFacts" :key="i" class="flex items-start gap-1.5 text-xs text-(--color-text-secondary)">
            <span class="text-(--color-secondary) mt-0.5 shrink-0">•</span>
            <span>{{ fact }}</span>
          </li>
        </ul>
        <div v-if="analysis.overview?.misconception" class="alert-warning alert flex flex-col items-start gap-1">
          <span class="font-medium text-(--color-warning-text) shrink-0">VOZ hiểu sai:</span>
          <span>{{ analysis.overview.misconception }}</span>
        </div>
      </section>

      <section class="space-y-2">
        <h3 class="section-heading flex items-center gap-1.5 px-1">👥 USER TIÊU BIỂU
          <span v-if="lowTrustWarning" class="badge badge-warning ml-auto" title="Nhiều user trong thread có dấu hiệu seeder/tài khoản mới">⚠ Có dấu hiệu
            seeder</span>
        </h3>
        <div class="grid gap-2">
          <div v-for="(profile, i) in analysis.userProfiles" :key="i" class="card p-3 space-y-1.5">
            <p class="font-heading text-xs font-semibold text-(--color-text-primary)">{{ profile.role }}</p>
            <p class="text-xs text-(--color-text-secondary) leading-relaxed">{{ profile.description }}</p>
            <p class="text-xs text-(--color-text-muted) italic">— {{ profile.note }}</p>
            <blockquote class="border-l-2 border-(--color-secondary) pl-2 text-xs text-(--color-text-secondary) italic">
              "{{ profile.quote }}"
            </blockquote>
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <h3 class="section-heading flex items-center gap-1.5 px-1">⚡ LUỒNG TRANH LUẬN</h3>
        <div class="space-y-2">
          <div v-for="(stream, i) in analysis.debateStreams" :key="i" class="card p-3 flex items-start gap-2.5">
            <span class="text-base shrink-0 mt-0.5">{{ heatIcon(stream.heat) }}</span>
            <div class="min-w-0">
              <p class="font-heading text-xs font-semibold text-(--color-text-primary)">{{ stream.title }}</p>
              <p class="text-xs text-(--color-text-secondary) mt-0.5 leading-relaxed">{{ stream.description }}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <h3 class="section-heading flex items-center gap-1.5 px-1">⚔️ COMBAT TIÊU BIỂU</h3>
        <div class="space-y-3">
          <div v-for="(combat, i) in analysis.combats" :key="i" class="card p-3 space-y-2">
            <p class="font-heading text-xs font-semibold text-(--color-text-primary)">{{ combat.title }}</p>
            <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-start text-xs">
              <div class="bg-(--color-secondary-soft) rounded-lg p-2 text-(--color-text-secondary) leading-relaxed">
                {{ combat.sideA }}
              </div>
              <span class="font-heading font-bold text-(--color-text-muted) self-center text-sm">VS</span>
              <div class="bg-(--color-accent-soft) rounded-lg p-2 text-(--color-text-secondary) leading-relaxed">
                {{ combat.sideB }}
              </div>
            </div>
            <p class="text-xs text-(--color-text-muted) italic">{{ combat.note }}</p>
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <h3 class="section-heading flex items-center gap-1.5 px-1">📅 TIMELINE</h3>
        <div class="space-y-2">
          <div v-for="(phase, i) in analysis.timeline" :key="i" class="card p-3 space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="font-heading text-xs font-semibold text-(--color-text-primary)">{{ phase.name }}</span>
              <span class="badge badge-neutral text-xs">{{ phase.pageRange }}</span>
            </div>
            <ul class="space-y-0.5">
              <li v-for="(event, j) in phase.events" :key="j" class="text-xs text-(--color-text-secondary) flex items-start gap-1.5">
                <span class="text-(--color-text-muted) shrink-0">–</span>
                <span class="leading-relaxed">{{ event }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section class="space-y-2">
        <h3 class="section-heading flex items-center gap-1.5 px-1">💬 COMMENT NỔI BẬT</h3>
        <div class="space-y-2">
          <div v-for="(comment, i) in analysis.notableComments" :key="i" class="card p-3 space-y-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span>{{ commentIcon(comment.type) }}</span>
              <span class="text-xs font-medium text-(--color-text-secondary)">{{ comment.author }}</span>
              <TrustBadge v-if="showTrustBadges && userTrustScores?.[comment.author]" :trustScore="userTrustScores[comment.author]" />
            </div>
            <p class="text-xs text-(--color-text-primary) leading-relaxed">{{ comment.text }}</p>
          </div>
        </div>
      </section>

      <section class="space-y-2 card p-3">
        <h3 class="section-heading flex items-center gap-1.5">📊 KẾT LUẬN</h3>
        <div class="space-y-2">
          <div v-for="(item, i) in analysis.conclusion.breakdown" :key="i" class="space-y-0.5">
            <div class="flex items-center justify-between text-xs text-(--color-text-secondary)">
              <span>{{ item.label }}</span>
              <span class="font-heading font-semibold">{{ item.percent }}%</span>
            </div>
            <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
              <div class="h-full rounded-full bg-(--color-accent)" :style="{ width: item.percent + '%' }" />
            </div>
          </div>
        </div>
        <div class="grid gap-2 text-xs">
          <div class="card-flat space-y-1">
            <p class="section-heading">Góc nhìn hệ thống</p>
            <p class="text-(--color-text-primary) leading-relaxed">{{ analysis.conclusion.insightPolicy }}</p>
          </div>
          <div class="card-flat space-y-1">
            <p class="section-heading">Phản ứng của VOZ</p>
            <p class="text-(--color-text-primary) leading-relaxed">{{ analysis.conclusion.insightPublic }}</p>
          </div>
        </div>
        <p class="text-xs text-(--color-text-muted) italic text-center">{{ analysis.conclusion.finalNote }}</p>
      </section>

      <section class="space-y-2 card p-3">
        <h3 class="section-heading flex items-center gap-1.5">⚔️ KIẾM HIỆP</h3>
        <p class="text-xs text-(--color-text-secondary) italic whitespace-pre-line border-l-2 border-(--color-accent) pl-3 leading-relaxed">{{ analysis.wuxia }}
        </p>
      </section>
    </div>
  </div>
</template>