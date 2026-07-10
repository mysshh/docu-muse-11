import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileSearch,
  FileText,
  MessageSquarePlus,
  MessageSquare,
  LogOut,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const newConv = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No user");
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title: "New chat" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/chat/$threadId", params: { threadId: conv.id } });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteConv = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("conversations").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (pathname.includes(id)) navigate({ to: "/chat" });
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-72 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-md bg-primary/20 flex items-center justify-center">
            <FileSearch className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">DocuMind</span>
        </div>

        <div className="p-3 space-y-1">
          <Link
            to="/documents"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-sidebar-accent transition",
              pathname === "/documents" && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <FileText className="h-4 w-4" /> Documents
          </Link>
          <Button
            variant="secondary"
            className="w-full justify-start gap-2 mt-2"
            size="sm"
            onClick={() => newConv.mutate()}
            disabled={newConv.isPending}
          >
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </Button>
        </div>

        <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
          Conversations
        </div>
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 pb-4">
            {(conversations ?? []).map((c) => {
              const active = pathname === `/chat/${c.id}`;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <Link
                    to="/chat/$threadId"
                    params={{ threadId: c.id }}
                    className="flex-1 truncate"
                  >
                    {c.title || "Untitled"}
                  </Link>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this conversation?")) deleteConv.mutate(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            {(conversations ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-3">No conversations yet.</p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-sidebar-border p-3 flex items-center gap-2">
          <div className="flex-1 truncate">
            <div className="text-sm truncate">{user?.email}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
