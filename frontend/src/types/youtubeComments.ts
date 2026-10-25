import { z } from "zod";

/**
 * バックアップした YouTube コメントのドメイン型（`GET /videos/{id}/comments/items`）。
 * コメントの形式はプラットフォームごとに違うため、YouTube 専用の型として持つ。
 * API 境界では zod で parse した値のみ扱う。
 */

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

export interface YoutubeCommentPage {
  totalThreads: number;
  totalComments: number;
  threads: YoutubeCommentThread[];
  /** 次のページの offset。最後のページなら null。 */
  nextOffset: number | null;
}

const rawCommentSchema = z
  .object({
    comment_id: z.string(),
    text: z.string(),
    like_count: z.number(),
    author: z.string().nullable().optional(),
    author_is_uploader: z.boolean(),
    is_pinned: z.boolean(),
    posted_at: z.number().nullable().optional(),
    removed: z.boolean(),
  })
  .passthrough();

const rawPageSchema = z.object({
  platform: z.literal("youtube"),
  total_threads: z.number(),
  total_comments: z.number(),
  threads: z.array(rawCommentSchema.extend({ replies: z.array(rawCommentSchema) })),
  next_offset: z.number().nullable(),
});

function toComment(raw: z.infer<typeof rawCommentSchema>): YoutubeComment {
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

/**
 * API 境界での検証（ApiClient が使用）。未検証値は YoutubeCommentPage として扱わず null を返す。
 * @param raw 検証前の未知の値
 * @returns 検証済み `YoutubeCommentPage`、不正なら null
 */
export function parseYoutubeCommentPage(raw: unknown): YoutubeCommentPage | null {
  const result = rawPageSchema.safeParse(raw);
  if (!result.success) {
    return null;
  }
  const d = result.data;
  return {
    totalThreads: d.total_threads,
    totalComments: d.total_comments,
    threads: d.threads.map((t) => ({ ...toComment(t), replies: t.replies.map(toComment) })),
    nextOffset: d.next_offset,
  };
}
