import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { api } from "../lib/api";
import { useMeta } from "../lib/hooks";
import { Button, Sheet, Textarea } from "./ui";

type Msg = { role: "user" | "assistant"; content: string };
const PROVIDER: Record<string, string> = { gemini: "Google Gemini", groq: "Groq", custom: "your AI provider" };
const QUICK = ["Give me a short summary of my portfolio this week.", "Which holdings give me the most dividends?", "How is my money split by currency?"];

export function AskSheet({ onClose }: { onClose: () => void }) {
  const meta = useMeta();
  const providers = meta.data?.ai_providers ?? [];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [msgs, busy]);

  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setText("");
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ answer: string }>("/ai/ask", { body: { messages: next } });
      setMsgs([...next, { role: "assistant", content: r.answer || "(no answer)" }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const who = providers.map((p) => PROVIDER[p] ?? p).join(" or ");
  return (
    <Sheet
      open
      onClose={onClose}
      title="Ask about my portfolio"
      footer={
        providers.length ? (
          <form
            className="flex w-full items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Textarea
              aria-label="Your question"
              placeholder="Ask a question"
              rows={1}
              className="min-h-[44px] flex-1 resize-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <Button type="submit" aria-label="Send" disabled={!text.trim()} loading={busy}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        ) : undefined
      }
    >
      {!providers.length ? (
        <p className="text-sm text-muted">No AI provider is set up. Add GEMINI_API_KEY or GROQ_API_KEY to the .env file on your PC and restart the app.</p>
      ) : (
        <div className="space-y-3">
          {msgs.length === 0 && (
            <div className="space-y-2">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className="block w-full rounded-xl bg-ink-900 px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-ink-700">
                  {q}
                </button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "ml-8 rounded-2xl rounded-br-md bg-accent/20 px-3 py-2 text-sm text-slate-100" : "mr-4 whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-ink-900 px-3 py-2 text-sm text-slate-200"}
              data-role={m.role}
            >
              {m.content}
            </div>
          ))}
          {busy && <p className="text-xs text-muted">Thinking…</p>}
          {err && (
            <p role="alert" className="text-sm text-down">
              {err}
            </p>
          )}
          <div ref={end} />
          <p className="pt-1 text-2xs text-faint">
            Your holdings (symbols, amounts, brokers) are sent to {who} to answer. Free tiers may use what you send to improve their models. Answers can be wrong and are not financial advice.
          </p>
        </div>
      )}
    </Sheet>
  );
}
