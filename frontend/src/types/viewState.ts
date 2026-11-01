/** 読み込み・失敗・空・表示の 4 状態。StatusView と各パネルが描画する。 */
export type ViewState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty"; message: string }
  | { status: "ready"; data: T };
