import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, FileSearch } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
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
  });

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center">
          <FileSearch className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Ask your documents</h2>
          <p className="text-muted-foreground mt-2">
            Start a new conversation to ask questions. Answers cite the exact passages
            they come from.
          </p>
        </div>
        <Button size="lg" onClick={() => newConv.mutate()} disabled={newConv.isPending}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> New conversation
        </Button>
      </div>
    </div>
  );
}
