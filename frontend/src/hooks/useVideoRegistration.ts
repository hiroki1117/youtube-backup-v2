import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { notify } from "@/lib/notify";
import { useApiAction } from "./useApiAction";

export function useVideoRegistration({ onRegistered }: { onRegistered?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { run, isPending } = useApiAction(
    (url: string) => apiClient.submitVideo(url),
    ({ title, alreadyBackedUp }) => {
      if (alreadyBackedUp) {
        notify("info", `既にバックアップ済みです: ${title}`);
      } else {
        notify("success", `バックアップを開始しました: ${title}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["videos"] });
      onRegistered?.();
    },
  );
  return { submit: run, isSubmitting: isPending };
}
