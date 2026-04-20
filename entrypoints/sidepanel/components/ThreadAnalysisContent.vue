<script setup lang="ts">
import { ref } from 'vue';
import type { ThreadAnalysisJSON } from '@/lib/types';

const props = defineProps<{
  analysis: ThreadAnalysisJSON;
  threadTitle: string;
  totalPages: number;
}>();

const copied = ref(false);

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

function formatAnalysisAsText(analysis: ThreadAnalysisJSON, title: string, totalPages: number): string {
  const lines: string[] = [];

  lines.push(`# PHÂN TÍCH THREAD: ${title}`);
  lines.push(`(${totalPages} trang)`);
  lines.push('');

  // 1. TỔNG QUAN
  lines.push('## 1. TỔNG QUAN');
  lines.push(`Độ nóng: ${heatLabel(analysis.overview.heat)}`);
  lines.push(`Mâu thuẫn chính: ${analysis.overview.coreConflict}`);
  lines.push('Fact quan trọng:');
  for (const fact of analysis.overview.keyFacts) {
    lines.push(`  - ${fact}`);
  }
  if (analysis.overview?.misconception) {
    lines.push(`VOZ hiểu sai: ${analysis.overview.misconception}`);
  }
  lines.push('');

  // 2. USER TIÊU BIỂU
  lines.push('## 2. USER TIÊU BIỂU');
  for (const profile of analysis.userProfiles) {
    lines.push(`### ${profile.role}`);
    lines.push(profile.description);
    lines.push(`Nhận xét: ${profile.note}`);
    lines.push(`Quote: '${profile.quote}'`);
    lines.push('');
  }

  // 3. LUỒNG TRANH LUẬN
  lines.push('## 3. LUỒNG TRANH LUẬN');
  for (const stream of analysis.debateStreams) {
    lines.push(`${heatIcon(stream.heat)} ${stream.title}`);
    lines.push(stream.description);
    lines.push('');
  }

  // 4. COMBAT TIÊU BIỂU
  lines.push('## 4. COMBAT TIÊU BIỂU');
  for (const combat of analysis.combats) {
    lines.push(`### ${combat.title}`);
    lines.push(`Phe A: ${combat.sideA}`);
    lines.push(`Phe B: ${combat.sideB}`);
    lines.push(`Nhận xét: ${combat.note}`);
    lines.push('');
  }

  // 5. TIMELINE
  lines.push('## 5. TIMELINE');
  for (const phase of analysis.timeline) {
    lines.push(`### ${phase.name} (${phase.pageRange})`);
    for (const event of phase.events) {
      lines.push(`  - ${event}`);
    }
    lines.push('');
  }

  // 6. COMMENT NỔI BẬT
  lines.push('## 6. COMMENT NỔI BẬT');
  for (const comment of analysis.notableComments) {
    lines.push(`${commentIcon(comment.type)} [${comment.author}]: ${comment.text}`);
    lines.push('');
  }

  // 7. KẾT LUẬN
  lines.push('## 7. KẾT LUẬN');
  for (const item of analysis.conclusion.breakdown) {
    lines.push(`  ${item.label}: ${item.percent}%`);
  }
  lines.push(`Góc nhìn hệ thống: ${analysis.conclusion.insightPolicy}`);
  lines.push(`Phản ứng VOZ: ${analysis.conclusion.insightPublic}`);
  lines.push(`Tổng kết: ${analysis.conclusion.finalNote}`);
  lines.push('');

  // 8. KIẾM HIỆP
  lines.push('## 8. KIẾM HIỆP');
  lines.push(analysis.wuxia);

  return lines.join('\n');
}

async function handleCopy() {
  const text = formatAnalysisAsText(props.analysis, props.threadTitle, props.totalPages);
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // Fallback: prompt để user copy thủ công
    prompt('Copy nội dung bên dưới:', text);
  }
}
</script>

<template>
  <div class="space-y-5 text-sm">
    <!-- Actions row: slot bên trái, Copy bên phải -->
    <div class="flex items-center justify-between">
      <div class="flex items-center justify-start">
        <slot name="actions" />
      </div>
      <button
        class="btn text-xs flex items-center gap-1.5"
        @click="handleCopy"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        {{ copied ? 'Đã copy!' : 'Copy' }}
      </button>
    </div>

    <!-- 1. TỔNG QUAN -->
    <section class="card p-4 space-y-2">
      <h3 class="font-semibold text-(--color-text-primary) flex items-center gap-2">
        <span class="text-base">{{ heatIcon(analysis.overview.heat) }}</span>
        TỔNG QUAN
        <span class="text-xs font-normal px-1.5 py-0.5 rounded-full"
          :class="analysis.overview.heat === 'hot' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : analysis.overview.heat === 'normal' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'"
        >{{ heatLabel(analysis.overview.heat) }}</span>
      </h3>
      <p class="text-(--color-text-primary) font-medium">{{ analysis.overview.coreConflict }}</p>
      <ul class="space-y-1">
        <li v-for="(fact, i) in analysis.overview.keyFacts" :key="i" class="flex items-start gap-1.5 text-(--color-text-secondary)">
          <span class="text-blue-500 mt-0.5 shrink-0">•</span>
          <span>{{ fact }}</span>
        </li>
      </ul>
      <div v-if="analysis.overview?.misconception" class="bg-(--color-bg-muted) rounded p-2.5 text-xs text-(--color-text-secondary) border-l-2 border-amber-400">
        <span class="font-medium text-amber-600 dark:text-amber-400">VOZ hiểu sai:</span> {{ analysis.overview.misconception }}
      </div>
    </section>

    <!-- 2. USER TIÊU BIỂU -->
    <section class="space-y-2">
      <h3 class="font-semibold text-(--color-text-primary) px-1">👥 USER TIÊU BIỂU</h3>
      <div class="grid gap-2">
        <div
          v-for="(profile, i) in analysis.userProfiles"
          :key="i"
          class="card p-3 space-y-1.5"
        >
          <p class="font-medium text-(--color-text-primary) text-xs uppercase tracking-wide">{{ profile.role }}</p>
          <p class="text-(--color-text-secondary) text-xs">{{ profile.description }}</p>
          <p class="text-(--color-text-muted) text-xs italic">{{ profile.note }}</p>
          <blockquote class="border-l-2 border-blue-400 pl-2 text-xs text-(--color-text-secondary) italic">
            '{{ profile.quote }}'
          </blockquote>
        </div>
      </div>
    </section>

    <!-- 3. LUỒNG TRANH LUẬN -->
    <section class="space-y-2">
      <h3 class="font-semibold text-(--color-text-primary) px-1">⚡ LUỒNG TRANH LUẬN</h3>
      <div class="space-y-2">
        <div
          v-for="(stream, i) in analysis.debateStreams"
          :key="i"
          class="card p-3 flex items-start gap-2.5"
        >
          <span class="text-base shrink-0 mt-0.5">{{ heatIcon(stream.heat) }}</span>
          <div>
            <p class="font-medium text-(--color-text-primary) text-xs">{{ stream.title }}</p>
            <p class="text-(--color-text-secondary) text-xs mt-0.5">{{ stream.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. COMBAT TIÊU BIỂU -->
    <section class="space-y-2">
      <h3 class="font-semibold text-(--color-text-primary) px-1">⚔️ COMBAT TIÊU BIỂU</h3>
      <div class="space-y-3">
        <div
          v-for="(combat, i) in analysis.combats"
          :key="i"
          class="card p-3 space-y-2"
        >
          <p class="font-semibold text-(--color-text-primary) text-xs">{{ combat.title }}</p>
          <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-start text-xs">
            <div class="bg-blue-50 dark:bg-blue-900/20 rounded p-2 text-(--color-text-secondary)">
              {{ combat.sideA }}
            </div>
            <span class="font-bold text-(--color-text-muted) self-center">VS</span>
            <div class="bg-red-50 dark:bg-red-900/20 rounded p-2 text-(--color-text-secondary)">
              {{ combat.sideB }}
            </div>
          </div>
          <p class="text-xs text-(--color-text-muted) italic">{{ combat.note }}</p>
        </div>
      </div>
    </section>

    <!-- 5. TIMELINE -->
    <section class="space-y-2">
      <h3 class="font-semibold text-(--color-text-primary) px-1">📅 TIMELINE</h3>
      <div class="space-y-2">
        <div
          v-for="(phase, i) in analysis.timeline"
          :key="i"
          class="card p-3 space-y-1.5"
        >
          <div class="flex items-center gap-2">
            <span class="font-medium text-(--color-text-primary) text-xs">{{ phase.name }}</span>
            <span class="text-xs px-1.5 py-0.5 bg-(--color-bg-muted) text-(--color-text-muted) rounded-full">{{ phase.pageRange }}</span>
          </div>
          <ul class="space-y-0.5">
            <li
              v-for="(event, j) in phase.events"
              :key="j"
              class="text-xs text-(--color-text-secondary) flex items-start gap-1.5"
            >
              <span class="text-(--color-text-muted) shrink-0">–</span>
              <span>{{ event }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 6. COMMENT NỔI BẬT -->
    <section class="space-y-2">
      <h3 class="font-semibold text-(--color-text-primary) px-1">💬 COMMENT NỔI BẬT</h3>
      <div class="space-y-2">
        <div
          v-for="(comment, i) in analysis.notableComments"
          :key="i"
          class="card p-3 space-y-1"
        >
          <div class="flex items-center gap-1.5">
            <span>{{ commentIcon(comment.type) }}</span>
            <span class="text-xs font-medium text-(--color-text-secondary)">{{ comment.author }}</span>
          </div>
          <p class="text-xs text-(--color-text-primary)">{{ comment.text }}</p>
        </div>
      </div>
    </section>

    <!-- 7. KẾT LUẬN -->
    <section class="card p-4 space-y-3">
      <h3 class="font-semibold text-(--color-text-primary)">📊 KẾT LUẬN</h3>
      <!-- Breakdown bars -->
      <div class="space-y-1.5">
        <div
          v-for="(item, i) in analysis.conclusion.breakdown"
          :key="i"
          class="space-y-0.5"
        >
          <div class="flex items-center justify-between text-xs text-(--color-text-secondary)">
            <span>{{ item.label }}</span>
            <span class="font-medium">{{ item.percent }}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-(--color-bg-muted) overflow-hidden">
            <div
              class="h-full rounded-full bg-blue-500"
              :style="{ width: item.percent + '%' }"
            />
          </div>
        </div>
      </div>
      <div class="grid gap-2 text-xs">
        <div class="bg-(--color-bg-muted) rounded p-2.5 space-y-0.5">
          <p class="font-medium text-(--color-text-secondary)">Góc nhìn hệ thống</p>
          <p class="text-(--color-text-primary)">{{ analysis.conclusion.insightPolicy }}</p>
        </div>
        <div class="bg-(--color-bg-muted) rounded p-2.5 space-y-0.5">
          <p class="font-medium text-(--color-text-secondary)">Phản ứng của VOZ</p>
          <p class="text-(--color-text-primary)">{{ analysis.conclusion.insightPublic }}</p>
        </div>
      </div>
      <p class="text-xs text-(--color-text-muted) italic text-center">{{ analysis.conclusion.finalNote }}</p>
    </section>

    <!-- 8. KIẾM HIỆP -->
    <section class="card p-4 space-y-2">
      <h3 class="font-semibold text-(--color-text-primary)">⚔️ KIẾM HIỆP</h3>
      <p class="text-xs text-(--color-text-secondary) italic whitespace-pre-line border-l-2 border-purple-400 pl-3">{{ analysis.wuxia }}</p>
    </section>
  </div>
</template>
