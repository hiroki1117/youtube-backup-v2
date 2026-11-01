import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { YoutubeCommentList } from "@/components/YoutubeCommentList";
import type { YoutubeComment } from "@/types/youtubeComments";

/** バックアップした YouTube コメントの一覧（動画再生ページのコメント欄の下に出す presentational）。 */
const comment = (overrides: Partial<YoutubeComment>): YoutubeComment => ({
  commentId: "c1",
  text: "とても参考になりました。",
  likeCount: 12,
  author: "@viewer",
  authorIsUploader: false,
  isPinned: false,
  postedAt: 1792713600,
  removed: false,
  ...overrides,
});

const meta = {
  title: "Components/YoutubeCommentList",
  component: YoutubeCommentList,
  args: {
    state: {
      kind: "ready",
      totalThreads: 3,
      totalComments: 5,
      threads: [
        {
          ...comment({
            commentId: "pinned",
            author: "@channel",
            authorIsUploader: true,
            isPinned: true,
            text: "番組のフル視聴はこちらから。\n概要欄もご覧ください。",
          }),
          replies: [],
        },
        {
          ...comment({ commentId: "c2" }),
          replies: [
            comment({ commentId: "c2.r1", text: "同感です。", likeCount: 2 }),
            comment({ commentId: "c2.r2", text: "削除された返信", removed: true, likeCount: 0 }),
          ],
        },
        {
          ...comment({ commentId: "c3", text: "YouTube から消えたコメント", removed: true }),
          replies: [],
        },
      ],
    },
    hasMore: true,
    isLoadingMore: false,
    onLoadMore: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof YoutubeCommentList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Threads: Story = {};

export const Empty: Story = {
  args: {
    state: { kind: "ready", totalThreads: 0, totalComments: 0, threads: [] },
    hasMore: false,
  },
};

export const Loading: Story = {
  args: { state: { kind: "loading" } },
};

export const Error: Story = {
  args: {
    state: {
      kind: "error",
      message: "コメントを読み込めませんでした。時間をおいて再試行してください。",
    },
  },
};
