import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProductionDialog } from "@/components/ProductionDialog";

import { supabase } from "@/integrations/supabase/client";
import { publishVideo } from "@/lib/channels.functions";
import { renderVideo } from "@/lib/renderVideo";
import type { Scene, VideoStyle } from "@/lib/studio.functions";
import {
  VIDEO_STYLES,
  buildScene,
  deleteVideo,
  setVideoStatus,
  signAssets,
} from "@/lib/studio.functions";
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

      <VideoLibrary videos={videos} busyId={busyId} onChanged={refresh} />


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

const IN_PROGRESS = ["queued", "scheduled", "preparing", "assembling", "building", "rendering"];

const STATUS_LABEL: Record<string, string> = {
  queued: "Waiting to start",
  scheduled: "Scheduled",
  preparing: "Preparing",
  assembling: "Assembling scenes",
  building: "Building scenes",
  rendering: "Rendering",
  ready: "Ready",
  failed: "Failed",
};

function VideoLibrary({
  videos,
  busyId,
  onChanged,
}: {
  videos: VideoRow[];
  busyId: string | null;
  onChanged: () => void | Promise<unknown>;
}) {
  const runSign = useServerFn(signAssets);
  const runDelete = useServerFn(deleteVideo);
  const [links, setLinks] = useState<Record<string, string>>({});

  const ready = videos.filter((v) => v.status === "ready");
  const working = videos.filter((v) => IN_PROGRESS.includes(v.status));
  const failed = videos.filter((v) => v.status === "failed");

  const paths = ready
    .map((v) => v.video_path)
    .filter((p): p is string => Boolean(p))
    .join("|");

  useEffect(() => {
    const list = paths ? paths.split("|") : [];
    const missing = list.filter((p) => !links[p]);
    if (missing.length === 0) return;
    let cancelled = false;
    void runSign({ data: { paths: missing } })
      .then((rows) => {
        if (cancelled) return;
        setLinks((prev) => {
          const next = { ...prev };
          for (const row of rows) if (row.path && row.url) next[row.path] = row.url;
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  async function remove(id: string) {
    try {
      await runDelete({ data: { id } });
      await onChanged();
      toast.success("Video removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the video");
    }
  }

  if (videos.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Your videos</h2>
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No videos yet. Pick a look above to make your first one.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">Your videos</h2>
        <p className="text-xs text-muted-foreground">
          Videos being made and finished videos both show up here.
        </p>
      </div>

      {working.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            In progress
          </h3>
          {working.map((video) => (
            <div key={video.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {video.title || "Untitled video"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {STATUS_LABEL[video.status] ?? video.status}
                    {video.scheduled_at
                      ? ` · ${new Date(video.scheduled_at).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <Loader2
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground",
                    busyId === video.id ? "animate-spin" : "",
                  )}
                />
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(5, Math.min(100, video.progress))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {ready.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Finished
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {ready.map((video) => {
              const url = video.video_path ? links[video.video_path] : undefined;
              return (
                <div key={video.id} className="overflow-hidden rounded-lg border border-border">
                  {url ? (
                    <video src={url} controls playsInline className="aspect-video w-full bg-black" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                      Loading preview…
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {video.title || "Untitled video"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {video.language}
                        {video.style ? ` · ${video.style}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {url ? (
                        <a
                          href={url}
                          download
                          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label="Download video"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void remove(video.id)}
                        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                        aria-label="Delete video"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Needs attention
          </h3>
          {failed.map((video) => (
            <div
              key={video.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {video.title || "Untitled video"}
                </p>
                <p className="mt-0.5 text-xs text-destructive">
                  {video.error ?? "Something went wrong while making this video."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(video.id)}
                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                aria-label="Delete video"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
