import { beforeEach, describe, expect, it, vi } from "vitest";
import { CognitoAuthModule } from "./auth";

// amazon-cognito-identity-js を丸ごとモック（ネットワークに出ない）。
// vi.mock はファイル先頭へホイストされるため、上の import よりも先に適用される。
const { authenticateUserMock, getCurrentUserMock, signOutMock, getSessionMock } = vi.hoisted(
  () => ({
    authenticateUserMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    signOutMock: vi.fn(),
    getSessionMock: vi.fn(),
  }),
);

vi.mock("amazon-cognito-identity-js", () => ({
  CognitoUserPool: vi.fn().mockImplementation(function () {
    return { getCurrentUser: getCurrentUserMock };
  }),
  CognitoUser: vi.fn().mockImplementation(function () {
    return {
      authenticateUser: authenticateUserMock,
      getSession: getSessionMock,
      signOut: signOutMock,
    };
  }),
  AuthenticationDetails: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

describe("AuthModule.signIn（USER_SRP_AUTH / contract C5）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("認証成功で ok を返す", async () => {
    authenticateUserMock.mockImplementation(
      (_details: unknown, callbacks: { onSuccess: (s: unknown) => void }) => {
        callbacks.onSuccess({});
      },
    );
    const auth = new CognitoAuthModule();
    const result = await auth.signIn("user", "pass");
    expect(result.kind).toBe("ok");
  });

  it("NotAuthorizedException は invalidCredentials を返す（error-path）", async () => {
    authenticateUserMock.mockImplementation(
      (_details: unknown, callbacks: { onFailure: (e: unknown) => void }) => {
        callbacks.onFailure({
          code: "NotAuthorizedException",
          message: "Incorrect username or password.",
        });
      },
    );
    const auth = new CognitoAuthModule();
    const result = await auth.signIn("user", "wrong");
    expect(result.kind).toBe("invalidCredentials");
  });

  it("その他のエラー（ネットワーク等）は transport を返す（error-path）", async () => {
    authenticateUserMock.mockImplementation(
      (_details: unknown, callbacks: { onFailure: (e: unknown) => void }) => {
        callbacks.onFailure({ code: "NetworkError", message: "network failure" });
      },
    );
    const auth = new CognitoAuthModule();
    const result = await auth.signIn("user", "pass");
    expect(result.kind).toBe("transport");
  });

  it("newPasswordRequired は invalidCredentials を返す", async () => {
    authenticateUserMock.mockImplementation(
      (_details: unknown, callbacks: { newPasswordRequired: () => void }) => {
        callbacks.newPasswordRequired();
      },
    );
    const auth = new CognitoAuthModule();
    const result = await auth.signIn("user", "pass");
    expect(result.kind).toBe("invalidCredentials");
  });
});

describe("AuthModule.getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有効セッションがあれば authenticated を返す（セッション復元）", async () => {
    getCurrentUserMock.mockReturnValue({
      getSession: (cb: (err: Error | null, session: { isValid: () => boolean } | null) => void) => {
        cb(null, { isValid: () => true });
      },
    });
    const auth = new CognitoAuthModule();
    expect(await auth.getSession()).toBe("authenticated");
  });

  it("現在ユーザーがいなければ unauthenticated を返す", async () => {
    getCurrentUserMock.mockReturnValue(null);
    const auth = new CognitoAuthModule();
    expect(await auth.getSession()).toBe("unauthenticated");
  });

  it("セッションが無効なら unauthenticated を返す", async () => {
    getCurrentUserMock.mockReturnValue({
      getSession: (cb: (err: Error | null, session: { isValid: () => boolean } | null) => void) => {
        cb(null, { isValid: () => false });
      },
    });
    const auth = new CognitoAuthModule();
    expect(await auth.getSession()).toBe("unauthenticated");
  });

  it("getSession がエラーを返せば unauthenticated を返す", async () => {
    getCurrentUserMock.mockReturnValue({
      getSession: (cb: (err: Error | null, session: unknown) => void) => {
        cb(new Error("expired"), null);
      },
    });
    const auth = new CognitoAuthModule();
    expect(await auth.getSession()).toBe("unauthenticated");
  });
});

describe("AuthModule.signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("現在ユーザーの signOut を呼ぶ", async () => {
    getCurrentUserMock.mockReturnValue({ signOut: signOutMock });
    const auth = new CognitoAuthModule();
    await auth.signOut();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("現在ユーザーがいなくてもエラーにならない", async () => {
    getCurrentUserMock.mockReturnValue(null);
    const auth = new CognitoAuthModule();
    await expect(auth.signOut()).resolves.toBeUndefined();
  });
});
