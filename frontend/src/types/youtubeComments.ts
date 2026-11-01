import { z } from "zod";

// コメントの形式はプラットフォームごとに違うため、YouTube 専用の型として持つ。
export interface YoutubeComment {
  commentId: string;
  text: string;
  likeCount: number;
  author: string | null;
  authorIsUploader: boolean;
  isPinned: boolean;
  /** 投稿日時（epoch 秒）。 */
  postedAt: number | null;
  /** 最新の取得に含まれなかった（YouTube では削除・非表示になった）コメント。 */
  removed: boolean;
}

export interface YoutubeCommentThread extends YoutubeComment {
  replies: YoutubeComment[];
}

/** 読み込み済みのスレッドと全体の件数。 */
export interface YoutubeCommentThreads {
  threads: YoutubeCommentThread[];
  totalThreads: number;
  totalComments: number;
}

export interface YoutubeCommentPage extends YoutubeCommentThreads {
  /** 次のページの offset。最後のページなら null。 */
  nextOffset: number | null;
}

const rawCommentSchema = z.object({
  comment_id: z.string(),
  text: z.string(),
  like_count: z.number(),
  author: z.string().nullish(),
  author_is_uploader: z.boolean(),
  is_pinned: z.boolean(),
  posted_at: z.number().nullish(),
  removed: z.boolean(),
});

function toComment(raw: z.output<typeof rawCommentSchema>): YoutubeComment {
  return {
    commentId: raw.comment_id,
    text: raw.text,
    likeCount: raw.like_count,
    author: raw.author ?? null,
    authorIsUploader: raw.author_is_uploader,
    isPinned: raw.is_pinned,
    postedAt: raw.posted_at ?? null,
    removed: raw.removed,
  };
}

export const youtubeCommentPageSchema = z
  .object({
    platform: z.literal("youtube"),
    total_threads: z.number(),
    total_comments: z.number(),
    threads: z.array(rawCommentSchema.extend({ replies: z.array(rawCommentSchema) })),
    next_offset: z.number().nullable(),
  })
  .transform((raw): YoutubeCommentPage => ({
    totalThreads: raw.total_threads,
    totalComments: raw.total_comments,
    threads: raw.threads.map((t) => ({ ...toComment(t), replies: t.replies.map(toComment) })),
    nextOffset: raw.next_offset,
  }));
