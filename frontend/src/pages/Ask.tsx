import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { api } from "../lib/api";
import { useMeta } from "../lib/hooks";
import { Button, Card, Textarea } from "../components/ui";

type Msg = { role: "user" | "assistant"; content: string };
const PROVIDER: Record<string, string> = { gemini: "Google Gemini", groq: "Groq", custom: "your AI provider" };
const QUICK = ["Give me a short summary of my portfolio this week.", "Which holdings give me the most dividends?", "How is my money split by currency?"];

let kept: Msg[] = []; // the conversation survives switching tabs, not a reload

export function Ask() {
  const meta = useMeta();
  const providers = meta.data?.ai_providers ?? [];
  const [msgs, setMsgsState] = useState<Msg[]>(kept);
  const setMsgs = (m: Msg[]) => {
    kept = m;
    setMsgsState(m);
  };
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-2xl font-extrabold text-white">Ask AI</h1>
        {msgs.length > 0 && (
          <button type="button" className="text-sm font-semibold text-accent" onClick={() => setMsgs([])}>
            New chat
          </button>
        )}
      </div>
      {!providers.length ? (
        <Card className="p-5 text-sm text-muted">
          No AI provider is set up. Add GEMINI_API_KEY or GROQ_API_KEY to the .env file on your PC (both are free) and restart the app.
        </Card>
      ) : (
        <>
          <p className="px-1 text-sm text-muted">Questions about your own holdings: what you own, where your money is, dividends, what is coming up.</p>
          {msgs.length === 0 && (
            <div className="space-y-2">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => send(q)} className="block w-full rounded-2xl bg-ink-800 px-4 py-3 text-left text-sm text-slate-200 hover:bg-ink-700">
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                data-role={m.role}
                className={
                  m.role === "user"
                    ? "ml-10 rounded-2xl rounded-br-md bg-accent/20 px-3.5 py-2.5 text-sm text-slate-100"
                    : "mr-4 whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-ink-800 px-3.5 py-2.5 text-sm leading-relaxed text-slate-200"
                }
              >
                {m.content}
              </div>
            ))}
            {busy && <p className="px-1 text-xs text-muted">Thinking…</p>}
            {err && (
              <p role="alert" className="px-1 text-sm text-down">
                {err}
              </p>
            )}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Textarea
              aria-label="Your question"
              placeholder="Ask about your portfolio"
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
          <div ref={end} />
          <p className="px-1 text-2xs text-faint">
            Your holdings (symbols, amounts, brokers) are sent to {who} to answer. Free tiers may use what you send to improve their models. Answers can be wrong and are not financial advice.
          </p>
        </>
      )}
    </div>
  );
}
