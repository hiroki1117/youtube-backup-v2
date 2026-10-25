import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { HttpApiClient } from "./client";
import { server } from "@/test/server";
import {
  TEST_API_BASE,
  errorResponse,
  makePlaybackUrl,
  makeRegistration,
  unauthorizedResponse,
} from "@/test/handlers";
import { makeRawVideo } from "@/test/factories";

const client = new HttpApiClient(TEST_API_BASE, () => Promise.resolve("test-token"));

describe("ApiClient.listVideos（GET /videos）", () => {
  it("配列レスポンスを ok(Video[]) に正規化する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json([makeRawVideo(), makeRawVideo({ video_id: "v2" })]),
      ),
    );
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].videoId).toBe("v1");
    }
  });

  it("空配列は empty に正規化する", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json([])));
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("empty");
  });

  it("ネットワーク断は transport 失敗に正規化する（error-path）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.error()));
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("transport");
  });

  it("非配列レスポンスは transport 失敗に正規化する（error-path）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json({ detail: "x" })));
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("transport");
  });

  it("スキーマ不一致の item を含む配列は transport 失敗に正規化する（error-path）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => HttpResponse.json([{ video_id: 123 }])));
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("transport");
  });

  it("upload_status と fetch_num をクエリに整形する", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await client.listVideos({ uploadStatus: "init", fetchNum: 50 });
    expect(capturedUrl).toContain("upload_status=init");
    expect(capturedUrl).toContain("fetch_num=50");
  });
});

describe("ApiClient.getVideo（GET /videos/{id}）", () => {
  it("Video を ok(Video) に正規化する", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:id`, () => HttpResponse.json(makeRawVideo())));
    const result = await client.getVideo("v1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.videoId).toBe("v1");
    }
  });

  it("404 video_not_found は notFound に正規化する（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id`, () => errorResponse(404, "video_not_found")),
    );
    const result = await client.getVideo("missing");
    expect(result.kind).toBe("notFound");
  });

  it("422（ID 形式不正）は invalidInput に正規化する（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id`, () =>
        HttpResponse.json(
          { detail: [{ loc: ["path", "video_id"], msg: "bad", type: "x" }] },
          { status: 422 },
        ),
      ),
    );
    const result = await client.getVideo(" ");
    expect(result.kind).toBe("invalidInput");
  });

  it("スキーマ不一致は transport 失敗に正規化する（error-path）", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos/:id`, () => HttpResponse.json({ video_id: 1 })));
    const result = await client.getVideo("v1");
    expect(result.kind).toBe("transport");
  });
});

describe("ApiClient.submitVideo（POST /videos）", () => {
  it("新規登録（202）を ok(SubmitResult) に正規化する", async () => {
    server.use(
      http.post(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json(
          makeRegistration({ video_id: "v9", title: "新規", batch_job_id: "job-1" }),
          { status: 202 },
        ),
      ),
    );
    const result = await client.submitVideo("https://youtu.be/abc");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.videoId).toBe("v9");
      expect(result.data.title).toBe("新規");
      expect(result.data.alreadyBackedUp).toBe(false);
      expect(result.data.batchJobId).toBe("job-1");
    }
  });

  it("既登録（already_registered=true）も ok(alreadyBackedUp:true) に正規化する", async () => {
    server.use(
      http.post(`${TEST_API_BASE}/videos`, () =>
        HttpResponse.json(makeRegistration({ already_registered: true, batch_job_id: null })),
      ),
    );
    const result = await client.submitVideo("https://youtu.be/abc");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.alreadyBackedUp).toBe(true);
      expect(result.data.batchJobId).toBe("");
    }
  });

  it("422 invalid_url は invalidInput に正規化する（error-path）", async () => {
    server.use(http.post(`${TEST_API_BASE}/videos`, () => errorResponse(422, "invalid_url")));
    const result = await client.submitVideo("bad");
    expect(result.kind).toBe("invalidInput");
  });

  it("本文の形が不正なら transport 失敗に正規化する（error-path）", async () => {
    server.use(http.post(`${TEST_API_BASE}/videos`, () => HttpResponse.json({ ok: true })));
    const result = await client.submitVideo("https://youtu.be/abc");
    expect(result.kind).toBe("transport");
  });
});

describe("ApiClient.deleteVideo（DELETE /videos/{id}）", () => {
  it("204 を ok(null) に正規化する", async () => {
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const result = await client.deleteVideo("v1");
    expect(result).toEqual({ kind: "ok", data: null });
  });

  it("409 backup_object_needs_reconciliation は rejected(backupInProgress) に正規化する（error-path）", async () => {
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id`, () =>
        errorResponse(409, "backup_object_needs_reconciliation"),
      ),
    );
    const result = await client.deleteVideo("v1");
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reason).toBe("backupInProgress");
    }
  });

  it("409 deletion_needs_reconciliation は rejected(serverError) に正規化する（error-path）", async () => {
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id`, () =>
        errorResponse(409, "deletion_needs_reconciliation"),
      ),
    );
    const result = await client.deleteVideo("v1");
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reason).toBe("serverError");
    }
  });

  it("404 は notFound に正規化する（error-path）", async () => {
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id`, () => errorResponse(404, "video_not_found")),
    );
    const result = await client.deleteVideo("missing");
    expect(result.kind).toBe("notFound");
  });
});

describe("ApiClient.getPresignedUrl（GET /videos/{id}/playback_url）", () => {
  it("成功を ok(url) に正規化する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id/playback_url`, () =>
        HttpResponse.json(makePlaybackUrl("https://s3.example.com/signed")),
      ),
    );
    const result = await client.getPresignedUrl("v1");
    expect(result).toEqual({ kind: "ok", data: "https://s3.example.com/signed" });
  });

  it("409 backup_not_complete は rejected(backupInProgress) に正規化する（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id/playback_url`, () =>
        errorResponse(409, "backup_not_complete"),
      ),
    );
    const result = await client.getPresignedUrl("v1");
    expect(result.kind).toBe("rejected");
  });

  it("404 は notFound に正規化する（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id/playback_url`, () =>
        errorResponse(404, "video_not_found"),
      ),
    );
    const result = await client.getPresignedUrl("missing");
    expect(result.kind).toBe("notFound");
  });

  it("本文の形が不正なら transport 失敗に正規化する（error-path）", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id/playback_url`, () => HttpResponse.json({ url: 1 })),
    );
    const result = await client.getPresignedUrl("v1");
    expect(result.kind).toBe("transport");
  });
});

describe("ApiClient の認証ヘッダと HTTP エラー", () => {
  it("全リクエストに Authorization: Bearer <トークン> を付ける", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(`${TEST_API_BASE}/videos`, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json([]);
      }),
    );
    await client.listVideos({ uploadStatus: "complete" });
    expect(authorization).toBe("Bearer test-token");
  });

  it("ボディを持たない GET/DELETE には Content-Type を付けない", async () => {
    let contentType: string | null = "unset";
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id`, ({ request }) => {
        contentType = request.headers.get("content-type");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await client.deleteVideo("v1");
    expect(contentType).toBeNull();
  });

  it("ボディを持つ POST /videos には Content-Type: application/json を付ける", async () => {
    let contentType: string | null = null;
    server.use(
      http.post(`${TEST_API_BASE}/videos`, ({ request }) => {
        contentType = request.headers.get("content-type");
        return errorResponse(422, "invalid_url");
      }),
    );
    await client.submitVideo("bad");
    expect(contentType).toBe("application/json");
  });

  it("トークンを取得できない場合はリクエストせず transport 失敗にする（認証切れ）", async () => {
    let called = false;
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () => {
        called = true;
        return HttpResponse.json([]);
      }),
    );
    const noToken = new HttpApiClient(TEST_API_BASE, () => Promise.resolve(null));
    const result = await noToken.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("transport");
    expect(called).toBe(false);
  });

  it("401（JWT 検証失敗）は transport 失敗に正規化する", async () => {
    server.use(http.get(`${TEST_API_BASE}/videos`, () => unauthorizedResponse()));
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result.kind).toBe("transport");
  });

  it("503 は transport 失敗に正規化する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos`, () => errorResponse(503, "upstream_unavailable")),
    );
    const result = await client.listVideos({ uploadStatus: "complete" });
    expect(result).toEqual({ kind: "transport", message: "HTTP 503" });
  });

  it("エラー本文が JSON でなくてもステータスで分類する", async () => {
    server.use(
      http.get(`${TEST_API_BASE}/videos/:id`, () => new HttpResponse("oops", { status: 404 })),
    );
    const result = await client.getVideo("v1");
    expect(result.kind).toBe("notFound");
  });
});

describe("ApiClient.updateVideoTitle（PATCH /videos/{id}）", () => {
  it("title を JSON で送り、更新後の Video を返す", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${TEST_API_BASE}/videos/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeRawVideo({ title: "更新後" }));
      }),
    );
    const result = await client.updateVideoTitle("v1", "更新後");
    expect(body).toEqual({ title: "更新後" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.title).toBe("更新後");
    }
  });

  it("404 は notFound、422 は invalidInput に正規化する（error-path）", async () => {
    server.use(
      http.patch(`${TEST_API_BASE}/videos/:id`, () => errorResponse(404, "video_not_found")),
    );
    expect((await client.updateVideoTitle("missing", "x")).kind).toBe("notFound");
    server.use(http.patch(`${TEST_API_BASE}/videos/:id`, () => errorResponse(422, "invalid")));
    expect((await client.updateVideoTitle("v1", "x")).kind).toBe("invalidInput");
  });
});

describe("ApiClient.cancelBackup（DELETE /videos/{id}/backup）", () => {
  it("204 を ok(null) に正規化する", async () => {
    server.use(
      http.delete(
        `${TEST_API_BASE}/videos/:id/backup`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    expect(await client.cancelBackup("v1")).toEqual({ kind: "ok", data: null });
  });

  it("409 は rejected、404 は notFound に正規化する（error-path）", async () => {
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id/backup`, () =>
        errorResponse(409, "backup_object_needs_reconciliation"),
      ),
    );
    const rejected = await client.cancelBackup("v1");
    expect(rejected.kind).toBe("rejected");
    server.use(
      http.delete(`${TEST_API_BASE}/videos/:id/backup`, () =>
        errorResponse(404, "video_not_found"),
      ),
    );
    expect((await client.cancelBackup("missing")).kind).toBe("notFound");
  });
});
