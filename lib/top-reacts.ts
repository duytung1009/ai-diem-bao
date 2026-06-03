import type { ScrapedPost, TopReactItem } from './types';

export function computeTopReacts(posts: ScrapedPost[], topN: number = 3): TopReactItem[] {
  const postsWithReactions = posts.filter((p) => p.reactions !== undefined);
  if (!postsWithReactions.length) return [];

  const topLikes: TopReactItem[] = postsWithReactions
    .filter((p) => (p.reactions!.like ?? 0) > 0)
    .sort((a, b) => (b.reactions!.like ?? 0) - (a.reactions!.like ?? 0))
    .slice(0, topN)
    .map((p) => ({ type: 'like', count: p.reactions!.like!, author: p.author, postNumber: p.postNumber }));

  const topDislikes: TopReactItem[] = postsWithReactions
    .filter((p) => (p.reactions!.dislike ?? 0) > 0)
    .sort((a, b) => (b.reactions!.dislike ?? 0) - (a.reactions!.dislike ?? 0))
    .slice(0, topN)
    .map((p) => ({ type: 'dislike', count: p.reactions!.dislike!, author: p.author, postNumber: p.postNumber }));

  return [...topLikes, ...topDislikes];
}
