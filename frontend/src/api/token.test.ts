import { beforeEach, describe, expect, it, vi } from "vitest";

// setup.ts は `@/api/token` を全体でモックするため、ここでは実体を読み込む。
vi.unmock("@/api/token");

const getCurrentUser = vi.fn();

vi.mock("amazon-cognito-identity-js", () => ({
  CognitoUserPool: class {
    getCurrentUser = getCurrentUser;
  },
}));

const { getIdToken } = await import("./token");

type SessionCallback = (
  err: Error | null,
  session: { isValid: () => boolean; getIdToken: () => { getJwtToken: () => string } } | null,
) => void;

function userWithSession(run: (callback: SessionCallback) => void) {
  return { getSession: (callback: SessionCallback) => run(callback) };
}

describe("getIdToken", () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
  });

  it("ログイン済みなら ID トークン（JWT）を返す", async () => {
    getCurrentUser.mockReturnValue(
      userWithSession((callback) =>
        callback(null, { isValid: () => true, getIdToken: () => ({ getJwtToken: () => "jwt-1" }) }),
      ),
    );
    await expect(getIdToken()).resolves.toBe("jwt-1");
  });

  it("未ログインなら null を返す", async () => {
    getCurrentUser.mockReturnValue(null);
    await expect(getIdToken()).resolves.toBeNull();
  });

  it("セッション取得エラーなら null を返す", async () => {
    getCurrentUser.mockReturnValue(userWithSession((callback) => callback(new Error("x"), null)));
    await expect(getIdToken()).resolves.toBeNull();
  });

  it("セッションが無効なら null を返す", async () => {
    getCurrentUser.mockReturnValue(
      userWithSession((callback) =>
        callback(null, { isValid: () => false, getIdToken: () => ({ getJwtToken: () => "x" }) }),
      ),
    );
    await expect(getIdToken()).resolves.toBeNull();
  });
});
