<script setup lang="ts">
import { ref, computed } from 'vue';
import MarkdownContent from './MarkdownContent.vue';
import AccordionItem from './AccordionItem.vue';
import TrustBadge from './TrustBadge.vue';
import type { SummaryJSON, TrustScore, TopReactItem } from '@/lib/types';
import { useAlertSettings } from '../composables/useAlertSettings';

const { hideWarningAlerts } = useAlertSettings();

const props = defineProps<{
  content: string;
  json?: SummaryJSON;
  topicUrl?: string;
  postPageMap?: Record<number, number>;
  topReacts?: TopReactItem[];
  userTrustScores?: Record<string, TrustScore>;
  showTrustBadges?: boolean;
}>();

function openPostLink(postNumber: number) {
  if (!props.topicUrl) return;
  const base = props.topicUrl.replace(/\/$/, '');
  browser.tabs.create({ url: `${base}/post-${postNumber}` });
}

function getTopReactLabel(item: TopReactItem, index: number): string {
  const likeIndex = props.topReacts?.slice(0, index).filter((r) => r.type === 'like').length ?? 0;
  if (item.type === 'like') {
    return likeIndex === 0 ? 'Top Ưng' : `Top Ưng #${likeIndex + 1}`;
  }
  const dislikeIndex = index - (props.topReacts?.filter((r) => r.type === 'like').length ?? 0);
  return dislikeIndex <= 0 ? 'Top Gạch' : `Top Gạch #${dislikeIndex + 1}`;
}

function getTopReactClass(item: TopReactItem): string {
  return item.type === 'like' ? 'badge-accent' : 'badge-error';
}

// --- Markdown fallback parse (backward compat for old cache entries) ---

interface Opinion { title: string; body: string; supporterCount: number | null }
interface Section { title: string; body: string; opinions?: Opinion[]; totalSupporters?: number; }

const sections = computed<Section[]>(() => {
  const raw = props.content;
  // Guard: if content looks like JSON (starts with { or [), don't parse as markdown
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return [{ title: '', body: raw }];
  }
  const parts = raw.split(/^## /m).filter((s) => s.trim());

  if (parts.length === 0) {
    return [{ title: '', body: raw }];
  }

  return parts.map((part) => {
    const [firstLine, ...rest] = part.split('\n');
    const title = firstLine.trim();
    const body = rest.join('\n').trim();

    const isOpinions = /quan\s*điểm/i.test(title);
    if (isOpinions) {
      const opinionParts = body.split(/^### /m).filter((s) => s.trim());
      if (opinionParts.length > 0) {
        const opinions = opinionParts.map((op) => {
          const [opTitle, ...opRest] = op.split('\n');
          const rawTitle = opTitle.trim();
          const countMatch = rawTitle.match(/\((\d+)\s*người[^)]*\)[.,:]?\s*$/);
          const supporterCount = countMatch ? parseInt(countMatch[1], 10) : null;
          const cleanTitle = countMatch
            ? rawTitle.replace(/\s*\(\d+\s*người[^)]*\)[.,:]?\s*$/, '').trim()
            : rawTitle;
          return { title: cleanTitle, body: opRest.join('\n').trim(), supporterCount };
        });
        const totalSupporters = opinions.reduce((sum, op) => sum + (op.supporterCount ?? 0), 0);
        return { title, body: '', opinions, totalSupporters };
      }
    }
    
    return { title, body };
  });
});

const isStructured = computed(() =>
  sections.value.length > 1 || sections.value[0]?.title !== '',
);

// Total supporters for JSON mode progress bars
const totalJsonSupporters = computed(() =>
  props.json?.opinions.reduce((s, o) => s + (Array.isArray(o.supporters) ? o.supporters.length : 0), 0) ?? 0,
);

// Copy
const copied = ref(false);

function formatSummaryAsText(): string {
  if (props.json) {
    const lines: string[] = [];
    lines.push('## Tóm tắt');
    lines.push(props.json.summary);
    lines.push('');
    if (props.json.opinions?.length) {
      lines.push('## Quan điểm nổi bật');
      for (const op of props.json.opinions) {
        lines.push(`### ${op.title}`);
        if (Array.isArray(op.supporters) && op.supporters.length) lines.push(`Ủng hộ: ${op.supporters.join(', ')}`);
        lines.push(op.description);
        if (op.quotes?.length) {
          for (const q of op.quotes) {
            lines.push(`  > '${q.text}' — ${q.author} (#${q.postNumber})`);
          }
        }
        lines.push('');
      }
    }
    if (props.json.conclusion) {
      lines.push('## Kết luận');
      lines.push(props.json.conclusion);
    }
    if (props.topReacts?.length) {
      lines.push('');
      lines.push('## Bình luận nổi bật');
      for (const item of props.topReacts) {
        const prefix = item.type === 'like' ? 'Top Ưng' : 'Top Gạch';
        const likeCount = props.topReacts.filter((r) => r.type === 'like').length;
        const indexInType = item.type === 'like'
          ? props.topReacts.indexOf(item)
          : props.topReacts.indexOf(item) - likeCount;
        const label = indexInType === 0 ? prefix : `${prefix} #${indexInType + 1}`;
        lines.push(`* ${label} (${item.count}): ${item.author}`);
      }
    }
    return lines.join('\n');
  }
  return props.content;
}

async function handleCopy() {
  const text = formatSummaryAsText();
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    prompt('Copy nội dung bên dưới:', text);
  }
}


</script>

<template>
  <div class="space-y-2 text-sm">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
      <button
        class="btn btn-sm btn-ghost flex items-center gap-1"
        @click="handleCopy"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        {{ copied ? 'Đã copy!' : 'Copy' }}
      </button>
    </div>
    
    <div class="card p-4 space-y-5">
      <div v-if="json" class="space-y-5">
        <div>
          <h3 class="section-heading mb-2">Tóm tắt</h3>
          <div class="border-l-2 border-(--color-accent) pl-3">
            <MarkdownContent :content="json.summary" />
          </div>
        </div>

        <div v-if="json.opinions?.length">
          <h3 class="section-heading mb-2">Quan điểm nổi bật</h3>
          <div class="space-y-2">
            <AccordionItem v-for="(op, i) in json.opinions" :key="i">
              <template #title>
                <div class="w-full min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-sm text-(--color-text-primary)">{{ op.title }}</span>
                    <span
                      v-if="Array.isArray(op.supporters) && op.supporters.length"
                      class="badge badge-accent ml-2 shrink-0"
                    >
                      {{ op.supporters.length }} người
                    </span>
                  </div>
                  <div
                    v-if="Array.isArray(op.supporters) && op.supporters.length && totalJsonSupporters > 0"
                    class="w-full h-1.5 bg-(--color-bg-muted) rounded-full overflow-hidden"
                  >
                    <div
                      class="h-full bg-(--color-secondary) rounded-full transition-all duration-300"
                      :style="{ width: Math.round((op.supporters.length / totalJsonSupporters) * 100) + '%' }"
                    />
                  </div>
                </div>
              </template>
              <div class="space-y-3">
                <MarkdownContent :content="op.description" />
                <div v-if="Array.isArray(op.supporters) && op.supporters.length && (showTrustBadges ? userTrustScores : false) !== undefined" class="flex flex-wrap gap-1.5 mt-1">
                  <template v-for="username in op.supporters" :key="username">
                    <span class="flex items-center gap-1 text-xs text-(--color-text-secondary)">
                      {{ username }}
                      <TrustBadge
                        v-if="showTrustBadges && userTrustScores?.[username]"
                        :trustScore="userTrustScores[username]"
                      />
                    </span>
                  </template>
                </div>
                <div v-if="op.quotes?.length" class="space-y-2 mt-1">
                  <blockquote
                    v-for="(q, qi) in op.quotes"
                    :key="qi"
                    class="border-l-2 border-(--color-border-strong) pl-3 text-xs text-(--color-text-secondary)"
                  >
                    <p class="italic leading-relaxed">"{{ q.text }}"</p>
                    <cite class="not-italic text-xs text-(--color-text-muted) mt-0.5 block">
                      — {{ q.author }}
                      <button
                        v-if="topicUrl"
                        class="link font-mono text-xs"
                        @click="openPostLink(q.postNumber)"
                      >#{{ q.postNumber }}</button>
                      <span v-else class="font-mono text-(--color-text-muted)">#{{ q.postNumber }}</span>
                    </cite>
                  </blockquote>
                </div>
              </div>
            </AccordionItem>
          </div>
        </div>

        <div v-if="json.conclusion">
          <h3 class="section-heading mb-2">Kết luận</h3>
          <div class="border-l-2 border-(--color-secondary) pl-3">
            <MarkdownContent :content="json.conclusion" />
          </div>
        </div>
      </div>

      <template v-else>
      <div v-if="!hideWarningAlerts" class="alert alert-warning flex items-start gap-2">
        <svg class="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        <span>Đang hiển thị ở chế độ fallback vì phản hồi LLM bị lỗi và không parse được sang JSON.</span>
      </div>
        
        <MarkdownContent v-if="!isStructured" :content="content" />

        <div v-else class="space-y-5">
          <div v-for="(section, i) in sections" :key="i">
            <h3
              v-if="section.title"
              class="section-heading mb-2"
            >
              {{ section.title }}
            </h3>

            <MarkdownContent
              v-if="!section.opinions && section.body"
              :content="section.body"
            />

            <div v-if="section.opinions" class="space-y-2">
              <AccordionItem
                v-for="(opinion, j) in section.opinions"
                :key="j"
              >
                <template #title>
                  <div class="w-full min-w-0">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-medium text-sm text-(--color-text-primary)">{{ opinion.title }}</span>
                      <span
                        v-if="opinion.supporterCount !== null"
                        class="badge badge-accent ml-2 shrink-0"
                      >
                        {{ opinion.supporterCount }} người
                      </span>
                    </div>
                    <div
                      v-if="opinion.supporterCount !== null && section.totalSupporters"
                      class="w-full h-1.5 bg-(--color-bg-muted) rounded-full overflow-hidden"
                    >
                      <div
                        class="h-full bg-(--color-secondary) rounded-full transition-all duration-300"
                        :style="{ width: Math.round((opinion.supporterCount / section.totalSupporters!) * 100) + '%' }"
                      />
                    </div>
                  </div>
                </template>
                <MarkdownContent :content="opinion.body" />
              </AccordionItem>
            </div>
          </div>
        </div>
      </template>

        <!-- Top reacts -->
        <div v-if="topReacts && topReacts.length > 0">
          <h3 class="section-heading mb-2">B&#236;nh lu&#7853;n n&#7893;i b&#7853;t</h3>
          <div class="space-y-1.5">
            <div v-for="(item, i) in topReacts" :key="i" class="flex items-center gap-2 text-xs">
              <span class="badge whitespace-nowrap" :class="getTopReactClass(item)">
                {{ getTopReactLabel(item, i) }} ({{ item.count }})
              </span>
              <span class="text-(--color-text-secondary)">{{ item.author }}</span>
              <button
                v-if="topicUrl"
                class="link font-mono"
                @click="openPostLink(item.postNumber)"
              >Xem bình luận</button>
            </div>
          </div>
        </div>
    </div>
  </div>
</template>
