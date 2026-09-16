import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProductionDialog } from "@/components/ProductionDialog";

import { supabase } from "@/integrations/supabase/client";
import { publishVideo } from "@/lib/channels.functions";
import { renderVideo } from "@/lib/renderVideo";
import type { Scene, VideoStyle } from "@/lib/studio.functions";
import { VIDEO_STYLES, buildScene, setVideoStatus, signAssets } from "@/lib/studio.functions";
import { useRefreshWorkspace, useWorkspace } from "@/lib/useWorkspace";
import { cn } from "@/lib/utils";
import { normalizeIngredients } from "@/lib/videoIngredients";

export const Route = createFileRoute("/_authenticated/app/studio")({
  head: () => ({
    meta: [
      { title: "Studio — Channel Studio" },
      {
        name: "description",
        content: "Pick a look and open its production settings to make your video.",
      },
      { property: "og:title", content: "Studio — Channel Studio" },
      {
        property: "og:description",
        content: "Pick a look and open its production settings to make your video.",
      },
    ],
  }),
  component: StudioPage,
});

type VideoRow = {
  id: string;
  title: string;
  language: string;
  style: string | null;
  status: string;
  progress: number;
  error: string | null;
  scenes: unknown;
  settings?: unknown;
  video_path: string | null;
  scheduled_at: string | null;
};

function StudioPage() {
  const workspace = useWorkspace();
  const refresh = useRefreshWorkspace();
  const projectId = workspace.data?.project.id;

  const [openStyle, setOpenStyle] = useState<VideoStyle | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const scripts = workspace.data?.scripts ?? [];
  const videos = (workspace.data?.videos ?? []) as unknown as VideoRow[];

  const runBuildScene = useServerFn(buildScene);
  const runSetStatus = useServerFn(setVideoStatus);
  const runSignAssets = useServerFn(signAssets);
  const runPublish = useServerFn(publishVideo);

  const produce = useCallback(
    async (video: VideoRow) => {
      const scenes = (video.scenes as Scene[]) ?? [];
      if (scenes.length === 0) return;
      setBusyId(video.id);
      try {
        for (let i = 0; i < scenes.length; i += 1) {
          if (scenes[i]?.imagePath && scenes[i]?.audioPath) continue;
          await runBuildScene({ data: { videoId: video.id, index: i, voice: "warm" } });
        }

        const fresh = await supabase
          .from("videos")
          .select("scenes,settings")
          .eq("id", video.id)
          .single();
        if (fresh.error) throw new Error(fresh.error.message);
        const built = ((fresh.data.scenes as unknown as Scene[]) ?? []).filter((s) => s.imagePath);
        const paths = built.flatMap((s) =>
          [s.imagePath, s.audioPath].filter((p): p is string => Boolean(p)),
        );
        const signed = await runSignAssets({ data: { paths } });
        const urlFor = (path: string | null | undefined) =>
          path ? (signed.find((s) => s.path === path)?.url ?? null) : null;

        await runSetStatus({ data: { videoId: video.id, status: "rendering", progress: 60 } });
        const ingredients = normalizeIngredients(
          (fresh.data as { settings?: unknown }).settings ?? video.settings,
        );
        const blob = await renderVideo(
          built.map((s) => ({
            imageUrl: urlFor(s.imagePath)!,
            audioUrl: urlFor(s.audioPath),
            caption: s.narration,
          })),
          ingredients,
        );

        const { data: userData } = await supabase.auth.getUser();
        const path = `${userData.user!.id}/${video.id}/video.webm`;
        const upload = await supabase.storage
          .from("media")
          .upload(path, blob, { contentType: blob.type || "video/webm", upsert: true });
        if (upload.error) throw new Error(upload.error.message);

        await runSetStatus({
          data: { videoId: video.id, status: "ready", progress: 100, videoPath: path, error: null },
        });

        try {
          const posted = await runPublish({ data: { videoId: video.id } });
          const ok = posted.results.filter((r) => r.status === "posted").length;
          if (ok > 0) toast.success(`Video is ready and posted to ${ok} account(s)`);
          else toast.success("Video is ready");
        } catch {
          toast.success("Video is ready, but auto-posting failed");
        }

        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Production failed";
        await runSetStatus({ data: { videoId: video.id, status: "failed", error: message } }).catch(
          () => undefined,
        );
        await refresh();
        toast.error(message);
      } finally {
        setBusyId(null);
      }
    },
    [refresh, runBuildScene, runPublish, runSetStatus, runSignAssets],
  );

  // Keep the list fresh so scheduled videos are picked up.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Finish any video that is waiting to be assembled.
  const autoRan = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (busyId) return;
    const next = videos.find(
      (v) => ["assembling", "queued"].includes(v.status) && !autoRan.current.has(v.id),
    );
    if (!next) return;
    autoRan.current.add(next.id);
    void produce(next);
  }, [busyId, produce, videos]);

  if (workspace.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your studio…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Video style</h2>
          <p className="text-xs text-muted-foreground">
            Tap a look to open its production settings.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {VIDEO_STYLES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setOpenStyle(option)}
              className={cn(
                "overflow-hidden rounded-lg border border-border text-left transition-colors",
                "hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="block h-16 w-full" style={{ background: option.swatch }} />
              <span className="block p-3">
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <ProductionDialog
        style={openStyle}
        projectId={projectId}
        scripts={scripts}
        onClose={() => setOpenStyle(null)}
        onQueued={refresh}
      />
    </div>
  );
}
