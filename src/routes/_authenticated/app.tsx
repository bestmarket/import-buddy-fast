import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Folder, Loader2, LogOut, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { createProject, type ChannelProfile } from "@/lib/studio.functions";
import {
  useRefreshWorkspace,
  useWorkspace,
  useWorkspaceSelection,
  WorkspaceProvider,
} from "@/lib/useWorkspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app")({
  component: () => (
    <WorkspaceProvider>
      <AppLayout />
    </WorkspaceProvider>
  ),
});

const TABS = [
  { to: "/app/sources", label: "Sources" },
  { to: "/app/chat", label: "Chat" },
  { to: "/app/studio", label: "Studio" },
  { to: "/app/channels", label: "Channels" },
] as const;

function AppLayout() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const refresh = useRefreshWorkspace();
  const { selectProject } = useWorkspaceSelection();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const addProject = useMutation({
    mutationFn: useServerFn(createProject),
    onSuccess: async (project: Tables<"projects">) => {
      await refresh();
      selectProject(project.id);
      setName("");
      setAdding(false);
      toast.success("Project created");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const profile = workspace.data?.project.channel_profile as ChannelProfile | null | undefined;
  const style = profile?.visualStyle?.trim() || "Style pending analysis";

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-sidebar-border bg-sidebar md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-sidebar-border px-4 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">Current project</p>
            <h1 className="truncate text-base font-semibold text-sidebar-foreground">
              {workspace.data?.project.name ?? "Channel Studio"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">{style}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut />
          </Button>
        </div>

        <div className="p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-medium text-muted-foreground">Your projects</p>
            <Button
              variant="ghost"
              size="icon-sm"
              title="New project"
              aria-label="New project"
              onClick={() => setAdding((value) => !value)}
            >
              <Plus />
            </Button>
          </div>
          {adding ? (
            <form
              className="mb-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) addProject.mutate({ data: { name } });
              }}
            >
              <Input
                value={name}
                maxLength={80}
                autoFocus
                placeholder="Project name"
                aria-label="Project name"
                onChange={(event) => setName(event.target.value)}
              />
              <Button size="icon-sm" type="submit" disabled={!name.trim() || addProject.isPending}>
                {addProject.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              </Button>
            </form>
          ) : null}
          <div className="flex gap-1 overflow-x-auto md:block md:space-y-1">
            {(workspace.data?.projects ?? []).map((project) => {
              const projectProfile = project.channel_profile as ChannelProfile | null;
              const active = project.id === workspace.data?.project.id;
              return (
                <Button
                  key={project.id}
                  type="button"
                  variant="ghost"
                  onClick={() => selectProject(project.id)}
                  className={cn(
                    "h-auto min-w-40 justify-start px-2 py-2 text-left md:w-full",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Folder className="self-start" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {projectProfile?.visualStyle || "Not analysed"}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4 pt-2">
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: cn("border-primary text-foreground font-medium") }}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
